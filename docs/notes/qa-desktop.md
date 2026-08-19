# QA script: desktop shell (Electron + Bare worker + OTA)

Rewritten for the runtime pivot (`docs/superpowers/specs/2026-08-19-desktop-shell-design.md`).
The old version of this file described a `pear run`/`pear-electron` app that
never shipped (see `docs/notes/spike-pear-v3.md`) — this one is the real
three-tier topology:

```
renderer (Chromium, Preact UI)
  ⇄ contextBridge/ipcRenderer  (preload.js)
  ⇄ Electron main (main.js — dumb frame relay, owns BrowserWindow/Tray/
    single-instance/login-item/pear-runtime embed)
  ⇄ Bare IPC (newline-JSON frames over the pear-runtime/bare-sidecar duplex)
  ⇄ Bare worker (worker/core-host.js — WallpaperCore + sync-engine +
    bridge-main; the P2P/holepunch stack runs here, on Bare's prebuilds,
    which is why there's no electron-rebuild step)
```

Needs a Mac. Uses the real hyperswarm DHT for pairing/send (needs internet;
first discovery can take ~10–60s) and, separately, `pear-runtime`'s own DHT
swarm for OTA (joined the moment `new PearRuntime()` constructs in `main.js`
— see Act 11).

> **Dev harness vs. built app.** `npm run dev` (`electron-forge start`) is
> enough for Acts 1–9 (boot, IPC, pairing, send, tray, sleep/wake,
> single-instance). **Launch-at-login (Act 10) and OTA (Act 11) only work
> against a built/installed `.app`** (`npm run make`) — the LaunchAgent's
> `ProgramArguments` point at `app.getPath('exe')`, and the OTA updater only
> calls `applyUpdate()` when `app.isPackaged` is true (`main.js`'s
> `getAppBundlePath()`/`bundled: app.isPackaged`). Don't expect either to do
> anything under `npm run dev`.

