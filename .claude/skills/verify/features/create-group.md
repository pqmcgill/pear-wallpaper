# Create a group

On first launch the app shows Onboarding. Choosing `Create a group` makes this device the creator of a new private group and routes to the main tabbed view, where this device is the only roster entry.

## Sub-features

- `onboarding-render`: a fresh device shows the title, `Create a group`, the `Paste invite` input, and `Join a group`.
- `create-group`: creating a group routes to MainView with this device marked `(this device) · creator`.
- `create-inline-invite`: after creating, Onboarding is meant to show an invite and QR under the button (see Gotchas).

## How to get to it (user POV)

- Launch the app with a fresh profile. Onboarding is the first screen.
- Click `Create a group`.

## Driving it with pw

Preconditions:

- A fresh instance `a` from `pw launch a`. `pw doctor a` reports `renderer view: onboarding`.

- **Onboarding renders.** Look at the first screen. Run `pw shot a onboarding`. The `.txt` contains `Pear Wallpaper`, `Create a group`, and `Join a group`.
- **Create.** Click the button. Run `pw click a "Create a group"`, then `pw wait a "(this device) · creator" 30`. The screen shows the tabs `Devices Send Received Settings` and one roster row, `verify-a (this device) · creator`.
- **Proof.** Run `pw shot a created` and `pw state a`. The state has `groupStatus: "member"`, a roster of 1, and `isCreator: true` on self.

## Gotchas

- The invite that Onboarding renders under `Create a group` is never visible. The worker's `state` push routes to MainView as soon as `createGroup` resolves, which unmounts Onboarding before `createInvite` returns. `docs/notes/qa-desktop.md` Act 2 still says the invite appears inline. That's wrong: get the invite from Devices → `Create invite` (see [pairing](./pairing.md)). Tracked as issue #20.
- `getState` reports `online: false` for self, and the online dot renders at zero width on every row, so online status can't be seen on screen (issue #15). Neither is a failed check.
- Verified live on 2026-09-25 (maintenance pass): onboarding render, create, and a roster of 1 with `isCreator: true`.
