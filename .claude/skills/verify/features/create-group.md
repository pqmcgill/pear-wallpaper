# Create a group

On first launch the app shows Onboarding. Choosing `Create a group` makes this device the creator of a new private group and routes to the main tabbed view, where this device is the only roster entry.

## Sub-features

- `onboarding-render`: a fresh device shows the title, `Create a group`, the `Paste invite` input, and `Join a group`.
- `create-group`: creating a group routes to MainView with this device marked `(this device) · creator`.
- `create-first-invite`: right after creating, the Devices tab makes an invite and shows it with a one-line instruction and a QR code.

## How to get to it (user POV)

- Launch the app with a fresh profile. Onboarding is the first screen.
- Click `Create a group`.

## Driving it with pw

Preconditions:

- A fresh instance `a` from `pw launch a`. `pw doctor a` reports `renderer view: onboarding`.

- **Onboarding renders.** Look at the first screen. Run `pw shot a onboarding`. The `.txt` contains `Pear Wallpaper`, `Create a group`, and `Join a group`.
- **Create.** Click the button. Run `pw click a "Create a group"`, then `pw wait a "(this device) · creator" 30`. The screen shows the tabs `Devices Send Received Settings` and one roster row, `verify-a (this device) · creator`.
- **First invite.** Run `pw read a ".invite-block code"`. It prints the invite without any extra click, and the invite wraps inside the 480 px window.
- **Proof.** Run `pw shot a created` and `pw state a`. The state has `groupStatus: "member"`, a roster of 1, and `isCreator: true` on self.

## Gotchas

- `Join a group` stays disabled until the invite box has text, so a click on it before `pw fill` fails as disabled.
- Every roster row shows a dot plus the word `online` or `offline`. Self always reads `online`.
- Verified live on 2026-09-25 (maintenance pass): onboarding render, create, and a roster of 1 with `isCreator: true`.