> **Known carried defect (fix wave, not this task):** `ui/components/Send.js`'s
> `resolveFilePath` falls back to `await import('pear-electron')` when
> `file.path` is absent, but Task 1 removed `pear-electron` as a dependency —
> that dynamic import now always rejects, so on any Electron build where
> `File#path` is undefined (Electron ≥32; this repo pins `electron@^33`),
> **both browse and drag-drop in the Send tab are broken** (the UI catches
> the rejection and shows the "Could not read a path for that file" error
> banner rather than crashing — see `Send.js`'s `pickFile`). The real fix is
> `webUtils.getPathForFile` via a preload→main IPC round-trip (`webUtils` is
> main-process-only). Act 3 below is written so you re-run it once that fix
> lands, not to be a false-negative right now — if it fails today, that's
> this known defect, not a new bug.

## Setup — two instances on one Mac

Electron apps honor the Chromium `--user-data-dir` switch before
`app.whenReady()` — no code change needed, and this app's
`app.requestSingleInstanceLock()` scopes its lock per user-data dir, so two
instances with different `--user-data-dir` values run independently side by
side (this has not been independently smoke-verified in this task; verify it
as part of Act 2). Two ways to get two instances:

**A. Dev harness, two terminals** (fastest, good for Acts 1–9):
```bash
cd /Users/patrick/code/pear-wallpaper/desktop
npm run dev -- --user-data-dir=/tmp/pw-qa-a   # "device A"
# second terminal
npm run dev -- --user-data-dir=/tmp/pw-qa-b   # "device B"
```
(`npm run dev` is `electron-forge start`; args after the first `--` go to
`electron-forge start`'s own `--`, which forwards to the launched Electron
process argv — confirm your installed `@electron-forge/cli` version still
forwards this way if it doesn't work as written.)

**B. Built `.app`, two copies** (required for Acts 10–11):
```bash
cd /Users/patrick/code/pear-wallpaper/desktop
npm run make
# out/Pear Wallpaper-darwin-<arch>/Pear Wallpaper.app is the product
open -n "out/Pear Wallpaper-darwin-arm64/Pear Wallpaper.app" --args --user-data-dir=/tmp/pw-qa-a
open -n "out/Pear Wallpaper-darwin-arm64/Pear Wallpaper.app" --args --user-data-dir=/tmp/pw-qa-b
```
(`open -n` forces a new instance even though macOS would normally coalesce
launches of the same bundle; `--args` passes the rest through to Electron.)
Two physical Macs work too — then neither needs `--user-data-dir`, each just
uses its own default `~/Library/Application Support/Pear Wallpaper`.

## Act 1 — Boot + IPC round-trip (device A only)

```bash
cd /Users/patrick/code/pear-wallpaper/desktop
npm run dev
```

Expect:
1. A window opens rendering **Onboarding** (Create a group / Join a group)
   — not blank, no devtools console error. This alone *is* most of the IPC
   check: `ui/app.js` calls `bridge.call('getState')` on load and only
   re-renders from the result, so Onboarding painting at all means the
   round trip (`renderer → preload → ipcMain → workerPipe → Bare worker →
   bridge-main → core.getState()` and back) completed.
2. A tray icon appears (menu: Open Pear Wallpaper / Sync now / Quit —
   `main.js`'s `createTray()`).
3. To directly confirm a **real `deviceKey`** came back (not just that
   *something* rendered), open DevTools (View → Toggle Developer Tools, or
   `Cmd+Option+I`) and in the console:
   ```js
   window.bridgeTransport.onMessage((m) => console.log(m))
   window.bridgeTransport.send({ t: 'req', id: 999, cmd: 'getState', args: [] })
   ```
   Expect a logged `{ t: 'res', id: 999, ok: true, result: { deviceKey: '<64-hex-char string>', groupStatus: 'none', ... } }` frame — a real key, not `undefined`/empty.

Leave A running for Act 2.

## Act 2 — Pairing across two instances

Start device B (Setup, option A or B). B's window also opens to Onboarding.

**On A:** click **Create a group**. An invite string + QR code appear
inline under the button.

**On B:** paste the invite string into the "Paste invite" box, click
**Join a group**. The button reads **"Joining…"** and the input disables.

**On A:** the Devices tab (reachable once A is a member — Create a group
routes A's window straight to `MainView`) shows a "`<name>` wants to join"
row with **Approve**/**Deny**. Click **Approve**.

**On B:** "Joining…" resolves; B routes to `MainView`.

**Both:** Devices tab roster shows both devices, each with an online dot.

## Act 3 — Send A→B

**On A**, Send tab: drag an image onto the dropzone, or click it to browse
— **see the carried Send.js defect noted at the top of this file**; if
both are broken today, that's expected, re-test after the fix wave. If a
path does resolve, check B as a target and click **Send**.

**On B**, first send ever: macOS prompts *"Pear Wallpaper" wants to control
"System Events"* (the `osascript`/AppleScript setter in
`lib/platform/darwin.js`, invoked from inside the Bare worker via the
`bare-subprocess`-backed `child_process` shim, `lib/compat/child_process.js`)
— click **Allow**. Without this the setter's `osascript` call rejects and
the send never reaches `delivered`.

Confirm: **B's desktop wallpaper changes** to the sent image.

**On A**, Send tab: the target row for B flips to **`delivered`** (from
`snapshot.sends[].targets[].status`, pushed by the worker's `state` event
after the `send-updated` core event).

## Act 4 — Send B→A

Repeat Act 3 in the other direction. A's Automation prompt is separate from
B's — expect it fresh on A's first send if A has never sent before. Confirm
A's wallpaper changes and B's Send tab shows the delivered flip.

## Act 5 — osascript/launchctl under the Bare worker (MUST-SMOKE, carried from Task 3)

This is new risk surface from the pivot: the wallpaper setter and
login-item manager (both reused unmodified from the pre-pivot shell) now run
inside a **Bare** worker process via the `bare-subprocess`-backed
`child_process` compat shim (`lib/compat/child_process.js`), not real
Node — only the shim's **failure** branch (a `launchctl print` for a
nonexistent label) has been exercised end-to-end so far (per
`progress.md`'s Task 3 entry). Confirm the **success** paths, which Acts 3–4
and 10 exercise but call out explicitly here:
- `platform.setWallpaper(filePath)` (`lib/platform/darwin.js`'s `osascript`
  call) actually changes the wallpaper (Act 3/4 above) — i.e. `execFile`'s
  success branch in the shim resolves `{ stdout, stderr }` correctly, not
  just its error branch.
- `setLoginAtLogin(true)` (Act 10 below) actually writes+bootstraps the
  plist via `launchctl` invoked from inside the worker, not just
  `enable()`'s call resolving without throwing.

If either only ever appears to work by never throwing (rather than the OS
effect actually happening), that's this gap, not a false pass.

## Act 6 — Background delivery while B's window is hidden

**On B:** close the window (the red traffic-light button, not Quit).
Confirm:
- The window disappears but the **process keeps running** (`ps aux | grep
  -i "Pear Wallpaper"` or Activity Monitor) — `main.js`'s `win.on('close', …)`
  calls `e.preventDefault(); win.hide()` unless `app.isQuitting` was set by
  tray Quit.
- The tray icon is still there; no dock icon (`app.dock.hide()`).

**On A**, with B's window still hidden: send another image to B (Act 3's
steps, defect notwithstanding — or trigger a send via the same test-only
`window.bridgeTransport.send(...)` console snippet from Act 1 if the
picker path is broken). Confirm **B's wallpaper still changes** — the
worker's sync engine (`lib/sync-engine.js`) applies pending wallpapers off
`core`'s `'wallpaper'` event regardless of renderer window visibility; this
is the background/tray-only path, independent of the foreground window.

Reopen B via **tray → Open Pear Wallpaper** — confirm the Received tab now
lists the wallpaper that applied while hidden.

## Act 7 — Sleep/wake B

**On B:** put the Mac to sleep (or just the display, for a same-Mac test —
actual system sleep is the real test of `powerMonitor`). **On A:** send a
wallpaper to B while B is asleep. Wake B. Confirm the queued send applies
shortly after wake: `main.js`'s `powerMonitor.on('resume', …)` sends the
worker a `syncNow` frame immediately on wake, so this should be near-
instant, not waiting for the sync engine's periodic timer.

## Act 8 — Tray menu

With A running: tray → **Open Pear Wallpaper** reopens/focuses the window.
Tray → **Sync now** sends the worker a `syncNow` frame directly from
`main.js` (bypassing the renderer entirely) — confirm no error appears
(nothing pending, so no visible change is expected).

Tray → **Quit**: sets `app.isQuitting = true` then `app.quit()`, which fires
`main.js`'s `before-quit` handler — this sends the worker `{ t: 'shutdown' }`
and waits (up to a 2s fallback) for the worker to exit before the app
process actually exits. Confirm:
- The app fully quits (no lingering process in Activity Monitor / `ps aux`).
- Terminal/log output shows the worker actually ran `engine.stop()`/
  `await core.close()` before exiting, not just a forced kill (add a
  temporary `console.error` in `worker/core-host.js`'s shutdown handler if
  the existing logging isn't enough to tell — this is the graceful-teardown
  path called out as risky in `progress.md`'s Task 3 notes).

## Act 9 — Single-instance

With A running (same `--user-data-dir`, if you used one), launch a second
instance the same way. Expect: no second window; the existing window is
focused instead (`app.requestSingleInstanceLock()` / `second-instance`
handler in `main.js`). This is Electron's own lock, not the retired pidfile
module (`lib/single-instance.js`, kept in-tree but unused in the boot path).

## Act 10 — Launch at login (built `.app` only)

Using a copy from Setup option B, Settings tab: toggle **Launch at login**
on. Confirm:
```bash
ls -la ~/Library/LaunchAgents/com.pear-wallpaper.plist
cat ~/Library/LaunchAgents/com.pear-wallpaper.plist
```
`ProgramArguments` should be a single-element array naming the **built `.app`
executable** (`.../Pear Wallpaper.app/Contents/MacOS/Pear Wallpaper` —
whatever `app.getPath('exe')` resolved to for that copy), *not* a `pear`
binary or `pear://` link — that's the post-pivot change from the old
`pear run pear://<key>` target. `launchctl print
gui/$(id -u)/com.pear-wallpaper` should report it loaded. Toggle off and
confirm the plist is removed (`launchctl bootout` + unlink, per
`lib/login-item.js`, reused unmodified).

## Act 11 — OTA (MUST-SMOKE)

`pear-runtime-updater` self-describes as **"VERY EXPERIMENTAL, MOST
DEFINITELY WILL CHANGE"** (its own README) — treat this act as genuinely
unverified territory, not a formality. Also: the moment `main.js` constructs
`new PearRuntime({...})` (right after the window opens, guarded so a
network failure there can't block boot), it **joins a Hyperswarm DHT swarm**
to watch the upgrade link — this happens even under plain `npm run dev`, not
only for a packaged build (only `applyUpdate()` itself is packaged-only).

An upgrade link is already minted and in `package.json`'s `upgrade` field
(`pear://fi59t69fhb7dcbuqzhd8rqci9ikyp3pkuq7gj4sjhmjhbmhjkyto`) — no need to
re-run `pear touch` unless starting a fresh link.

1. **Build once, install it** (this is the "currently running instance"
   that will detect the update):
   ```bash
   cd /Users/patrick/code/pear-wallpaper/desktop
   npm run make
   # copy/run out/Pear Wallpaper-darwin-<arch>/Pear Wallpaper.app somewhere stable
   open "out/Pear Wallpaper-darwin-arm64/Pear Wallpaper.app"
   ```
2. **Make a change** (anything — a UI string is enough to see the flow),
   then build a deployment folder per `pear-runtime`'s documented layout —
   `/package.json` + `/by-arch/<platform>-<arch>/app/<name-with-extension>`
   (`<name-with-extension>` = `Pear Wallpaper.app` on macOS; `main.js`'s
   `updaterAppName()` derives this — note `pear-runtime`'s own README
   example comment says "productName" but the updater's actual code wants
   the filename **with extension**, per `progress.md`'s Task 6 note; go with
   the extension form) — and stage it:
   ```bash
   pear stage pear://fi59t69fhb7dcbuqzhd8rqci9ikyp3pkuq7gj4sjhmjhbmhjkyto .
   ```
3. **Seed it** from an always-on machine so the running instance can
   actually fetch it:
   ```bash
   pear seed pear://fi59t69fhb7dcbuqzhd8rqci9ikyp3pkuq7gj4sjhmjhbmhjkyto
   ```
4. On the running installed instance, wait for the background updater —
   `pear.updater.on('updated', …)` in `main.js` forwards an `update-ready`
   event to the renderer once the new bundle is downloaded. Confirm
   **Settings shows "Update available — restart to apply"** with a
   **Restart** button (`ui/components/Settings.js`).
5. Click **Restart**. Confirm: `restartToUpdate` (intercepted in `main.js`'s
   `ipcMain.on('bridge:to-main', …)` before it would otherwise reach the
   worker) calls `pear.updater.applyUpdate()`, then `app.relaunch()` +
   `app.quit()`. The app should come back up running the changed build.

If step 4/5 never happens, check: is the instance actually packaged
(`app.isPackaged`)? Is the seeder still running? Did `pear stage` target the
right link? This is the highest-uncertainty path in the whole app — file
findings rather than assuming user error.

## Act 12 — Revoke

**On A** (the creator), Devices tab: click **Remove** next to B. Confirm:
- A's roster now shows one device.
- B's next connection attempt is refused at the gate — B's online dot goes
  stale/offline and a fresh send from A to B never reaches `delivered`
  (same core behavior as `qa-pairing.md` Act 6, now surfaced through the
  desktop UI).
- Send a wallpaper from A "to" B (if still selectable) — B does not
  receive it.

## Act 13 — Re-apply (offline)

**On B**, disconnect from the network (Wi-Fi off) or just don't require
it — re-apply is local-only. Received tab: click **Re-apply** on a
previously-received wallpaper. Confirm the wallpaper changes with **no
network activity** — `reapply` in `lib/bridge-main.js` calls
`platform.setWallpaper(item.filePath)` directly against the already-stored
local file; it never touches `core.sync()` or the swarm.

## Cleanup

```bash
rm -rf /tmp/pw-qa-a /tmp/pw-qa-b
launchctl bootout gui/$(id -u)/com.pear-wallpaper 2>/dev/null
rm -f ~/Library/LaunchAgents/com.pear-wallpaper.plist
# if you built/copied .app bundles for this script, remove them too
```

## Known limits of this script

- **Act 3/6's Send picker is expected broken** until the `Send.js`
  `resolveFilePath`/`pear-electron` fix lands (see the note at the top) —
  re-run this script's Acts 3, 4, and 6 after that fix wave, using the real
  picker/drop instead of the console workaround.
- **Act 11 (OTA)** exercises `pear-runtime-updater` end-to-end for the first
  time outside of source-reading (`progress.md`'s Task 6 entries); the
  deployment-folder layout (`/by-arch/<arch>/app/<name>`) has only been
  cross-checked against the library's docs/source, never against a real
  `pear stage` of this app's own `npm run make` output.
- **Act 10 (login-item)** only writes/removes the plist correctly against a
  *built* `.app`'s real executable path — this was true pre-pivot too, just
  against a different target (`pear://<key>` before, the `.app` binary now).
