# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

This plugin is a maintained fork of
[ht719/dsh-session-categories](https://github.com/ht719/dsh-session-categories).
Every entry below records **what changed and where it came from** — the upstream
baseline, the competing plugin whose idea was adopted, or a user report filed
against this build.

> **Version renumbering (2026-10-18).** The human asked for this build to
> be version `1.1.6` and noted that many more versions are coming, so the whole
> series moved from `2.1.x` to `1.1.x` in one step — a single heading changed in
> isolation would have left `1.1.6` printed above `2.1.5`, which scans as a
> downgrade. Tarballs already sitting in `dist/` keep the filenames they were
> built under; `dsh-session-categories-2.1.6.tgz` moved to
> `dist/superseded/` and is byte-identical to `1.1.6.tgz` apart from the
> version string inside its manifest.

## [Unreleased]

### Documentation

- **README 与包版本对齐。** 两份 README 头部还写着 `1.1.6`（实际已发到 `1.2.0`），现改为 `1.2.0`，tarball 安装示例同步指向 `dsh-session-keeper-1.2.0.tgz`。
- **补上「不能与上游同时安装」的互斥说明。** 本插件与上游 `@deepseek-ai/dsh-session-categories` 抢同一个 `sidebar.workspaces` 槽位、开同一个存储域（`session_categories`，version 0），同时安装会互相顶掉侧边栏并写进同一份分类文档 —— 二选一。
- **文档化置顶抬升与视图开关。** 1.1.8 起置顶行可抬进所有分类之上的全局置顶段；视图菜单新增「置顶到分类上方 / 保留在所属分类」开关（默认前者），此前 README 未提。

## [1.2.0] — 2026-10-24

### Changed

- **peerDependencies 从 `"*"` 收紧到能匹配预发布版的显式范围。** 之前 14 个 `@deepseek-ai/*`
  全部声明为 `"*"`，而 semver 里 `"*"` **不匹配任何预发布版本** —— harness 实际提供的
  13 个 dsh-* peer 全是 `0.2.0-rc.2` 这类预发布版，`^0.2.0` 同样匹配不上。
  结果是安装时这些 peer 被静默排除，pnpm 侧表现为 ERESOLVE。
  现在改为：cordis `>=4.0.4 <5.0.0`，其余 13 个
  `>=0.2.0-rc.1 <0.3.0-0 || >=0.2.1-alpha.1 <0.4.0-0`，并全部标记 `peerDependenciesMeta.optional`。
  验证（semver 实测）：`0.2.0-rc.2` / `0.2.1-rc.3` / `0.2.1-alpha.5` / `0.2.0` / `0.2.1` / `0.3.0` 命中，
  `0.4.0` / `0.1.0` 不命中；cordis `4.0.4` 命中。

### Fixed

- **发布包里的 invariant companion 曾在错误的包名下注册。** `lib/invariant.js` 里硬编码的
  `PACKAGE_NAME` 是上游 scope 名 `@deepseek-ai/dsh-session-categories`，而发行包名是
  `dsh-session-keeper`，两者不是同一个 key，宿主侧的 invariant 注册会与上游包撞车。
  源码里的常量已改为 `dsh-session-keeper`，重新构建后产物自带正确名字。

### Added

- **仓库根 package.json 现在自描述为可安装的插件清单。** 声明了 `dsh.bundle` 与
  `dsh.client`，去掉了 `private`，`cordis.patch.yml` 里的行名与包名一致，
  发行布局（`lib/typert.host.js`、`lib/types/*`）一并纳入版本控制。
  这让仓库本身就能被插件市场与清单收录流程识别，无需依赖构建工作区。

### Removed

- **发行包里不再混入备份文件。** npm 打包会强制收录 `README*`，此前根目录的
  `README.md.bak-*` 会被打进 tarball；现由 `.npmignore` 拦截，备份另存于 `_backups/`。

## [1.1.9] — 2026-10-23

### Fixed

- **置顶开关导致的侧边栏渲染崩溃（1.1.8 回归）。** 1.1.8 把「置顶到分类上方」开关接进分类树渲染时，
  hoistPinned 是在 WorkspaceBrowser 组件里读取的状态，却直接被 SessionTree 内部的
  renderGroup 使用 —— 跨组件作用域，运行时抛 ReferenceError: hoistPinned is not defined。
  整个 sidebar.workspaces slot entry 因此崩溃，侧边栏静默回落到宿主自带的会话 UI，
  表现为「置顶抬升和开关都不生效」。现在该状态改为通过 prop 通道传进 SessionTree，
  跨组件引用消除，崩溃不再发生。

  升级到 1.1.9 即可 —— Host 侧接口、回收站八动词、置顶语义均无变化。

## [1.1.8] — 2026-10-23

### Added

- **置顶会话现在抬到分类之上。** Previously a pin only made the row lead its
  own category, so a pinned Session could never leave the group that owns it —
  the group order is what decides where a row appears, and the pin was applied
  inside the group. The category projection now lifts every pinned Session into
  one global section rendered above every category, so a pin reads as a
  statement about the whole list. The Host-side pin verbs
  (`pinSession` / `unpinSession`) are untouched; only the rendering changed.

- **「视图选项」新增「置顶会话」开关。** The new view option switches between
  the two readings of a pin:
  - 「置顶到分类上方」(default) — the pinned Session leaves its category and
    renders in one global section above every category;
  - 「保留在所属分类」 — the pinned Session stays in the category that owns it
    and merely leads that category.

  The choice is persisted with the rest of the browsing state
  (`dsh.session-categories.view.v2`), so it survives reloads and surface
  remounts.

## [1.1.7] — 2026-10-20

### Fixed

- **The delete bin works again after `dsh-session-recycle` is uninstalled.**
  The bin was dead for one reason: this plugin carried only the Client half and
  every `/session-recycle/*` route came from that separate package. Once the
  human uninstalled it, the bin reported `delete-failed` and 「无法统计删除范围」.
  The Host half now serves the whole lifecycle itself, so the fork depends on no
  other recycle plugin. The five recycle verbs (`listRecycledSessions`,
  `deleteSessions`, `undoSessions`, `purgeBatch`, `sweepRecycledSessions`) and
  three transcript/scan verbs (`scanSession`, `readTranscript`,
  `listTrashedSessions`) are all registered through typert Remote on
  `sessionCategories`, and the Client calls them through the API gateway
  (`/api/sessionCategories/*`) instead of fetching a route the Host never
  registered.

- **The Client no longer crashes on the batch list.** A Remote reply is wrapped
  twice (`{ok, value:{ok, value}}`); the controller unwrapped one layer and then
  called `.filter` on the wrapper, which took the whole settings page down. Both
  Remote calls now go through the same two-step unwrap the rest of the controller
  uses.

- **The Client no longer double-wraps the Remote argument.** `controller.ts`
  sent `{ request: {...} }` to a stub whose first parameter already *is* the
  wire request, so the gateway answered `input-invalid` for every verb.

- **`seed/typert.host.js` no longer ships a bare `export`.** The descriptor
  injector used to split the `export` keyword off the `TYPERT` declaration and
  leave `export // --- comment ---` behind, which is a syntax error: the whole
  Host module failed to import and every verb 404'd. The injector now anchors on
  the declaration and cleans up any bare export left by older runs.

### Changed

- `scripts/pack-release.mjs` defaults to this fork's own installed copy
  (`dsh-session-keeper`) instead of the upstream `dsh-session-categories`
  directory, which this profile no longer has. The identity rewrite also covers
  the double-quoted `PACKAGE_NAME = "@deepseek-ai/dsh-session-categories"` in
  `lib/invariant.js`, which the single-quoted rules missed.

## [1.1.6] — 2026-10-18

### Added

- **Categories can be dragged into order among their siblings.** Dropping a
  category row on another category row now calls `reorderCategory(sourceId,
  anchor, half)`, which the Host has supported since the beginning
  (`@Remote('reorderCategory')`, `${index.ts}:174-186` — it resolves the anchor
  among same-parent siblings and rejects with `anchor-not-found` otherwise).
  Only the client half was missing: `CategoryRowItem` had no `onReorder` prop, so
  the drop went straight to `moveCategory` and re-parented the category instead
  of sorting it. Cross-level drops still mean "move under that parent" — the two
  gestures are told apart by `half`: a drop on the top or bottom edge sorts, a
  drop on the middle band moves.
- **`tmp/audit/14-category-sort.mjs`** — eight assertions over the sibling
  order, the insert-line marker, row preservation, and a reload round-trip.
  Loading the payload is the awkward part: building a fresh `DataTransfer` per
  event yields an empty `types` list, and `if (!hasCategoryDrag(event.dataTransfer))
  return` then throws the hover and the drop away before React ever sees them.
  The suite instead lets the real `onDragStart` populate a transfer, parks it on
  `window.__auditTransfer`, and reuses that instance for `dragenter` / `dragover`
  / `drop`.
- **`snapshotViewStore()` / `restoreViewStore()` in `cdp.mjs`, wired into the
  three drag suites.** `12`, `13` and `14` all perform *real* drags, which write
  through `stores.ts` to `localStorage['dsh.session-categories.view.v2']` — the
  same key the browser persists, so a suite run silently rewrites the human's
  own order. Each suite now snapshots the whole blob before it starts and puts it
  back afterwards, then asserts the write stuck. A whole-blob snapshot is used
  rather than inverting the permutation, because one drag can write several keys
  at once (the category sequence *and* the recency promotion).
- **`store-fingerprint.mjs` and `store-diff.mjs`.** The fingerprint prints bytes,
  sha256 and a per-account entry count; the diff walks a saved snapshot against
  the live store key by key and prints
  `.sessionOrderByAccount.<uuid>.0  saved: … live: …`. A whole-blob hash changes
  for reasons that have nothing to do with drags — the diff is what tells you
  which account actually moved.

### Fixed

- **`13-category-drag.mjs` treated every category in a section as one** (6/9).
  It collected all rows with `--category-depth === '1'` into a single list, so
  once the sidebar grew a second category the suite picked the dragged row from
  one parent and the anchor from another. That is a cross-parent drop, which the
  Host refuses on purpose (`anchor-not-found`), so the order legitimately never
  changed and three assertions failed against working code. `bucketsOf()` now
  opens a new bucket on every `--category-depth === '0'` header, both the plan
  and the drop stay inside one bucket, and a new assertion checks that sibling
  categories were left alone. 11/11.
- **`run-all.mjs` grew a fourteenth entry** and the totals it prints are the
  source of truth for a release: **14/14 green**, `view mode: restored`.

### Changed

- **The audit view-store key is now owned by one place.** `cdp.mjs` exports
  `VIEW_STORE_KEY` next to the snapshot helpers, so the three drag suites, the
  fingerprint tool and the diff tool cannot drift onto different keys.
- **Distributed as `dsh-session-keeper` (显示名「会话管理」).** The upstream name
  `dsh-session-categories` belongs to `ht719` on npm and can never be published
  to from this account, so the fork ships under its own name. Renaming the
  manifest alone is not enough — see the identity notes below.

### Publishing notes (first public release)

- **The bundle's registration id *is* the package name.** `tsdown.config.ts`
  writes `window.__ModuleLoader__.load({ id: PACKAGE_NAME, … })` and
  `inline-css.mjs` stamps `data-plugin` / `data-plugin-css` from the same
  constant. `dsh-client-modules` keys its factory table and its `/plugins/??`
  combo URL by *package name*, then calls `materialize(id)` — a mismatch fails
  with `client-modules: no registered factory for "<id>"` and the plugin simply
  never mounts. Both constants now read `dsh-session-keeper`.
- **`lib/typert.host.js` must be regenerated, not copied.** `dsh-typert-loader`
  validates `manifest.package === pkgName` and refuses otherwise:
  `typert-loader: <pkg> TYPERT manifest names package "<other>" — the manifest
  must be owned by the package that exports it`. `pack-release.mjs` used to take
  this file from the installed profile, which still carried the upstream name;
  it now writes the renamed `seed/typert.host.js` and the freshly built
  `lib/typert.remote-client.js` over the staged copy.
- **`lib/types/invariant.js` carries the invariants registry key.**
  `ctx.invariants.register(PACKAGE_NAME, …)` throws `already registered` if two
  packages claim the same key, so `pack-release.mjs` walks the staged `lib/` tree
  and rewrites the distribution name in `.js` / `.d.ts` files. Only quoted
  specifiers are touched — every `@deepseek-ai/…` name is an internal build-time
  module aliased by tsdown and must stay as-is.
- **`verify-tarball.mjs` can no longer diff `lib/client.js` against the installed
  profile.** The installed copy still registers the old id; the assertion that
  matters is "the tarball carries exactly what the build produced", plus a new
  sweep proving no staged file still advertises `dsh-session-categories#`.

## [1.1.5] — 2026-10-18

### Added

- **Sessions inside a category can be dragged into order.** The rows were
  already `draggable`, but the category branch never received a `drag` prop, so
  `drag?.start()` was a no-op: you could pick a row up and it would never land.
  Categories now get their own account key (`category:<id>`, see
  `categoryOrderKey` in `stores.ts`) and their own commit path. That path is
  **client-side only** — the Host has no per-category sequence, unlike a
  workspace — so it never calls `insertSessionBefore`.
- **`CategoryNode.orderedSessionIds`.** The pre-pin order of a category, which
  is what an in-category drag must write. Writing the rendered order instead
  would freeze the pin into storage: unpin a session later and it would stay on
  top forever, because the stored array already says so.

### Fixed

- **A drag inside a category wrote the store but reordered nothing.** The write
  side used `categoryOrderKey(categoryId)` → `category:89655ab9-…`; the read
  side used `view.categoryOrder?.[id]` → `89655ab9-…`. Two different strings,
  both typed `string`, so **TypeScript could not see it and `tsc` did not
  report it**. `applyCategoryOrder` always received `undefined`, always returned
  its input, and every drag was silently discarded at render time. Both sides
  now go through `categoryOrderKey`.
- **A stale order in any category-bearing workspace ignored every drag.** This
  is the same family as the bug above, and as the earlier one in the workspace
  tree: `categoryProjection` passed `buildCategoryTree` the **Host-order**
  `workspaces[…].sessionIds`, not the stored-order
  `orderedWorkspaces[…].sessionIds`. Whenever a workspace had a category
  snapshot, `categoryProjection.unclassifiedSessions` replaced `group.sessions`
  wholesale, so the stored order was computed correctly and then thrown away.
  Verified by reversing a stored order and reloading: the rendered order was
  identical either way.
- **The drag anchor was resolved against the wrong array.** `commitSessionDrag`
  located its target with `group.sessions.findIndex(...)` — the *rendered*
  sequence, which `buildGroup` has already re-partitioned to hoist pinned
  sessions. Pinned rows are not present in the stored sequence, so every anchor
  below a pin was off by however many pins sat above it. The new
  `storedAnchorFor(...)` walks the drop slot and returns the first id that is
  neither the dragged row, nor pinned, nor absent from the stored array —
  `undefined` meaning "append".

### Changed

- **`04-settings-sections.mjs` no longer counts the `settings.section` React
  #185 as its own failure.** The crash is real but pre-existing and belongs to a
  neighbour: six plugins register `settings.section` (dsh-bili-scroll,
  dsh-config-manager, dsh-qq-plugin, dsh-workbuddy-xdpool, dshmarket,
  dsh-prompt-setting) and ours registers only `settings.plugins.tab`. Swapping
  the *previous* bundle back in reproduces the identical line. `cdp.mjs` now
  carries a `KNOWN_ISSUES` list with the owner and the evidence, and
  `partitionErrors()` fails the audit only on lines that are **not** on it —
  the known line is still printed, so it cannot disappear unnoticed.
- **`tmp/audit/run-all.mjs`** runs all thirteen live suites back to back, with a
  reload between them (they contaminate each other: a leftover modal makes
  `01-sidebar.mjs` read `treeitems=0`) and `restore-view.mjs --apply` last
  (`01-sidebar.mjs` walks flat → workspace-tree → workspace and stops on
  `workspace`, which is not where the human left it). At that point: **13/13
  green** — 1.1.6 adds a fourteenth suite.
- **Four comment lines that had been through the wrong codec are readable again.**
  A UTF-8 em dash and arrow decoded as GBK left `鈥?` / `鈫?` / `鍙栨秷褰掓。` in
  `WorkspaceBrowser.tsx`, `rows/Rows.tsx`, `tree.ts` and `13-category-drag.mjs`.
  Purely cosmetic — all four sat in comments or `console.log` format strings — but
  the mojibake also poisoned `scripts/rename-package.mjs`'s damage check, whose
  pattern list included ordinary Chinese characters (`错`, `误`) and therefore
  would have failed the rename on correct prose. That check now matches only
  U+FFFD and the two unambiguous GBK misreadings, written as `\u` escapes so the
  checker does not contain the bytes it hunts for. `tmp/audit/probe-encoding.mjs`
  scans the tree the same way and reports **0 suspicious lines**.

## [1.1.4] — 2026-10-18

### Added

- **Empty the whole recycle bin in one go.** A new button next to the existing
  batch verbs, with its own confirmation that names the number of batches and
  sessions. It reuses the per-batch verb rather than introducing a
  delete-everything call, so one batch failing part-way through leaves an
  honest partial result instead of a half-taken bin. *Source: the handover's open
  item "没有「一键全清」".*
- **Deleting a category that holds a running session now says so.** The
  confirmation gains a line: `其中有 N 个会话正在进行中，删除分类会一并停止它们`.
  The Host already stopped those Sessions (`stopActivity`), but the browser
  reported only a count — so the one consequence a user cannot infer from the
  numbers was invisible. *Source: the handover's known issue #3.*
- **The empty recycle bin explains itself.** `回收站是空的` is now followed by
  a quieter line saying deleted sessions land there first and can be restored.

### Fixed

- **`purgeBatch` / `sweepTrash` were wired through as raw controller Results.**
  The controller answers `{ ok, value }`; the slot contract wants the value or a
  thrown failure. Passing the Result straight through left the caller reading
  `outcome.reclaimedBytes` off a discriminant, so the byte count was `undefined`
  and the failure branch could never be reached. All three injection points
  (Settings tab, footer dialog, sidebar) now translate. Caught by `tsc`, not by
  the test suites — which is why `npx tsc --noEmit -p tsconfig.client.json` now
  belongs in the build checklist, not just `tsdown`.

### Tooling

- `01-sidebar.mjs` (20 checks, was 19) and the new `11-items-134.mjs` (11 checks)
  expand the sidebar before counting anything. A collapsed sidebar renders no
  plugin content at all, so `treeitem = 0` with zero console errors — the exact
  signature of a silently crashed slot. Both probes now assert the sidebar is
  expanded first, so that state can no longer masquerade as a regression.
## [1.1.3] — 2026-10-18

### Added

- **Group the recycle bin by batch.** The bin rendered one flat row per Session,
  so a batch's identity, delete time and size were repeated on every line and
  the only two verbs that act on a batch had nowhere sensible to live. Batches
  are now the visual unit: one head row (`N 个会话 · <bytes>` plus the delete
  time and the batch id) with its Sessions nested underneath. *Source: the
  handover's open item "批次分组展示：现在是一行一个会话，批次信息重复".*
- **彻底删除 (purge) one named batch.** The bin was undo-only: `sweepTrash`
  could answer "everything past a retention policy" but nothing could express
  "erase *this* row". Added the Host route `/session-recycle/purge-batch`, the
  `purgeBatch` controller verb, and a per-batch button. Because this is the one
  irreversible action the plugin offers, it is gated behind a
  `RiskConfirmation` dialog whose confirm button stays disabled until the
  acknowledgement is ticked. *Source: the handover's open item "现在只有撤回最近一批，
  没有清空回收站/按批次删除".*
- **清理过期 button.** Wires the existing `/sweep` route (previously Host-only)
  into the UI with the Host's own retention defaults (newest 20 batches / 30
  days) spelled out in the label.
