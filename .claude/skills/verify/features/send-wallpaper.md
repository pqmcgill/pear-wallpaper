# Send a wallpaper

In the Send tab a member picks an image, ticks one or more target devices, and clicks Send. A `Recently sent` list under the button shows each send with its picture name, time, and one status per target, which becomes `Delivered` once the target has applied it. On the target, the Mac's desktop picture actually changes.

## Sub-features

- `send-pick-browse`: the dropzone is a button that opens the file dialog. Choosing a file shows its file name in the dropzone. This goes through `webUtils.getPathForFile` in preload.
- `send-keyboard`: Tab from the nav reaches the dropzone button, then each target checkbox, then `Send`. Space or Enter on the dropzone opens the file dialog. The open nav tab has `aria-current="page"` and a bold, underlined look.
- `send-pick-drop`: dragging an image onto the dropzone (not drivable, see Gotchas).
- `send-targets`: the checkbox for each non-self roster device, with `online` or `offline` after its name and no send status. `Send` stays disabled until there is a file and at least one target.
- `send-status`: `Recently sent` (`.send .sent`, hidden until the first send) lists this device's sends, newest first: picture file name, time, then each target with `Not delivered yet`, `Waiting for <name> to come online` (pending and offline), `Delivered`, or `Replaced by a newer picture` (the target applied a newer send first). Same words as Android's Sent tab.
- `send-formats`: only JPEG, PNG and WebP up to 20 MB are accepted. The picker offers only those, and every pick (browse or drop) is checked by core's real format sniff, so a HEIC (even renamed `.jpg`) is refused at pick time with `Only JPEG, PNG and WebP pictures can be sent. If this is an iPhone photo (HEIC), export it as a JPEG first.`
- `send-apply`: the receiving device's worker sets the macOS desktop picture to `received/<id>.<ext>`.

## How to get to it (user POV)

- `Send` tab → click the dropzone button (`Drop a JPEG, PNG or WebP picture here, or click to browse`) to open the file dialog, or drag an image onto it.
- Tick a device name, then click the `Send` button under the list.

## Driving it with pw

Preconditions:

- Instances `a` and `b` are paired ([pairing](./pairing.md)). `pw doctor` passes for both.
- The user knows the Mac's wallpaper will change. `pw start-run` saved the original.

- **Fixture.** Run `F=$(pw fixture send-a-to-b)` to get a PNG with a unique solid color in `artifacts/`.
- **Pick file.** Open Send and pick the file. Run `pw click a "Send"` (the tab) and `pw file a "$F"`. The dropzone text becomes the file name of `$F`.
- **Choose target.** Run `pw click a "verify-b"`. Its checkbox is checked (`pw eval a "document.querySelector('.send input[type=checkbox]').checked"` returns `true`), and the `Send` button is enabled. Run `pw shot a send-ready`.
- **Send.** Run `pw click a "Send" 1` (the submit button). Right after, `pw read a ".send .sent .status"` prints `Not delivered yet`. Then run `pw wait a "Delivered" 120`. The dropzone resets, and the newest `Recently sent` entry reads `verify-b Delivered`. Run `pw shot a delivered`.
- **Receiver state.** Run `pw state b`. `received[0]` has `appliedAt` and `filePath` under `.verify-runs/<run>/userdata/b/received/`.
- **Real side effect.** Run `pw wallpaper --save after-send`. It prints b's `received/<id>.png`. Then run `pw hash "$F" .verify-runs/$(cat .verify-runs/current)/artifacts/wallpaper-after-send.png`. The two sha256 values match.

- **Keyboard path.** On the Send tab, blur focus with `pw eval a "document.activeElement.blur()"`, then repeat `pw key a Tab` until it prints the dropzone button. Run `pw key a Space --expect-chooser`: it prints `file chooser opened: true`. One more `pw key a Tab` focuses the first target checkbox, and `pw key a Space` ticks it.

## Gotchas

- `pw click a "Send"` with no `nth` clicks the **tab**, not the submit button.
- To prove offline queuing, `pw stop b`, send, check for `Waiting for verify-b to come online`, then `pw launch b` again. The same userdata is reused, and the entry turns `Delivered`.
- On a second send to the same device, `pw wait a "Delivered"` passes at once on the previous entry in `Recently sent`. Prove the new send landed with `pw state b` (one more `received[]` item) or the wallpaper hash.
- Never click the dropzone button or press Space on it: it opens a native macOS dialog that CDP can't drive. Use `pw file`. Drag-and-drop (`send-pick-drop`) can't be driven with pw. Report it as unverified.
- Both instances are on the same Mac, so an A→B send changes **your** desktop. Both instances apply to the same screen, so for B→A the proof is the path pointing into `userdata/a/received/`.
- The receiver's `meta.filename` is only the basename of the sender's file (issue #2). A full path in `pw state b` is a regression.
- The first-ever osascript call prompts for macOS Automation permission. If `delivered` never appears, check `.verify-runs/<run>/logs/b.log` for an osascript error.
- Verified live on 2026-09-25, twice (the initial run and the maintenance pass): browse path, A→B, `pending` then `delivered`, hashes matched. This was the first real smoke of the `webUtils.getPathForFile` fix that `qa-desktop.md` flags.
