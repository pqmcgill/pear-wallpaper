# Spike: Pear v3 compatibility for the desktop shell

Date: 2026-08-19
Scope: investigation only, no committed code changed. All experiments ran
against a scratch copy of `desktop/` under
`/private/tmp/.../scratchpad/pear-spike/desktop-copy`, plus `npm pack` tarballs
of `pear-electron` in the same scratch dir. `git status` on `desktop/` is
clean (see bottom of this file).

Environment: Pear CLI `3.2.0` at `/Users/patrick/.local/bin/pear`. Installed
module versions per `pear versions -m`: `pear-ipc@^6.12.0`,
`pear-runtime-updater@^3.1.0`, `bare@1.29.4`. No `pear-electron` and no
`pear run`/`pear dev` anywhere in the CLI's own dependency tree.

## Q1 — Does `pear-electron@1.9.0-rc.0` / `1.8.0-rc.0` target Pear v3?

Packed all three with `npm pack` (no install into the project) and diffed:

| | 1.7.28 (latest) | 1.8.0-rc.0 | 1.9.0-rc.0 |
|---|---|---|---|
| package size | 858 KB | **18 KB** | 38.5 MB |
| files | `boot.bundle.patch.js` (1.9MB patch blob) | same shape as 1.7.28 but **missing** `boot.bundle.patch.js` despite `package.json.files` still listing it (looks like a broken/WIP publish) | new: `electron-main.js`, `boot.js`, `gui/*` (gui.js, decal.js, ipc.js, preload.js, icons), and `prebuilds/{darwin,linux,win32}-{arm64,x64}/*` bundled directly in the npm package |
| `pear-ipc` dep | `^6.4.0` | `^6.4.0` | `^6.9.0` |
| `runtime.js` API | `Pear.config.*` | `Pear.config.*` | **`Pear.app.*`** (renamed) |
| how it boots Electron | spawns bin with `argv = ['run', '--rti', info, ...]` | same as 1.7.28 | spawns bin with `argv = [fileURLToPath(boot.file), '--rti', info, ...]`, where `boot.file` comes from a new `this.ipc.bundle({ entry: '/node_modules/pear-electron/boot.js', prebuilds, ... })` call — the old `'run'`-as-argv[0] convention is gone internally |

So 1.9.0-rc.0 is a real, substantial rewrite (new boot/bundle mechanism,
`Pear.config`→`Pear.app` rename, bundled prebuilds) and 1.8.0-rc.0 looks like
an abandoned/incomplete rc snapshot.

**But**: 1.9.0-rc.0's own README (`## Development` section, lines ~1048-1081)
is **verbatim unchanged** from 1.7.28's, and still instructs:

```
npm run prestage
pear stage dev
...
pear run --pre-io -d .
```

i.e. the rc's *own* documented dev workflow for pear-electron contributors
still relies on the removed `pear run`. Worse: `package.json.scripts` in
1.9.0-rc.0 itself (`bootstrap`, `decal`, `prebuilds`) are defined as
`"pear run scripts/bootstrap.js"` etc. — **pear-electron's own build/release
tooling invokes the removed command**, so even the library's maintainers
would need `pear run` today.

Most decisive fact: **the `pear-electron` GitHub repo
(`holepunchto/pear-electron`) was archived by its owner on Apr 27, 2026 and
is now read-only.** No further releases will happen; 1.9.0-rc.0 is very
likely the last artifact that will ever be published. Confirmed by fetching
the repo page directly.

## Q2 — Exact dev-run recipe under Pear 3.2.0

There is **no CLI-level dev-run command** while using pear-electron. Confirmed
directly:

```
$ pear run .
✖ pear run has been removed.
Use the pear-runtime module instead: https://www.npmjs.com/package/pear-runtime
```

`pear help` lists only: `touch, seed, stage, build, provision, multisig,
info, dump, install, data, changelog, sidecar, gc, cores, versions, help`.
None of these "runs" a Bare-main entrypoint interactively.

I actually ran the real commands against a scratch copy of `desktop/`
(`pear-electron@1.7.28`, unmodified code):

```
$ pear touch --json
{"success":true,"key":"ocpu6xn3qnyxhuoqg81nb96bief76x7abrcy63bgwfh93bgurq5o", ...}

$ pear stage pear://ocpu6.../ . --json
... 2068 files staged successfully ...
{"cmd":"stage","tag":"final","data":{"success":true}}
```

Staging works fine — it's just a disk→hypercore sync. The dead end is
**launching** it. `pear build` needs an existing native app shell whose
directory name matches the project name:

```
$ pear build --package ./package.json --darwin-arm64-app /tmp/nonexistent.app --target /tmp/out --json
{"cmd":"build","tag":"error","data":{"success":false,
 "code":"Error: expected directory pear-wallpaper-desktop but got nonexistent.app for darwin-arm64\n    at Build.run (bare:/app.bundle/node_modules/pear-build/index.js:70:15)"}}
```

So `pear build` doesn't *create* a runnable app — it **injects your staged
project into a pre-existing "Pear Runtime" native app shell** (an Electron
binary named after your `pear.json`/`package.json` project name) that you
must already have. In the v2 world that shell came from `pear-electron`'s
own `bootstrap`/`decal` scripts — which, per Q1, invoke the now-removed
`pear run` and live in an archived repo. There is no working path to obtain
that base shell today, so this is a genuine dead end for pear-electron under
CLI 3.2.0, not just a missing-doc problem.

The actual, currently-supported v3 recipe (confirmed via `docs.pears.com`
migration guide + the `pear run` removal message + the `hello-pear-electron`
template README) is a **different architecture entirely**:

- Scaffold `git clone https://github.com/holepunchto/hello-pear-electron`
- It's a **plain Electron app** managed by `electron-forge` (`npm start` →
  `electron-forge start`), with no Bare-main/Electron-child split, no
  `pear-bridge`, no `pear-pipe`, no `Pear.config`/`ui.app` bridge object.
- P2P OTA updates/storage (if wanted) come from embedding the `pear-runtime`
  library (`new PearRuntime({ dir, version, upgrade, name, app })`) directly
  in your own Electron main process; `pear.run('./workers/main.js', ...)`
  launches Bare workers for backend logic, IPC via `Bare.IPC`.
- The `pear` CLI's role shrinks to producing/serving the OTA bundle
  (`touch`/`stage`/`build`/`seed`/`provision`/`multisig`) that `pear-runtime`
  consumes at runtime — it is no longer how you launch or develop the app
  day-to-day.

**We did not get our current `desktop/` app to open a window under Pear
3.2.0.** The blocking error is architectural, not a flag we missed: the dev
command pear-electron's README depends on (`pear run --pre-io -d .`) doesn't
exist in this CLI, and there's no working replacement inside pear-electron
itself.

## Q3 — Personal-use distribution across the owner's own Macs (v3)

Under the *new* (sanctioned, non-pear-electron) model this is genuinely
simple, because it's just an Electron app:

1. `electron-forge package` (or `make`) on each Mac, or build once and copy
   the `.app` to the other Macs (same arch) / rebuild per-arch.
2. If P2P OTA is wanted so you don't have to manually redistribute:
   `pear touch` once → put the link in `package.json.upgrade` → `pear stage
   <link> .` after each change → `pear seed <link>` from one seeding
   machine → each app instance, running `pear-runtime`, picks up
   `updating`/`updated` events automatically.
3. Given this is personal-use-only across machines you control, OTA is a
   nice-to-have, not a requirement — manually rebuilding/copying the `.app`
   is a perfectly adequate v1.