- **复制全部 for the plugin log.** The diagnostic ring was readable but not
  exportable; one click now puts the whole trail on the clipboard as TSV.

### Security

- `purge-batch` validates its argument twice before touching the disk: a strict
  batch-name shape (`^[A-Za-z0-9][A-Za-z0-9._-]*$`) and a resolved-path check
  that the target is a **direct child of the bin root**. A batch that the bin is
  not holding answers `ok: false` instead of reporting a purge that never
  happened. Covered by seven traversal cases and a two-batch isolation case in
  `verify-host.mjs` (40 checks total).

### Fixed

- **`scripts/test-menu-render.mjs` and `scripts/test-session-menu.mjs`** were
  failing against correct code. Their probes predated the current `Rows.tsx`
  and asserted three things that had since changed by design: single-quoted ids
  in the source vs double-quoted in the bundle, `danger` (the field the Menu
  primitive actually reads) vs a `destructive` spelling that does nothing, and
  an `onSelect` anchor that landed on the **category** menu instead of the
  session menu. The ternary probe also used a fixed 300-character window that
  ran past each entry into its siblings. All four are now anchored to the thing
  they meant to test; both suites pass against the source tree and against the
  previously installed artifact.
## [1.1.2] — 2026-10-17

### Added

- **The sidebar-footer 会话管理 button now opens a real dialog.** It used to do
  one thing — set the archived filter to "show" and hope the user scrolled to
  the section. It now opens the recycle bin, the undo verb and the plugin log
  right where the user clicked. *Source: user report with a screenshot of the
  footer button — "或者把设置放到这里，点击弹出窗口".* A plugin cannot open the
  Settings page by itself: `sidebar.footer.action` hands over only `wide`, and
  the settings shell's store (`actions.openSection`) belongs to its own occupant,
  so a dialog on this button is the reachable surface. The body is the same
  `SessionManagerSettings` component the Settings tab mounts, so the two entries
  cannot drift.
