# Journal
- 2026-08-17 Task 1: scaffold + smoke test green (corestore/hyperswarm/testnet working)
- 2026-08-17 Task 2: WallpaperCore lifecycle + identity + local meta (identity = autobase local-writer key)
- 2026-08-17 Task 3: createGroup + autobase log + roster view (creator-only roster policy enforced in apply)
- 2026-08-17 Task 4: invites + candidate pairing (creator-only invite ops; explicit approval gate — no auto-admit)
- 2026-08-17 Task 4 review addendum: 2 fix rounds — userData validation (crash fix), creator-gated _onCandidate, supersede semantics with settled promises, 24h invite expiry, candidate-side 'rejected' event wired (blind-pairing DOES surface dead invites, one level below its swallowing poll loop)
- 2026-08-17 Task 5: approve/deny complete pairing; rosters converge end-to-end
- 2026-08-17 Task 6: roster-gated connections + revocation (gate = who's on the wire; apply = what ops count)
- 2026-08-17 Task 7: per-device hyperblobs store; cross-peer fetch by capability over gated connections
- 2026-08-18 Task 8: sendWallpaper (validate → blob → op → resolve immediately); listSends pending status
