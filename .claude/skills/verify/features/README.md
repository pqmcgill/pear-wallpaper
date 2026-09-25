# Pear Wallpaper desktop verification map

This directory is the maintained source for verifying the user-facing behavior of the pear-wallpaper macOS desktop app. Read this index before driving the app, then use the matching feature file as the recipe.

## Baseline preconditions

- `desktop/`, `core/`, and `bridge/` have `node_modules` (`npm install` in each, or `desktop/` alone when the `file:` links resolve).
- The Mac has internet access. Pairing and delivery use the public Hyperswarm DHT.
- `pw start-run` has created a fresh run and saved the current wallpaper.
- Each instance was started by `pw launch <name>` in this run. It uses `--user-data-dir=.verify-runs/<run>/userdata/<name>`, and its device name is `verify-<name>`.
- `pw doctor` passes for every instance you will drive.
- Never drive a Pear Wallpaper instance that this run did not start.

## Driving conventions

- `pw` means `.claude/skills/verify/bin/pw`, run from the repo root.
- Start every recipe from the state its preconditions name. Most recipes need a paired pair of devices. Get one with [pairing](./pairing.md) first.
- Target elements by exact visible text or input placeholder, never by coordinates.
- Two buttons read `Send`: the nav tab is `nth 0` and the submit button is `nth 1`.
- Wait with `pw wait` on visible text. DHT discovery time varies from about 5 to 60 s.
- Never perform the action under test through `window.bridgeTransport` or `pw eval`. Those are for reading state only.

## Proof and skip reporting

- Capture the screen before and after the action with `pw shot`. Each shot writes a PNG and the screen text.
- For a mutation, check a second view: the other device's screen, `pw state`, or the OS (the desktop picture, files under the userdata directory).
- A wallpaper proof matches the fixture's sha256 against `pw wallpaper --save`.
- When the app's real behavior is a known product bug, the feature file says what actually happens and links the GitHub issue (`pqmcgill/pear-wallpaper`). Don't write the recipe as if the bug were fixed.
- Report any entry point you could not reach (tray menu, native file dialog, drag-and-drop, built `.app`) as unverified, with the reason.

## Feature entry contract

Each feature file starts with an H1 title and one paragraph describing the user-visible behavior. It then has exactly four H2 sections, in this order:

1. `Sub-features`: short IDs, one line per behavior.
2. `How to get to it (user POV)`: every user entry point.
3. `Driving it with pw`: starts with `Preconditions:`, then labeled bullets that pair each user action with an exact command and the result you can observe.
4. `Gotchas`: traps that can waste a verification run or make it invalid.

## Features

- [Create a group](./create-group.md): first-run Onboarding, creating a group, and becoming its creator.
- [Pair a device](./pairing.md): invite, join, approve or deny, and remove (revoke) a device.
- [Send a wallpaper](./send-wallpaper.md): pick an image, choose targets, delivery status, and the real desktop picture change.
- [Received and re-apply](./received.md): the received list and applying a past wallpaper again, offline.
- [Settings](./settings.md): device name and key, launch at login, last sync, and the OTA restart affordance.

## Not drivable with pw

- Tray menu (Open, Sync now, Quit) and close-to-tray. These are native macOS UI, and CDP can't reach them. Use `docs/notes/qa-desktop.md` Acts 6 and 8 by hand.
- Launch at login and OTA need a built `.app`. See `qa-desktop.md` Acts 10 and 11.
- Sleep/wake (`powerMonitor` resume) needs real system sleep.
