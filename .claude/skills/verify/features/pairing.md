# Pair a device

The creator mints an invite, a second device pastes it and asks to join, and the creator approves or denies it. When approved, both devices show a two-device roster. The creator can later remove (revoke) a device.

## Sub-features

- `pair-invite`: Devices → `Create invite` shows an invite string and QR (creator only). Clicking it again after the invite was used mints a new one.
- `pair-join`: pasting the invite and clicking `Join a group` shows the Waiting screen on the joiner.
- `pair-candidate`: the creator sees `<name> wants to join` with `Approve` and `Deny`.
- `pair-approve`: approving routes the joiner to MainView, and both rosters list both devices.
- `pair-deny`: the joiner's request is rejected. On desktop the joiner shows no denial message and stays on the Waiting text (issue #12).
- `pair-remove`: the creator's `Remove` drops the device from the roster and from the Send tab's targets.

## How to get to it (user POV)

- Creator: `Devices` tab → `Create invite`, then copy the string, or scan the QR from Android.
- Joiner: on Onboarding, paste into `Paste invite` → `Join a group`.
- Creator: the `Devices` tab shows the candidate row with `Approve` and `Deny`, and each non-self row has `Remove`.

## Driving it with pw

Preconditions:

- Instance `a` has created a group ([create-group](./create-group.md)).
- Fresh instances `b` (to approve) and `c` (to deny) are on Onboarding. `pw doctor` passes for all of them.

- **Mint invite.** On a, run `pw click a "Devices"` and `pw click a "Create invite"`, then `INV=$(pw read a ".invite-block code")`. `INV` is a z-base-32 string of about 112 characters, and a QR SVG renders under it. Run `pw shot a invite`.
- **Join.** Run `pw fill b "Paste invite" "$INV"` and `pw click b "Join a group"`, then `pw wait b "Waiting for an existing device" 60`.
- **Candidate appears.** Run `pw wait a "verify-b wants to join" 120`, then `pw shot a candidate`.
- **Approve.** Run `pw click a "Approve"`, then `pw wait b "Devices" 120`. b routes to MainView.
- **Proof.** Run `pw click b "Devices"` and `pw shot b paired`. The screen text of b lists `verify-b (this device)` and `verify-a · creator`, and the screen text of a lists `verify-b Remove`. `pw state b` has `groupStatus: "member"` and a roster of 2.
- **Deny.** Mint a fresh invite: run `pw click a "Create invite"`, then `pw read a ".invite-block code"`, which now prints a different string. Join from c the same way, run `pw wait a "verify-c wants to join" 120`, then `pw click a "Deny"`. After about 10 s, `pw state c` reads `groupStatus: "none"` while `pw text c` still shows the Waiting text. a keeps the `verify-c wants to join` row, and `pw click a "Approve"` on it shows `no pending candidate with that key`. Run `pw shot c after-deny` and `pw shot a after-deny`.
- **Remove.** On a, run `pw click a "Devices"` and `pw click a "Remove"` (first non-self row). a's roster drops to self only, and `verify-b wants to join` reappears as a request row (issue #13). Run `pw click a "Send"`. The target list no longer has `verify-b`. Run `pw shot a after-remove`.

## Gotchas

- `Remove` has no confirmation and can't be undone. That device must pair again with a fresh invite, using a fresh instance.
- With more than one non-self device, `pw click a "Remove"` removes the first row. Pass `nth`, or check which row with `pw text a` first.
- An invite works once (`INVITE_USED`). The Devices tab keeps showing a used invite (issue #14). Click `Create invite` again before each join.
- Request rows never clear after Deny, a joiner quitting, or Remove (issue #13). With stale rows present, `pw click a "Approve"` hits the first row, which may be stale. Use `nth`, or check `pw text a` first.
- Don't wait for `The creator denied this device.` on desktop. It never renders (issue #12).
- Once removed, a device can't be selected as a send target, so "send to the removed device" can't be driven through the UI.
- Approve and the joiner's route change run on DHT time. The candidate row can take up to about 60 s to appear.
- Verified live on 2026-09-25 (maintenance pass): invite, join, candidate, approve, deny, remove.
