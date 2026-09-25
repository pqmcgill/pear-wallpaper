# Send a wallpaper

In the Send tab a member picks an image, ticks one or more target devices, and clicks Send. Each target row shows its status, which becomes `delivered` once the target has applied it. On the target, the Mac's desktop picture actually changes.

## Sub-features

- `send-pick-browse`: choosing a file via the file input shows its absolute path in the dropzone. This goes through `webUtils.getPathForFile` in preload.
- `send-pick-drop`: dragging an image onto the dropzone (not drivable, see Gotchas).
- `send-targets`: the checkbox for each non-self roster device, with `online` or `offline` after its name. A pending send to an offline device reads `Waiting for <name> to come online`. `Send` stays disabled until there is a file and at least one target.
- `send-status`: the row shows the status of the newest send to that device: blank (never sent), `pending`, `delivered`, or `superseded` (the target applied a newer send first). Before a new send it still shows the previous send's status (issue #16).
- `send-formats`: only JPEG, PNG and WebP up to 20 MB are accepted. The picker offers any image, and other formats (for example HEIC) are rejected only after `Send` with `unsupported image format (JPEG, PNG, WebP only)` (issue #18).
- `send-apply`: the receiving device's worker sets the macOS desktop picture to `received/<id>.<ext>`.

## How to get to it (user POV)

- `Send` tab → click the dropzone (`Drop an image here, or click to browse`) to open the file dialog, or drag an image onto it.
- Tick a device name, then click the `Send` button under the list.

## Driving it with pw

Preconditions:

- Instances `a` and `b` are paired ([pairing](./pairing.md)). `pw doctor` passes for both.
- The user knows the Mac's wallpaper will change. `pw start-run` saved the original.

- **Fixture.** Run `F=$(pw fixture send-a-to-b)` to get a PNG with a unique solid color in `artifacts/`.
- **Pick file.** Open Send and pick the file. Run `pw click a "Send"` (the tab) and `pw file a "$F"`. The dropzone text becomes the absolute path of `$F`.
- **Choose target.** Run `pw click a "verify-b"`. Its checkbox is checked (`pw eval a "document.querySelector('.send input[type=checkbox]').checked"` returns `true`), and the `Send` button is enabled. Run `pw shot a send-ready`.
- **Send.** Run `pw click a "Send" 1` (the submit button). Right after, `pw read a ".send .status"` prints `pending`. Then run `pw wait a "delivered" 120`. The dropzone resets, and b's row reads `verify-b delivered`. Run `pw shot a delivered`.
- **Receiver state.** Run `pw state b`. `received[0]` has `appliedAt` and `filePath` under `.verify-runs/<run>/userdata/b/received/`.
- **Real side effect.** Run `pw wallpaper --save after-send`. It prints b's `received/<id>.png`. Then run `pw hash "$F" .verify-runs/$(cat .verify-runs/current)/artifacts/wallpaper-after-send.png`. The two sha256 values match.

## Gotchas

- `pw click a "Send"` with no `nth` clicks the **tab**, not the submit button.
- To prove offline queuing, `pw stop b`, send, check for `Waiting for verify-b to come online`, then `pw launch b` again. The same userdata is reused, and the row turns `delivered`.
- On a second send to the same device, `pw wait a "delivered"` passes at once on the previous send's status. Prove the new send landed with `pw state b` (one more `received[]` item) or the wallpaper hash.
- Never click the dropzone label: it opens a native macOS dialog that CDP can't drive. Use `pw file`. Drag-and-drop (`send-pick-drop`) can't be driven with pw. Report it as unverified.
- Both instances are on the same Mac, so an A→B send changes **your** desktop. Both instances apply to the same screen, so for B→A the proof is the path pointing into `userdata/a/received/`.
- The receiver's `meta.filename` (shown in its Received tab) is the sender's full absolute path (issue #2). Treat this as a product finding, not a verification failure.
- The first-ever osascript call prompts for macOS Automation permission. If `delivered` never appears, check `.verify-runs/<run>/logs/b.log` for an osascript error.
- Verified live on 2026-09-25, twice (the initial run and the maintenance pass): browse path, A→B, `pending` then `delivered`, hashes matched. This was the first real smoke of the `webUtils.getPathForFile` fix that `qa-desktop.md` flags.
