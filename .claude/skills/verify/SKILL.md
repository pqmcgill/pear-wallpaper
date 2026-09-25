---
name: verify
description: Drive the real pear-wallpaper macOS desktop app (Electron shell + Bare worker + real Hyperswarm DHT) the way a user does — launch isolated instances, pair them, send a wallpaper, and capture proof (screenshots, screen text, worker state, the Mac's actual desktop picture). Use whenever a change to desktop/, bridge/, or core/ needs proving in the running app, not just in brittle tests.
---

# verify — drive the pear-wallpaper desktop app

Everything goes through one zero-dependency helper, `.claude/skills/verify/bin/pw` (Node 22, raw CDP over the global `WebSocket`). Run it from the repo root. In examples below, `P=.claude/skills/verify/bin/pw`.

Primary surface: the desktop renderer (Preact UI in Electron). Other surfaces, not covered here: the Android shell (`android/`, driven via `adb` — see `docs/notes/qa-android.md`), the tray menu, and the built `.app` (launch-at-login, OTA — see `docs/notes/qa-desktop.md` Acts 10–11). The tray is a native menu and CDP can't reach it.

Read [`features/README.md`](features/README.md) before driving anything. It lists every feature and its recipe.

## What is real (read this first)

- **The wallpaper change is real.** When an instance receives a wallpaper, its worker runs `osascript` and changes the desktop picture of **this Mac, every display**. `pw start-run` saves the current wallpaper once, to `.verify-runs/original-wallpaper.json` plus a copy. It skips this when the current picture was set by a verify run. `pw cleanup` restores that saved original. If none was ever saved, cleanup warns. Tell the user before a run that sends wallpapers.
- **The network is real.** Pairing and delivery use the public Hyperswarm DHT. You need internet access. First discovery takes about 5–60 s, so wait on visible text, not fixed sleeps.
- **macOS Automation permission.** The first `osascript` call from `Electron.app` prompts for permission to control "System Events". On this machine it has already been granted. If a send never reaches `delivered` and the log shows an osascript error, the user must approve the prompt. You can't click it.

## Launch

```bash
P=.claude/skills/verify/bin/pw
$P start-run            # new run dir .verify-runs/<ISO-timestamp>/, snapshots the current wallpaper
$P launch a             # instance "a" (device name verify-a); prints {pid, port, userData, log}
$P launch b             # second isolated instance (device name verify-b)
```

`launch` runs `desktop/node_modules/electron/.../Electron . --user-data-dir=<run>/userdata/<name> --remote-debugging-port=<free port>` in `desktop/`. This is what `npm run dev -- -- --user-data-dir=…` does, without forge's wrapper process. Before launching, it writes `device-name.txt` (`verify-<name>`), which is the documented way to name a device before it joins. `launch` returns once the renderer has left the `Starting…` screen and mounted Onboarding, Waiting, or MainView (60 s timeout). If launch fails, read the log path it prints.

Prereq: run `npm install` in `desktop/` (it pulls `core/` and `bridge/` in through `file:` links, and those need their own `node_modules`). No build step is needed.

**Isolation.** Each instance gets its own `--user-data-dir`, so it has its own corestore, device key, and single-instance lock. Instances from separate runs don't share state. `start-run` refuses to start while the previous run still has live instances. `pw` only ever touches instances listed in `<run>/instances/*.json`, so it never drives the user's own Pear Wallpaper instance.

## Doctor

```bash
$P doctor        # all instances in the current run; or: $P doctor a
```

This check is read-only. For each instance it checks that the pid is alive and is our Electron (the command line contains our `--user-data-dir`), that a `bare` worker exists in its process group, which view the renderer shows (`starting`, `worker-stopped`, `onboarding`, `waiting`, or `main`), and that the worker answers `getState` with a 64-hex device key. It exits non-zero on any FAIL. Run it first whenever something looks wrong.

## Drive

All actions go through the real renderer: real mouse events at element centers, typed text, and the real `<input type=file>`.

| Command | What it does |
|---|---|
| `$P click <inst> "<exact text>" [nth]` | Mouse-clicks the visible button, label, or `aria-label` with that exact text. When several match, `nth` is 0-based: the nav tab `Send` is `0` and the Send-tab submit button is `1`. A roster name (such as `verify-b`) clicks that row's checkbox label. The command fails loudly if the element is missing or disabled. |
| `$P fill <inst> "<placeholder>" "<value>"` | Clicks the input with that placeholder, selects all, and types the value. |
| `$P file <inst> <path>` | Sets the Send tab's file input, the same as picking a file in the browse dialog. This path goes through `webUtils.getPathForFile` in preload. Never click the dropzone label, because that opens a native dialog. |
| `$P wait <inst> "<text>" [sec]` | Polls `document.body.innerText` until the text appears (default 90 s). On timeout it prints the screen. |
| `$P text <inst>` | Prints the current screen text. |
| `$P state <inst>` | Prints the worker's `getState` snapshot. **Observation only.** |
| `$P read <inst> "<css>" [sec]` | Waits for the selector to render (default 30 s) and prints its text. Use it for values that appear only after a worker round trip, such as the invite: `INV=$($P read a ".invite-block code")`. |
| `$P eval <inst> "<js>"` | Evaluates JS in the renderer and prints the JSON result. Use it for one-off reads that are already on screen. |
| `$P fixture <label>` | Writes a PNG with a unique solid color to `artifacts/<label>.png` to use as a send payload. |
| `$P hash <files…>` | Prints the sha256 of each file, to match the sent file against what landed. |
| `$P wallpaper [--save <label>]` | Prints the Mac's current desktop picture path. `--save` copies it into artifacts. |

Handles come from `desktop/ui/components/*.js`: button text (`Create a group`, `Join a group`, `Create invite`, `Approve`, `Deny`, `Remove`, `Re-apply`, `Restart`, tabs `Devices`/`Send`/`Received`/`Settings`), the `Paste invite` placeholder, and classes `.invite-block code`, `.status`, `.error`, `.error-banner`, `.last-sync`. If a UI string changes, update this skill and the feature map in the same change.

Never perform the action under test with `window.bridgeTransport.send(...)` or `$P eval` bridge calls. That skips the UI. Bridge calls are only for reading state.

## Evidence

All proof goes to `.verify-runs/<run>/artifacts/` (gitignored). `.verify-runs/current` names the active run. Cleanup keeps this directory.

- `$P shot <inst> <label>` writes `<inst>-<label>.png` (renderer screenshot) plus `<inst>-<label>.txt` (screen text).
- Logs are in `.verify-runs/<run>/logs/<inst>.log` (Electron main plus the worker's stderr).

Proof standards:
- Use the real user path: click, type, pick a file. Capture the screen **before and after** the action (for example `a-send-ready` then `a-delivered`), not only the final screen.
- Check side effects as well as what's on screen. For a send, that means: the sender's row shows `delivered`, the receiver's `$P state` lists the item in `received` with `appliedAt`, `$P wallpaper --save` shows the Mac's picture is now the receiver's `received/<id>.png`, and `$P hash` shows it's byte-identical to the fixture.
- Nothing here is mocked. The DHT, autobase, hyperblobs, and osascript are all real. No dry-run mode exists.
- Report any entry point you did not drive as unverified. Don't count it as proven through a different path.

## Cleanup

```bash
$P stop a      # one instance
$P cleanup     # all instances in the run, delete userdata/, restore wallpaper; artifacts kept
```

`stop` sends SIGTERM to the recorded Electron pid, which runs `before-quit` and sends the worker `{t:'shutdown'}`. If the process group is still alive after 5 s, it SIGKILLs **that process group** (the Electron app plus its bare worker). It never kills by process name. `cleanup` then deletes `<run>/userdata/` (corestores, received images) and restores the saved original wallpaper. It keeps `artifacts/` and `logs/`. Run `cleanup` after every run, including failed ones. To check that nothing is left: `pgrep -fl verify-runs` should print nothing.

Old runs pile up in `.verify-runs/`. Delete them by hand when the user no longer needs the evidence.
