# Why the upstream package fails, and what this build changed

This file is the technical record behind the fork: what breaks when the
upstream `dsh-session-categories` is installed into a current dsh, and every
change this build makes so it can load. It is written for maintainers — the
user-facing summary lives in README.

## The failure

Upstream `dsh-session-categories@0.1.0` was published 2026-08-19 against an
older dsh prerelease. Current dsh has since **removed the
`@deepseek-ai/dsh-client-runtime` package**. The upstream client bundle still
imports it:

```
upstream lib/client.js requires:
  "@deepseek-ai/dsh-client-runtime/client"   <-- no longer resolvable
  "@deepseek-ai/dsh-client-ui-primitives"
  "react"
  "react/jsx-runtime"
```

The dsh module loader resolves a client bundle's `require` calls against the
plugin's declared `inject` peers. An unresolvable require throws while the
bundle is being materialised, so the `sidebar.workspaces` slot entry crashes on
mount. The official sidebar then takes the slot back, and because the crash
happens during shell boot the window never finishes opening — dsh appears to
be dead.

This build requires only modules that exist in current dsh:

```
this build requires:
  "@deepseek-ai/dsh-client-store"            <-- replaces dsh-client-runtime
  "@deepseek-ai/dsh-client-ui-primitives"
  "react"
  "react/jsx-runtime"
```

## The client-side port (eight changes)

The bundle is rebuilt from source rather than patched in `lib/`, so the fixes
survive plugin reinstalls. `BUILD.md` documents the toolchain; this list is
what actually differs from upstream.

| # | Upstream | This build |
|---|---|---|
| 1 | `@deepseek-ai/dsh-client-runtime/client` for stores and types | `@deepseek-ai/dsh-client-store`; local type surface in `types.ts` |
| 2 | `defineStore` from the runtime | `defineStore` from `dsh-client-store` |
| 3 | `indexSubagentDescendants` from the runtime | Locally implemented shim that accepts an object **or** an array and tolerates `null` |
| 4 | `list.current` | `currentSessionId(list)` (7 call sites) |
| 5 | In-component `open` / `startSession` / `pickDirectory` | Raised to the `uiWorkspace` service |
| 6 | `inject` without `uiWorkspace` | `uiWorkspace` added to the inject list |
| 7 | Icons named `*Outline16` | `*OutlineRegular` and friends, matching current primitives |
| 8 | `dsh-client-runtime` in `package.json` | Removed |

Two additional repairs were needed because upstream ships an incomplete
source tree:

- **`Rows.module.css` is missing from the upstream repository.** `Rows.tsx`
  imports it, the repository does not contain it, and `.gitignore` does not
  explain the gap. The only surviving copy was inside the published bundle;
  this fork reconstructs it from `lib/client.js`, strips the `QQanJW_` scope
  prefix, and keeps the result in the source tree. Re-cloning upstream will
  still be missing this file.
- **The reconstructed stylesheet first shipped a truncated `@keyframes row-in`
  block.** A broken at-rule makes every following rule unparseable without any
  error, which silently dropped twenty class names from the emitted map and
  left those elements unstyled. The block is balanced now, and `BUILD.md`
  records the brace-counting check that catches it.

## Behavior changes on top of the port

These are deliberate additions, each one traceable to a concrete defect or a
feature request:

- **Row menu verbs follow the registry.** Archive row menus offer 归档会话 /
  取消归档 by reading the *raw* archive set, while visibility keeps using the
  *filtered* set. Earlier code passed only the filtered set, which is emptied
  while archived rows are being revealed, so the verb silently never flipped.
- **`buildCategoryTree` receives the raw archive set** as its row-verb
  argument; the view object keeps the filtered set for visibility.
- **Archive section.** Archived sessions are gathered into a trailing
  section instead of scattering across workspace groups, and carry a leading
  glyph plus a dimmed title.
- **Three-state archived filter** matching the official browser's 筛选会话
  group, plus a dedicated 仅显示已归档 empty state.
- **Delete with a recovery bin**, three delete scopes, a pre-delete scan, and
  realpath-bounded artifact deletion. Undo restores the log, the workspace
  roster entry and the archive flag together.
- **Pin.** The upstream client bundle has no pin support; this build adds
  置顶会话 / 取消置顶 and makes pinned rows lead their group, including inside
  category projections.

## Host half: do not rebuild it whole

The host side keeps the upstream layout on purpose:

```
lib/index.js             real host service
lib/spec.js              62-byte re-export -> ./types/spec.js
lib/types/spec.js        real implementation
lib/typert.host.js       generated descriptor tables
lib/typert.remote-client.js
lib/types/*.js|.d.ts
```

The `packages/workspace` sources compile to a self-contained `lib/spec.js`
that imports `@deepseek-ai/dsh-storage-domain` directly. Those internal
packages resolve only inside the dsh installation, so replacing the published
`lib/spec.js` with the compiled one makes the plugin fail to load. **Only
`lib/index.js` may be replaced; `lib/spec.js` must stay a re-export.**
`scripts/pack-release.mjs` enforces this by assembling the package from the
installed layout and swapping in the client bundle alone.

## Licensing

Upstream is MIT, copyright the original author (`ht719`). This fork keeps that
license and attribution, and adds its own changes under the same terms.
