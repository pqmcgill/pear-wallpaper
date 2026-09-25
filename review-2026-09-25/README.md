# Review evidence, 2026-09-25

Supporting files for the issues filed from a code and design review of `main` at `adb52a8`.

- `img/<seam>/` holds screenshots from the live desktop app. The project `verify` skill (`.claude/skills/verify/bin/pw`) drove it over CDP.
- `repro/<seam>/` holds scratch repro tests and their raw output. They ran from the gitignored `core/test/sandbox/<seam>/` directory, next to `core/test/helpers.js`, against the local hyperdht testnet. Some import sibling helpers that are not copied here.
- Repros for security findings are left out on purpose.
- `decisions.tsv` is the reviewer's decision trail: how the review was split, what was re-verified, and what was merged or dropped.

This branch is an orphan and is not meant to be merged.
