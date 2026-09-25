# Settings

The Settings tab shows this device's name and key, a `Launch at login` toggle, the last sync time, and, when an OTA update has downloaded, `Update available — restart to apply` with a `Restart` button.

## Sub-features

- `settings-identity`: `Device name: verify-<name>` and a 64-hex `Device key`.
- `settings-last-sync`: `Last synced:` shows `never` or a locale timestamp. It updates on screen after every successful sync (the 3-minute timer, tray `Sync now`, wake) and when a wallpaper arrives over live replication.
- `settings-login-item`: `Launch at login` writes or removes `~/Library/LaunchAgents/com.pear-wallpaper.plist`.
- `settings-update-ready`: the restart prompt after an OTA download (built `.app` only).

## How to get to it (user POV)

- `Settings` tab (in MainView, so the device must be a group member).

## Driving it with pw

Preconditions:

- Instance `a` is a member ([create-group](./create-group.md)).

- **Identity.** Run `pw click a "Settings"` and `pw shot a settings`. The screen text contains `Device name: verify-a` and a `Device key` that equals `deviceKey` in `pw state a`.
- **Last sync.** Run `pw read b ".last-sync"` on a fresh member: it prints `never`. Send b a wallpaper from a ([send-wallpaper](./send-wallpaper.md)), then run `pw read b ".last-sync"` again: it prints a timestamp.
- **Login item (do not run under dev).** The toggle is `pw click a "Launch at login"`. Under `pw launch`, the plist would point at the dev `Electron` binary and change the user's real login items. Only drive this against a built `.app`, following `docs/notes/qa-desktop.md` Act 10.

## Gotchas

- `Launch at login` writes to the user's real `~/Library/LaunchAgents`. If you toggled it, clean up with `launchctl bootout gui/$(id -u)/com.pear-wallpaper; rm -f ~/Library/LaunchAgents/com.pear-wallpaper.plist`.
- A sync with no peers connected still stamps the time, because core doesn't report whether a peer took part.
- `settings-update-ready` needs a staged and seeded OTA bundle and a packaged app. pw can't produce that state.
- Verified live on 2026-09-25: identity, and last sync going from `never` to a timestamp when a wallpaper arrives. Login item and update-ready are unreachable under `pw launch` (they need a built `.app`).
