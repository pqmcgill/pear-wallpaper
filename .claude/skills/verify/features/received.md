# Received and re-apply

The Received tab lists every wallpaper this device has received, with a thumbnail and a `Re-apply` button. Re-apply sets the desktop picture again from the local file, with no network involved.

## Sub-features

- `received-list`: each received item shows a thumbnail, a filename, and `Re-apply`.
- `received-reapply`: `Re-apply` sets the Mac's desktop picture back to that item's local file.
- `received-reapply-offline`: re-apply works with the network off, because it never touches the swarm.

## How to get to it (user POV)

- `Received` tab → `Re-apply` next to an item.

## Driving it with pw

Preconditions:

- b has received at least one wallpaper ([send-wallpaper](./send-wallpaper.md)).

- **List.** Run `pw click b "Received"` and `pw shot b received`. The screen text shows the item's filename followed by `Re-apply`.
- **Change the wallpaper away.** Send b a second fixture, or note the current path with `pw wallpaper`. The desktop picture is now something other than the first item.
- **Re-apply.** Run `pw click b "Re-apply"` (the first item; pass `nth` for others). No `.error` appears.
- **Proof.** Run `pw wallpaper --save reapplied`. The path equals the first item's `filePath` from `pw state b`.

## Gotchas

- The list order comes from the worker snapshot. Match items by `filePath` from `pw state b`, not by position alone.
- To test offline you must turn the Mac's network off, which also breaks DHT for every other instance. Do it last in a run.
- Not yet driven. On 2026-09-25 only `received-list` was observed.
