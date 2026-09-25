# Received and re-apply

The Received tab lists the wallpapers this device has applied, newest first, each with a thumbnail and a `Re-apply` button. Re-apply sets the desktop picture again from the local file, with no network involved.

## Sub-features

- `received-list`: up to 10 items, sorted by when they were applied (newest first). Each shows a thumbnail, a name label, and `Re-apply`. The label is the sender's `meta.filename` (today the sender's absolute path, issue #2), or the wallpaper id when that is missing.
- `received-reapply`: `Re-apply` sets the Mac's desktop picture back to that item's local file. On success it gives no feedback. On failure a `.error` line appears.
- `received-reapply-offline`: re-apply works with the network off, because it never touches the swarm.

## How to get to it (user POV)

- `Received` tab → `Re-apply` next to an item.

## Driving it with pw

Preconditions:

- b has received at least two wallpapers ([send-wallpaper](./send-wallpaper.md)). The newest one is on the desktop.

- **List.** Run `pw click b "Received"` and `pw shot b received`. The screen text shows two labels, each followed by `Re-apply`, newest first. `pw state b` lists the same items in `received[]` with descending `appliedAt`.
- **Re-apply an older item.** Run `pw click b "Re-apply" 1`. Item 0 is already the current wallpaper, so re-applying it proves nothing. No `.error` appears.
- **Proof.** Run `pw wallpaper --save reapplied`. The path equals `received[1].filePath` from `pw state b`, and `pw hash` of the older fixture matches `wallpaper-reapplied.png`.

## Gotchas

- Only the 10 most recent items render. An older item can still be re-applied by the worker, but the UI never shows it.
- Match items by `filePath` from `pw state b`, not by label. The labels are the sender's paths.
- To test offline you must turn the Mac's network off, which also breaks DHT for every other instance. Do it last in a run.
- Verified live on 2026-09-25 (maintenance pass): list order and re-apply of item 1, hash-matched. The offline sub-feature was not driven.
