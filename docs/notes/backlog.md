# Backlog — bugs & feature requests

Living document. One entry per item: type, description, and any known
context from the build/QA history. Newest additions at the bottom of
each section.

## UX bugs

- **Un-join / start over.** Need a way to leave a group and reset to
  Onboarding, working at *any* stage of the join process — not just
  for a successfully joined member, but also while stuck in `joining`
  (pending/failed join). Today the only escape is wiping storage by
  hand (`pm clear` / deleting `files/pear-wallpaper`) and the Waiting
  screen's join-failure state is a dead-end requiring an app restart.
  Related known gaps: the parked Waiting dead-end (core's `_runJoin`
  resets status with no state push) and the revoke-UX gap below —
  a proper fix likely wants a core-level `leaveGroup()`/reset that
  tears down and reinitializes storage, plus UI affordances on
  Waiting, Onboarding-error, and Settings.

- **Revoked device shows no distinct "removed" state** *(carried from
  QA Act 8, both shells)*. A revoked device just looks offline —
  connections are refused at the handshake with no emitted event, so
  the UI can't tell "removed" from "peers offline". Needs a core-level
  signal; product call on what the revoked device should see. Pairs
  naturally with un-join above.

## Features

- **Share screen dimensions in the roster.** Joined devices publish
  their screen dimensions (e.g. in `add-device` metadata or a
  device-info op), so senders can visually position/crop an image for
  the *target's* aspect ratio before sending. Builds toward proper
  per-device cropping UX in the Send screens.

- **Member avatars.** Members share an avatar image, shown in the
  Send target list and Devices screen for easy recognizability.
  Needs: avatar blob distribution (small — could ride hyperblobs like
  wallpapers), an op to set/update it, and rendering in both shells.

- **Wallpaper fit mode (fill vs fit/centered)** *(from 2026-08-23
  discussion)*. Android always center-crops to fill; a "fit" mode
  needs the setter module to pre-composite the image centered on a
  screen-sized canvas (letterbox/pillarbox). Shape: `setWallpaper`
  gains `mode: 'fill' | 'fit'`, Settings toggle, default `fill`.
  Interacts with screen-dimensions feature above (sender-side crop
  may reduce the need for receiver-side fit).

- **iOS shell.** Make it work on iOS. Groundwork exists: bare-kit and
  the bare-expo template are iOS-capable, `bare-pack` takes
  `--host ios-*` targets, and the bridge/worklet architecture is
  platform-agnostic. Hard parts: iOS has no API for setting the
  wallpaper programmatically (Apple restriction) — the receive/apply
  story needs a rethink (e.g. save to Photos + shortcut/manual step),
  plus background execution is stricter than Android's.

- **Editable display names.** Members can change their display name,
  including setting it at join time (join screen offers a name field
  pre-filled with the device name as the suggested default — the
  plumbing half-exists: both shells already derive a `deviceName` at
  init, Android from `expo-device`'s model name, desktop from
  `resolveDeviceName`). Needs: a rename op in core (roster is
  currently written only by the creator's `add-device` — rename by
  the member themselves needs its own op + apply rule), a
  name-at-join path (candidate proposes the name during pairing —
  partially exists in the pairing flow), and edit affordances in both
  shells' Settings.

- **Copy-to-clipboard for invite codes.** One-tap/one-click copy of
  the invite string wherever it's displayed (Android DeviceList +
  Onboarding create flow, desktop DeviceList). Today it's
  select-and-copy by hand — fiddly on Android especially.

- **Custom app icon.** The Android app still ships the bare-expo
  template's default icon. Needs real icon art, wired via app.json's
  `icon`/`android.adaptiveIcon` (foreground + background layers for
  Android's adaptive icons) — an `expo prebuild --clean` + rebuild
  picks it up. Desktop's tray icon (`trayTemplate.png`) and eventual
  `.app` icon could share the same artwork.

- **Join-request notification** *(issue #21, from the 2026-09-25
  review)*. The creator only learns of a join request if the window
  happens to be open on the Devices tab. A macOS notification (and an
  Android one) when a `candidate` event arrives would fix it. Deferred
  from Plan 4 by owner decision.

## UX polish

- **Make the app beautiful on all screen sizes.** Both shells are
  functionally unstyled. Includes responsive layout on Android
  (tablets/foldables/small screens), safe-area consistency (partially
  fixed in Task 7 for MainView nav), and a real visual design pass.
