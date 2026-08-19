# QA script: desktop shell (Tasks 1–11)

Two Pear app instances = two devices, exactly as in `qa-pairing.md`, but
this time it's the real `pear-wallpaper` GUI app, not a Node REPL. Needs a
Mac with the Pear runtime installed and `pear` on `PATH`. Uses the real
hyperswarm DHT — needs internet; first discovery can take ~10–60s.

> **Load-bearing unverified assumption:** the whole renderer↔main IPC rides
> a `pear-pipe`-backed duplex handed back by `runtime.start()` (see
> `task-9-report.md` for the full citation trail — it's built from reading
> `pear-electron`'s source, never from a live run). **Act 1** is the single
> step that proves or disproves it. If the window is blank or the console
> shows a module-resolution error for `pear-pipe` (or `pear-electron`)
> inside `ui/app.js`, that's the first-failure signature — the transport
> theory in `lib/pear-transport.js` / `task-9-report.md` is what to revisit,
> not the bridge command logic (that's unit-tested and independent of the
> transport it rides on).

> **Two other runtime unknowns to keep an eye out for while running this
> script**, both flagged by their implementers as unverifiable without a
> live GUI:
> - **`File.path` in the renderer** (`ui/components/Send.js`): browse/drop
>   assumes an Electron `File` object exposes `.path`. If it doesn't, browse
>   and drag-drop both fail the same way (they share the code path) — that's
>   a real gap, not a QA false negative; see CONFLICT-3 in `progress.md`.
> - **Tray icon path resolution** (`ui/app.js`'s
>   `iconPath: 'ui/trayTemplate.png'`): relative to an unconfirmed cwd. If
>   the tray icon is missing/broken but the menu still works, that's this,
>   not a functional bug — `trayTemplate.png` is also a generated
>   placeholder shape, not real iconography.

## Setup — two separate storage dirs

Pear app storage is per-app (`Pear.config.storage`), not per-launch, so two
instances of the same app collide on the same storage (and the
single-instance lock in `lib/single-instance.js` will refuse the second
one) unless each points at its own storage dir. `pear run` has a built-in
flag for this — `--store|-s <path>` — so no code changes are needed:

```bash
# Terminal A ("desktop")
cd /Users/patrick/code/pear-wallpaper/desktop
pear run --dev . --store /tmp/pw-qa-desktop/a

# Terminal B ("phone") — separate storage, on the same Mac
cd /Users/patrick/code/pear-wallpaper/desktop
pear run --dev . --store /tmp/pw-qa-desktop/b
```

(Two physical Macs work too — then each just uses its own default storage
dir and the `--store` flag isn't needed.)

## Act 1 — Boot + IPC (single instance, A only)

```bash
cd /Users/patrick/code/pear-wallpaper/desktop
pear run --dev . --store /tmp/pw-qa-desktop/a
```

Expect, in order:
1. Terminal log: `[pear-wallpaper] booted; deviceKey=<hex> status= none`.
2. A window opens rendering **Onboarding** (Create a group / Join a group)
   — not a blank page, not a console error.
3. That render only happened because `bridge.call('getState')` round-tripped
   over the pipe (`ui/app.js` calls it on load and re-renders from the
   result) — so step 2 *is* the IPC check; no separate action needed.
4. A tray icon appears (menu: Open Pear Wallpaper / Sync now / Quit).

Leave A running for Act 2.

## Act 2 — Pairing across two instances

Terminal B:
```bash
pear run --dev . --store /tmp/pw-qa-desktop/b
```
B's window also opens to Onboarding.

**On A:** click **Create a group**. An invite string + QR code appear
inline under the button.

**On B:** paste the invite string into the "Paste invite" box, click
**Join a group**. The button reads **"Joining…"** and the input disables
— this is B's "waiting" state (owned locally by `Onboarding`, not the
separate `Waiting` screen; that route is only for a restart-resumed join —
see CONFLICT-2 in `progress.md`).

**On A:** the Devices tab (only reachable once A is a member — A's window
routes straight to `MainView` after Create a group) shows a "`<name>`
wants to join" row with **Approve**/**Deny**. Click **Approve**.

**On B:** "Joining…" resolves; B routes to `MainView`.

**Both:** Devices tab roster shows both devices, each with an online dot.

## Act 3 — Send A→B

**On A**, Send tab: drag an image onto the dropzone (or click it to browse
— see the `File.path` caveat above), check B as a target, click **Send**.

**On B**, first send ever: macOS prompts *"pear-wallpaper" wants to control
"System Events"* (the `osascript`/AppleScript wallpaper setter in
`lib/platform/darwin.js` tells System Events to set the desktop picture) —
click **Allow**. This is the one-time Automation permission; without it the
setter's `osascript` call rejects and the send never reaches `delivered`.

Confirm: **B's desktop wallpaper changes** to the sent image.

**On A**, Send tab: the target row for B flips from its prior status to
**`delivered`** (read from `snapshot.sends[].targets[].status`, pushed by
the `send-updated` event → `bridge`'s state refresh).

## Act 4 — Send B→A

Repeat Act 3 in the other direction (B sends, A is the target). A's
Automation prompt is separate from B's — expect it fresh on A's first send
if A has never sent before. Confirm A's wallpaper changes and B's Send tab
shows the delivered flip.

## Act 5 — Background delivery while B's window is hidden

**On B:** close the window (the red traffic-light button, not Quit).
Confirm:
- The window disappears but the **process keeps running** — `ps aux | grep
  -i pear` (or Activity Monitor) still shows it; `pear.gui.closeHides:
  true` in `package.json` is what does this.
- The tray icon is still there.

**On A**, with B's window still hidden: send another image to B (Act 3's
steps). Confirm **B's wallpaper still changes** — the sync engine
(`lib/sync-engine.js`) applies pending wallpapers via `core`'s `'wallpaper'`
event regardless of whether the renderer window is visible; this proves
the background/tray-only path, not just the foreground-window path.

Reopen B via **tray → Open Pear Wallpaper** — confirm the Received tab now
lists the wallpaper that applied while hidden.

## Act 6 — Sleep/wake B

**On B:** put the Mac to sleep (or just B's display, if testing on one
Mac — actual system sleep is the real test). **On A:** send a wallpaper to
B while B is asleep. Wake B. Confirm the queued send applies shortly after
wake — the periodic sync timer (`intervalMs` default 180s in
`sync-engine.js`) or a fresh `'wallpaper'` event on reconnect drives this;
give it up to that interval if it doesn't apply immediately.

## Act 7 — Launch at login

**On B** (or either device), Settings tab: toggle **Launch at login** on.
Confirm:
```bash
ls -la ~/Library/LaunchAgents/com.pear-wallpaper.plist
cat ~/Library/LaunchAgents/com.pear-wallpaper.plist   # ProgramArguments should be [pearBin, 'run', 'pear://<key>']
```
plist exists and `launchctl print gui/$(id -u)/com.pear-wallpaper` reports
it loaded.

**Important caveat:** the `ProgramArguments` invoke `pear run
pear://<key>` — a `pear://` link only resolves against a **staged**
release (`pear stage <channel> .` from the app dir, or `pear release`), not
a `pear run --dev .` dev session. Validate this act against a staged
build, not the dev loop used for the rest of this script. Toggle off and
confirm the plist is removed (`launchctl bootout` + unlink).

## Act 8 — Tray menu + single-instance

With A running: tray → **Open Pear Wallpaper** reopens/focuses the window.
Tray → **Sync now** triggers a sync pass (no visible change expected with
nothing pending; just confirm no error).

With A still running, open a second terminal and run the *same* store:
```bash
pear run --dev . --store /tmp/pw-qa-desktop/a
```
Expect it to print `another instance is already running; exiting` and exit
immediately — no second window. Tray → **Quit** on A: process should fully
exit; `/tmp/pw-qa-desktop/a/app.lock` should be gone afterward (confirms
`Pear.teardown` ran `engine.stop()` / `lock.release()` / `core.close()`).

## Act 9 — Revoke

**On A** (the creator), Devices tab: click **Remove** next to B. Confirm:
- A's roster now shows one device.
- B's next connection attempt is refused at the gate (per
  `qa-pairing.md` Act 6 — same core behavior, now surfaced through the
  desktop UI: B's online dot goes stale/offline and a fresh send from A to
  B never reaches `delivered`).
- Send a wallpaper from A "to" B (if still selectable) — B does not
  receive it.

## Act 10 — Re-apply (offline)

**On B**, disconnect from the network (Wi-Fi off) or just don't require
it — re-apply is local-only. Received tab: click **Re-apply** on a
previously-received wallpaper. Confirm the wallpaper changes with **no
network activity** — `reapply` in `lib/bridge-main.js` calls
`platform.setWallpaper(item.filePath)` directly against the already-stored
local file; it never touches `core.sync()` or the swarm.

## Cleanup

```bash
rm -rf /tmp/pw-qa-desktop
launchctl bootout gui/$(id -u)/com.pear-wallpaper 2>/dev/null
rm -f ~/Library/LaunchAgents/com.pear-wallpaper.plist
```

Not QA-able without a staged/released build: the actual `pear://<key>`
resolution inside the LaunchAgent's `ProgramArguments` (Act 7 only verifies
the plist is written/removed correctly against a dev session's best-effort
`pearBin` guess).