Note: this is unrelated to `pear-wallpaper-core`'s own hypercore/hyperswarm
based device-sync (that's the app's actual feature, syncing wallpaper state
between the user's devices) — that logic is already runtime-agnostic and is
untouched by any of this shell-layer decision.

## Q4 — Launch-at-login target under v3

`desktop/lib/login-item.js` currently builds:

```js
programArguments: [pearBin, 'run', `pear://${Pear.config.key || ''}`]
```

This is dead under any v3 path (`pear run` is removed). Under **either** the
pear-runtime-embedded-Electron model or a fully standalone Electron rewrite,
the app ends up as a normal native `.app` bundle built by `electron-forge`/
`electron-builder`. The `ProgramArguments` should simply target that
bundle's executable directly, no `pear` binary and no `pear://` link:

```xml
<key>ProgramArguments</key>
<array>
  <string>/Applications/Pear Wallpaper.app/Contents/MacOS/Pear Wallpaper</string>
</array>
```

(exact executable name = the Electron app's `productName`/`name`, matching
what `electron-forge make`/`package` emits under `Contents/MacOS/`).
`login-item.js`'s plist-writing logic (labels, `launchctl bootstrap/bootout`)
stays as-is — only the `programArguments` value construction in `index.js`
(currently lines ~50-54) changes, and it no longer needs `Bare.argv`/`Pear.config.key`
at all.

## Q5 — Compatibility verdict

**No** — do not stay on `pear-electron`, rc or otherwise.

Evidence, all gathered directly (not inferred):
- `holepunchto/pear-electron` is **archived** (read-only since Apr 27, 2026)
  — no bug fixes, no future rc will ever ship.
- The 1.9.0-rc.0 package's own README and `package.json` scripts still
  reference the removed `pear run` — even the library's own maintainers'
  tooling is broken under CLI 3.2.0, and no one is left to fix it.
- The CLI's removal message explicitly redirects to a *different* library
  (`pear-runtime`, not `pear-electron`): `"pear run has been removed. Use
  the pear-runtime module instead."`
- `pear build` (confirmed by direct experiment) requires a pre-existing
  native app shell that pear-electron's own (now-dead) tooling used to
  produce — a hard dead end, not a missing flag.
- Version-pinning trap: 1.7.28/1.8.0-rc.0 declare `pear-ipc: ^6.4.0` against
  a CLI that ships `pear-ipc: ^6.12.0` — technically in-range but a wide gap
  in a library that changes its wire protocol across minors; 1.9.0-rc.0
  narrows this to `^6.9.0` but the point is moot given the repo is archived.

**Recommendation: reconsider-standalone-electron.** Adopt the
`hello-pear-electron` pattern — a plain Electron app (e.g. via
`electron-forge`), optionally embedding the `pear-runtime` library purely
as an OTA-update convenience (not required for personal use across the
owner's own Macs). Drop `pear-electron`, `pear-bridge`, `pear-pipe`, and the
`Pear` global entirely.

### What has to change (if we proceed)

Reusable as-is (already runtime-agnostic, per existing test suite):
- `pear-wallpaper-core` (the hypercore/hyperswarm sync engine) — untouched.
- `desktop/lib/single-instance.js`, `device-name.js`, `platform/*`,
  `sync-engine.js` — no Pear/pear-electron coupling found.

Needs rewriting (currently coupled to `Pear.*`/`pear-electron`/`ui.app`):
- `desktop/index.js` — replace the Bare-main + `pear-bridge` + `Runtime.start()`
  pipe dance with a normal Electron `main.js` that creates a `BrowserWindow`
  directly; `Pear.config.storage`/`Pear.teardown`/`Pear.exit` become plain
  Node/Electron equivalents.
- `desktop/lib/pear-transport.js` and `ui/pear-transport.js` — this whole
  file exists to work around pear-electron's incomplete app-level IPC; a
  standalone Electron app can use `ipcMain`/`ipcRenderer` (or
  `contextBridge`) directly, which is simpler, not harder.
- `desktop/lib/bridge-main.js` — same IPC-channel rework.
- `desktop/lib/login-item.js` — only the caller in `index.js` changes (see
  Q4); the plist-writing code itself is reusable.
- `ui/tray.js`, `ui/app.js` (`ui.app.tray/.show/.focus`) — replace with
  Electron's own `Tray`/`BrowserWindow` APIs.
- `desktop/package.json` — drop `pear-electron`/`pear-bridge`/`pear-pipe`
  deps, drop `pear.pre`/`pear.gui` config, add `electron`/`electron-forge`
  (or `electron-builder`), fix `scripts.dev`.
- Spec §Distribution — rewrite around `electron-forge package/make` (+
  optional `pear-runtime`/`pear touch`/`stage`/`seed` for OTA) instead of
  `pear run`/`pear release`.

### Effort / risk

Not a small "bump + fix glue" job — it's a shell-layer rewrite, roughly on
the order of **a few days** for one engineer, because none of the
runtime-integration code (`index.js`, `bridge-main.js`, `pear-transport.js`,
`login-item.js`'s call site, tray/focus calls in the renderer) survives
unchanged, even though it's a small amount of code (~345 lines across
`lib/`). Risk is low-to-moderate: Electron's own APIs (`BrowserWindow`,
`Tray`, `ipcMain`/`ipcRenderer`, `app.setLoginItemSettings` as a possible
LaunchAgent alternative) are stable and far better documented than any Pear
rc; the main risk is scope creep from wanting to also wire up `pear-runtime`
OTA immediately rather than deferring it, and from re-verifying tray/focus/
single-instance behavior that pear-electron previously handled.

## Commands run / artifacts

All in `/private/tmp/claude-501/.../scratchpad/pear-spike/`:
- `npm pack pear-electron@{1.7.28,1.8.0-rc.0,1.9.0-rc.0}` → tarballs, extracted to `v1.7/`, `v1.8/`, `v1.9/`.
- `desktop-copy/` — full copy of `desktop/`, used for `pear touch` / `pear stage` / `pear build` experiments. Not committed, not part of the real repo.
- Produced link (scratch only, safe to discard): `pear://ocpu6xn3qnyxhuoqg81nb96bief76x7abrcy63bgwfh93bgurq5o`, staged to version 2069.

`git status` on the real repo at the end of this spike:

```
On branch desktop-shell
nothing to commit, working tree clean
```

`desktop/` was never written to; only a copy under the scratchpad was used
for stateful `pear` commands.
