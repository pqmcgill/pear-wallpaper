# Review Fixes Plan (Plan 4)

**Goal:** Fix the defects filed from the 2026-09-25 code and design review (issues #1-#25, plus privately tracked security hardening), one root cause per PR.

**Trunk:** `dev`. Every unit is a PR into `dev`, squash-merged. `dev` merges into `main` with a merge commit, and only with the owner's approval. GitHub closes issues only on merges into `main`, so trunk PRs say "Addresses #n". The final `dev` → `main` PR carries every "Fixes #n" line.

**Evidence:** the review's screenshots and repros are on the `review-evidence` branch (not for merging). Each unit captures its own before (on `dev`) and after evidence with the project `verify` skill, so evidence never depends on merge order.

## The Learning Loop (unchanged from Plans 1-3)

1. A subagent implements the unit test-first. For core bugs, the review's scratch repro becomes a real test under `core/test/`.
2. The coordinator reviews the diff, runs every affected suite, and drives the app for UI units.
3. The PR description is the walkthrough: **Learning goal**, what changed, **Understanding checkpoint**, and evidence.
4. One line per unit in `docs/notes/JOURNAL.md`, added at merge time.

Pace: units merge into `dev` at will. The coordinator posts a digest after each step.

## Decisions (2026-09-25)

- Received-file retention (#10): keep the last 10 received files per device, the size of the Received list. A blob is deleted once every target has applied it or superseded it.
- Advisories are published after their fix reaches `main`.
- #21 (join-request notification) moves to the backlog.
- Protocol-breaking changes to op validation and pairing are acceptable, because no production family group exists yet (physical-device QA is still pending).

## Units

Order: issues first, while each issue's description still matches `main`, then security hardening. Step D runs alongside Steps A-C.

### Step A: desktop issues with no core dependency

| Unit | Issues | Learning goal |
|---|---|---|
| A1 online status | #15 | Where "online" comes from (swarm connections vs roster), and why self was reported offline |
| A2 send status | #16 | Deriving per-send UI state from `snapshot.sends` instead of the newest-send-per-device shortcut |
| A3 early format check | #18 | Validating at the edge the user touches, with core's sniff as the backstop |
| A4 keyboard access | #17 | Native controls vs clickable labels; ARIA selected state for tabs |
| A5 invite presentation | #19, #20 (desktop) | Component lifetimes: why Onboarding's local state died on the route change |
| A6 sender name | #2 | What belongs in replicated metadata (a basename) vs what stays local (a path) |
| A7 state pushes | #9, #11 | Push triggers in bridge-main, and coalescing bursts |
| A8 worker death | #5 | Process supervision across Electron main and the Bare sidecar |
| A9 login toggle | #6 | launchd job ownership: why bootout killed its own caller |

### Step B: pairing issues (needs a core change)

| Unit | Issues | Learning goal |
|---|---|---|
| B1 pending requests | #12, #13 | Rendering from core's live pending set instead of accumulating events in component state |
| B2 used invites | #14 | Invite lifecycle: single use, rotation, and what the joiner hears when it's spent |

### Step C: core issues

| Unit | Issues | Learning goal |
|---|---|---|
| C1 newest wins | #1, #3 | "Unapplied" as a relation between sends, and sweep coalescing without lost updates |
| C2 join survives quit | #4 | Separating clean close from failure in `_runJoin` |
| C3 garbage collection | #10 | hyperblobs `clear()`, and what "no longer needed" means for a replicated blob |

### Step D: Android issues (parallel with A-C)

| Unit | Issues | Learning goal |
|---|---|---|
| D1 Android UX | #20 (Android), #22, #23, #24, #25 | Surfacing worklet state (join errors, apply failures, send status) in RN screens |
| D2 worklet lifecycle | #7, #8 | One worklet per process: background task vs foreground app ownership |

### Step E: security hardening

Tracked in private advisories until the fixes reach `main`. Units: validate `set-wallpaper` ops in `apply`, receiver-side blob limits, pairing key binding and invite storage, gate state after restart, desktop navigation and IPC-origin guards, and the Android backup policy.

## Status (paused 2026-09-25)

Merged into `dev`: A1-A9, C1, C2, D1, D2 (PRs #28-#38, #40, #41). 20 of 26 issues fixed on `dev`.

Remaining, in order:
- **B1** pending requests (#12, #13): not started (branch discarded).
- **C3** garbage collection (#10): work in progress on `fix/c3-garbage-collection` (tests plus a partial change, pushed as a WIP commit; remove the `sandbox-gc-*` debug tests before finishing).
- **B2** used invites (#14) plus #39 (approving an offline joiner burns the invite).
- **Android emulator QA** for D1 and D2: partial (#20 and #24 walked, no report yet). Rerun from the D1/D2 walkthrough checks.
- **Step E** security hardening, six units: not started.
- Then the `dev` → `main` PR, with the owner's approval.

Resume tooling (coordinator scratch, not committed): per-unit worktrees, an implementer brief, and a ship script that rebases on `dev`, reruns affected suites, adds the journal line, publishes evidence to `review-evidence/fixes/<unit>/`, opens and squash-merges the PR, and comments on the issues.