- **按工作区树 grouping.** The view menu regained the official browser's third
  grouping mode, which this sidebar was missing. A Workspace whose folder sits
  inside another Workspace's folder now renders as a **nested section inside its
  parent's section** — its header, categories and sessions all sit one step in,
  the same shape the official browser produces — instead of as an indented
  sibling row. The link is the nearest registered ancestor folder, counted by
  strict path boundary, and the shared `--dsh-workspace-indent` step is what the
  header row and the overflow button measure against. *Source: user report —
  官方有「按工作树」分组，本插件没有，要求加回去.*
- **Settings page: recycle-bin manager with a transcript viewer.** The new
  `settings.plugins.tab` occupant lists every Session sitting in the bin
  (batch, deletion time, size) and can open one to read the stored conversation,
  so a second delete is an informed decision. It also renders the plugin's own
  action/failure ring (`diagnostics.ts`) newest-first, so a refused archive or a
  failed delete leaves a reason instead of a toast that disappears.
- **Host routes `/session-recycle/trashed` and `/session-recycle/transcript`.**
  The transcript reader inflates the whole multi-frame zstd log; the messages
  view keeps the conversation and counts tool calls instead of listing them.
- **Regression suites.** `scripts/test-workspace-tree.mjs` pins the nesting rule
  (sibling vs child vs grandchild, prefix-not-a-boundary, trailing slash, case
  folding, POSIX backslashes, cycles); `scripts/test-inline-css.mjs` pins the
  build's CSS inlining (side-car removal, import stripping, preamble anchoring,
  loud failure when the anchor moves); `scripts/verify-shipped-nesting.mjs`
  lifts the compiled derivation out of the *installed* artifact and re-checks
  the parent links, so a green build cannot hide a broken ship. `verify-host.mjs`
  grew cases for both new routes.

