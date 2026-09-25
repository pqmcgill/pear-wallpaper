# Pair a device

The creator mints an invite, a second device pastes it and asks to join, and the creator approves or denies it. When approved, both devices show a two-device roster. The creator can later remove (revoke) a device.

## Sub-features

- `pair-invite`: Devices → `Create invite` shows an invite string and QR (creator only).
- `pair-join`: pasting the invite and clicking `Join a group` shows the Waiting screen on the joiner.
- `pair-candidate`: the creator sees `<name> wants to join` with `Approve` and `Deny`.
- `pair-approve`: approving routes the joiner to MainView, and both rosters list both devices.
- `pair-deny`: denying shows `The creator denied this device.` on the joiner.
- `pair-remove`: the creator's `Remove` drops the device from the roster, and later sends to it never reach `delivered`.

## How to get to it (user POV)

- Creator: `Devices` tab → `Create invite`, then copy the string, or scan the QR from Android.
- Joiner: on Onboarding, paste into `Paste invite` → `Join a group`.
- Creator: the `Devices` tab shows the candidate row with `Approve` and `Deny`, and each non-self row has `Remove`.

## Driving it with pw

Preconditions:

- Instance `a` has created a group ([create-group](./create-group.md)).
- Fresh instance `b` is on Onboarding. `pw doctor` passes for both.

- **Mint invite.** On a, open Devices and create an invite. Run `pw click a "Devices"` and `pw click a "Create invite"`, then `INV=$(pw eval a "document.querySelector('.invite-block code').innerText" | tr -d '"')`. `INV` is a long z-base-32 string, and a QR SVG renders under it. Run `pw shot a invite`.
- **Join.** On b, paste and join. Run `pw fill b "Paste invite" "$INV"` and `pw click b "Join a group"`. b shows `Waiting for an existing device to come online and approve this one…`.
- **Candidate appears.** Run `pw wait a "verify-b wants to join" 120`, then `pw shot a candidate`.
- **Approve.** Run `pw click a "Approve"`, then `pw wait b "Devices" 120`. b routes to MainView.
- **Proof.** Run `pw click b "Devices"` and `pw shot b paired`. The screen text of b lists `verify-b (this device)` and `verify-a · creator`, and the screen text of a lists `verify-b Remove`. `pw state b` has `groupStatus: "member"` and a roster of 2.
- **Deny (separate pair).** Repeat the steps up to the candidate with a fresh instance `c`, then run `pw click a "Deny"` and `pw wait c "The creator denied this device." 120`.
- **Remove.** On a, run `pw click a "Remove"`. a's roster drops to 1. Then send to b from a ([send-wallpaper](./send-wallpaper.md)). The send must not reach `delivered`. Wait at least 60 s before calling it.

## Gotchas

- `Remove` has no confirmation and can't be undone. That device must pair again with a fresh invite, using a fresh instance.
- With more than one non-self device, `pw click a "Remove"` removes the first row. Pass `nth`, or check which row with `pw text a` first.
- An invite works once (`INVITE_USED`). Mint a new one for each join.
- Approve and the joiner's route change run on DHT time. The candidate row can take up to about 60 s to appear.
- Verified end to end on 2026-09-25: invite, join, candidate, approve. Deny and remove have not been driven yet.
