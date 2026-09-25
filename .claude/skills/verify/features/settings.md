# Settings

The Settings tab shows this device's name and key, a `Launch at login` toggle, the last sync time, and, when an OTA update has downloaded, `Update available — restart to apply` with a `Restart` button.

## Sub-features

- `settings-identity`: `Device name: verify-<name>` and a 64-hex `Device key`.
- `settings-last-sync`: `Last synced:` shows `never` or a locale timestamp.
- `settings-login-item`: `Launch at login` writes or removes `~/Library/LaunchAgents/com.pear-wallpaper.plist`.
- `settings-update-ready`: the restart prompt after an OTA download (built `.app` only).

## How to get to it (user POV)

- `Settings` tab (in MainView, so the device must be a group member).

## Driving it with pw

Preconditions:

- Instance `a` is a member ([create-group](./create-group.md)).

- **Identity.** Run `pw click a "Settings"` and `pw shot a settings`. The screen text contains `Device name: verify-a` and a `Device key` that equals `deviceKey` in `pw state a`.
- **Last sync.** Read `pw eval a "document.querySelector('.last-sync').innerText"`.
- **Login item (do not run under dev).** The toggle is `pw click a "Launch at login"`. Under `pw launch`, the plist would point at the dev `Electron` binary and change the user's real login items. Only drive this against a built `.app`, following `docs/notes/qa-desktop.md` Act 10.

## Gotchas

- `Launch at login` writes to the user's real `~/Library/LaunchAgents`. If you toggled it, clean up with `launchctl bootout gui/$(id -u)/com.pear-wallpaper; rm -f ~/Library/LaunchAgents/com.pear-wallpaper.plist`.
- `settings-update-ready` needs a staged and seeded OTA bundle and a packaged app. pw can't produce that state.
- Not yet driven. Recipes come from `desktop/ui/components/Settings.js`.