### Fixed

- **`groupBy.workspaceTree` locale key was missing.** The English dictionary is
  typed `satisfies Record<WorkspaceKey, string>`, so a mode with no copy broke
  the build; the key now exists in Chinese and English.

### Changed

- README (both languages) documents the three grouping modes, the settings page
  and the two new routes.

## [1.1.1] — 2026-10-17

### Added — session lifecycle

- **Delete session with a recovery bin.** Rows now offer 删除会话, which moves the
  stored log into a batch folder under the DSH data directory and keeps the batch
  restorable. *Source: the gap called out by [六道一一锁凡尘 / dsh-session-purge](https://github.com/hshh603/dsh-session-purge)
  (BV1YCpr6eEay); the recycle-bin plus undo behaviour is this project's own — purge
  deletes permanently, this build never does.*
- **Three delete scopes**: session record only, record plus the files the session
  wrote inside its working directory, and (reserved) everything. *Source: adopted
  from dsh-session-purge's scope model.*
- **Pre-delete scan.** The confirmation dialog runs `/session-recycle/scan` first
  and lists every file that would move, every refused file with its reason, and
  the total size. *Source: adopted from dsh-session-purge.*
- **Artifact safety rules.** Deletion only ever touches paths whose realpath is
  strictly inside the session's working directory and outside the DSH home;
  symlinks, missing files and anything else are refused with a Chinese reason
  string. Logs are read before they are moved, because persistence cannot read a
  log once it has left the sessions tree. *Source: adopted from dsh-session-purge;
  the realpath gate is this project's.*
- **Unarchive.** Row menus flip 归档会话 to 取消归档 for archived rows and restore
  the session to its workspace slot. *Source: user report — the finished menu verb
  never appeared because the archive set reached the row-verb argument only as a
  filtered (empty) set.*
- **Archive section.** Archived sessions are gathered into a trailing 归档会话
  section instead of scattering across workspace groups: its header carries an
  archive glyph, its rows carry a leading glyph, dimmed titles and an 已归档 line
  in the hover card, and the whole section disappears when the filter hides
  archive. *Source: user report — with archived and live rows looking identical,
  the archive state was only discoverable by opening the row menu.*

### Added — sidebar

- **Pin**: 置顶会话 / 取消置顶 reorders the row to the top of its group and flips
  the label with the registry pin state. *Source: this project's own; missing from
  the upstream client bundle.*
- **Official-parity archived filter**: the view menu now mirrors the official
  browser's 筛选会话三态 — 隐藏已归档 / 全部对话（包括已归档）/ 仅显示已归档 — with
  the same icons. *Source: the official `@deepseek-ai/dsh-client-ui-workspace`
  menu, matched after a user-annotated screenshot; the second label deliberately
  reads 包括 instead of the official 显示, per that annotation.*
- **Session row verbs sit at the far right.** Hovering a row hides its timestamp
  and the `⋯` button lands in that same right-edge slot. *Source: user annotation
  on a row screenshot.*

### Fixed

- **Archive markers were lost while archived rows were revealed.** `deriveGroups`
  and `deriveFlat` used one set for both visibility filtering and row-verb
  marking; the browser empties the visibility set when it reveals archived rows,
  which blanked every verb. Both functions now take a separate `verbSessionIds`
  parameter (defaulting to the old argument, so nothing else changes).
  *Symptom first reported by the user as「取消归档」缺失.*
- **`buildCategoryTree` ignored the row-verb set.** The fifth argument was never
  passed, so category-projected rows could not know they were archived. It now
  receives the raw registry set while the view object keeps the filtered set for
  visibility. *Source: this project's own audit.*
- **Missing locale key** `menu.unarchiveSession` made the unarchive row render the
  raw key. Added in Chinese and English.
- **Archive section never appeared where it was asked for**, because its presence
  was gated on the visibility set — which the "show archived" toggle deliberately
  empties. Presence is now decided by an explicit `showArchiveSection` flag.
- **`showArchived` was referenced outside its scope** inside `SessionTree`, which
  crashed the slot and made the official sidebar take over. The value is now a
  prop. *Detected with a console capture across a page reload.*
- **Hover verbs floated next to the title** instead of the far right, because the
  `auto` margin that pushed the timestamp right disappeared together with the
  timestamp. The actions cell now carries its own `margin-left: auto`.
  *Reported with a screenshot.*

### Changed

- View state persists under `dsh.session-categories.view.v2`, carrying a
  three-state `archivedFilter` instead of a boolean.
- Deleting a session now also detaches it from every workspace roster and releases
  it from the archive set, and undo re-attaches and re-archives it.
  *Source: user report — a deleted archived session kept its row after the log
  was gone.*

## Upstream baseline

Versions before 1.1.1 are the upstream project's. This build began from
`ht719/dsh-session-categories` at `0.1.0-rc.x` and carries the client-side port
patches described in `BUILD.md` (runtime split, store re-source, subagent shim,
`currentSessionId` migration, `uiWorkspace` service, icon renames, and a recovered
`Rows.module.css`).
