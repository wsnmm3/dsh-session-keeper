# 会话管理 · dsh-session-keeper

English | [中文](README.zh.md)

Turn the dsh sidebar into something you can actually manage: **category trees, drag reordering, pinning, an archive section, and a delete bin you can undo from.**
Every Workspace keeps its own categories, every session belongs to at most one category, and a deleted session goes to the bin instead of vanishing.

| | |
| --- | --- |
| Package | `dsh-session-keeper` |
| Display name | **会话管理** (Session Manager) — the tab under Settings → Plugins |
| Version | `1.2.0` |
| License | MIT |
| Shape | Host entry + Web client bundle + Cordis profile patch in one package. No separate Client or Bundle package. |

> **Where this code comes from.** This is a maintained fork of
> [ht719/dsh-session-categories](https://github.com/ht719/dsh-session-categories) (`0.1.0`, MIT).
> The upstream package will not open on a current dsh at all. This repository ports it and then extends it.
> Every change records **where it came from** (upstream baseline, an idea taken from a competing plugin, or a
> user report) in [CHANGELOG.md](CHANGELOG.md); the porting details live in [FORK-NOTES.md](FORK-NOTES.md).
>
> **Do not install this together with the upstream package.** `dsh-session-keeper` and
> `@deepseek-ai/dsh-session-categories` both claim the `sidebar.workspaces` slot and both open the
> same storage domain (`session_categories`, version 0). Side by side they fight over the sidebar and
> write into one category document. Pick one — this fork, or upstream.

---

## Why this fork exists

Upstream `dsh-session-categories@0.1.0` shipped 2026-08-19 against an older dsh prerelease. dsh has since
**removed the `@deepseek-ai/dsh-client-runtime` package**, and the upstream client bundle still requires it:

```
upstream  lib/client.js requires:
  "@deepseek-ai/dsh-client-runtime/client"   <- no longer resolvable
```

The dsh module loader resolves a client bundle's `require` calls against the plugin's declared `inject` peers.
An unresolvable require throws while the bundle is being materialised, so the `sidebar.workspaces` slot entry
crashes on mount. The official sidebar takes the slot back, and because the crash happens during shell boot
the window never finishes opening — which looks like "dsh is dead".

This branch **rebuilds the bundle from source** rather than patching `lib/`, so a plugin reinstall cannot
undo the fix. Upstream is also missing two things: `Rows.module.css` is absent from the repository even though
`Rows.tsx` imports it, and the reconstructed stylesheet once carried a truncated `@keyframes row-in` block —
a single broken at-rule silently invalidates every rule after it. Both are repaired here; see
[FORK-NOTES.md](FORK-NOTES.md) and [BUILD.md](BUILD.md).

---

## Features

### 1. Category trees

- **Per-Workspace isolation**: a category in Workspace A never leaks into Workspace B.
- **Multi-level nesting**: a category can hold child categories; the inset grows with depth.
- Three ways to create one: the Workspace actions menu for a top-level category, the category `⋯` menu for a
  child, and **Move to category** on a session row.
- The category `⋯` menu: new child / rename / delete. Renaming is an **inline input** (Enter commits, Escape
  cancels) — no dialog.

### 2. Drag gestures

Five gestures, each with its own landing rule:

| Drag this | Onto | Result |
| --- | --- | --- |
| A session row | Another row in the flat list or a workspace group | Reorder (persisted locally) |
| A session row | A row inside a category | Reorder **within that category** |
| A session row | A category container | **Reassign** the session to that category |
| A category row | A sibling category row | Reorder **among siblings** |
| A category row | The **middle band** of another category row | Make it a **child** of that category |

A category dropped on another row's top or bottom edge sorts; dropped on the middle band it re-parents.
Cross-parent sorting is rejected by the Host (`anchor-not-found`) — sorting only means anything among siblings.

For manual order to stick, set **Order by** in the view menu to `Manual`. Left on `Last updated`, new activity
keeps pushing sessions back to the front.

### 3. Session actions

Every session row has a `⋯` button at its right edge; hovering the row lifts the timestamp and the button
takes that spot.

| Action | What it does |
| --- | --- |
| 重命名 / Rename | Rename the session |
| 分叉会话 / Fork | Fork at the last completed turn |
| 置顶会话 / 取消置顶 | Mark the row as prominent: pinned rows are hoisted into one global section above every category, or stay inside their own group — see the view menu in §4 |
| 归档会话 / 取消归档 | Archive the row, or return an archived row to its slot |
| 移动到分类… / Move to category | Reassign to another category, or drop back to the unclassified tail |
| 删除会话 / Delete | Move the stored log into the recovery bin (see §5) |

### 4. View menu

**Group by** (three modes, same as the official browser):

| Mode | What it does |
| --- | --- |
| By workspace | One flat section per Workspace |
| By workspace tree | Nest by directory path: a Workspace whose folder sits inside another Workspace's folder renders as a sub-section *inside* that section. Matched on strict path boundaries, so `E:\AI\DSHX` is not a child of `E:\AI\DSH` |
| Single list | One recency list, no grouping |

Paths are normalized before comparison (Windows separators, trailing separators and letter case ignored), so
`E:\AI\DSH` and `e:/ai/dsh/` are the same parent.

**Filter sessions** (three states, same as the official browser):

- **Hide archived** — the archive section and every archived row disappear;
- **All conversations (including archived)** — the section appears, expanded;
- **Archived only** — workspace groups are suppressed and only the archive section renders.

The second label reads 包括 rather than the official 显示 on purpose; the behaviour is identical.

**Pinned sessions** (one switch for every pinned row):

- **Hoist above categories** — pinned rows are pulled out of their category and gathered into one global
  section **above every category**. A pin is a statement about the whole list, not about one group;
- **Keep in their category** — pinned rows stay in the group they belong to and only lead that group.

The switch sits in the same view menu and defaults to **Hoist above categories**.

### 5. Delete and the recovery bin

Delete moves the session's stored log into a **batch directory** under the dsh data home. Nothing is
destroyed and the deletion stays reversible.

Before anything moves, the confirmation dialog runs `/session-recycle/scan` and lists:

- the size of the session record itself;
- every file the session wrote that would move with it, when a wider scope is chosen;
- **every refused file, with the reason it was refused**.

Three scopes: record only / record plus the files the session wrote inside its working directory / a reserved
everything scope. The safety rules are strict — only paths whose realpath sits **strictly inside the session's
working directory and outside the dsh data home** are ever touched; symlinks, missing files and everything
else are refused with a reason. Logs are read **before** they move, because persistence cannot read a log once
it has left the sessions tree.

Deleting also detaches the session from every workspace roster and releases it from the archive set, so no
orphan row survives. Undo reverses all three: it restores the log, re-attaches the roster entry, and
re-archives the session if it was archived before.

The bin manager lives under **Settings → Plugins → 会话管理**:

- grouped **by batch**, showing deletion time, session count and size;
- **看内容 / View content** opens that session's stored transcript, so a second delete is an informed decision;
- **撤回最近一批 / Undo newest batch** puts the newest batch back;
- **彻底删除** (one batch) and **清理过期** (keep the newest 20 batches / 30 days by default) — **both are irreversible**;
- **清空回收站 / Empty bin** purges every batch at once.

### 6. Plugin log

The **插件日志 / Plugin log** tab is a ring buffer, newest first, recording the plugin's own actions and
failures (archive, unarchive, delete, scan, undo). A refused action leaves a **visible reason** instead of a
toast that disappears. Copy-all is one click.

---

## Install

`dsh` must be available in your shell, then install into an unmodified dsh Web profile:

```sh
dsh plugin --profile web add dsh-session-keeper
dsh --profile web
```

From a dsh source checkout, use its package launcher instead:

```sh
pnpm dsh plugin --profile web add dsh-session-keeper
pnpm dsh --profile web
```

The repository already contains generated runtime files, so **no separate plugin build is required**.

From a tarball (offline, or to pin a version):

```sh
dsh plugin --profile web add ./dsh-session-keeper-1.2.0.tgz
```

Restart dsh afterwards. The plugin registers three slots — `sidebar.workspaces`, `settings.plugins.tab` and
`sidebar.footer.action` — and does not touch any core dsh package, nor require changes to `ui-workspace`,
`ui-slots`, or `api-remotes`.

---

## Notes and caveats

**1. Prerelease compatibility is not promised.**
The plugin targets the current dsh prerelease plugin APIs. When dsh upgrades, **update the plugin too** —
moving only one side easily hits a removed package or a renamed export, and the symptom is usually a missing
sidebar block or a window that never opens.

**2. "Permanently delete" really deletes.**
Delete is reversible (it goes to the bin). **Permanently delete**, **Clean up expired** and **Empty bin** are
**not**. The bin is not a backup — export anything important separately.

**3. View state lives in your browser.**
Grouping, ordering, category expansion, the archive filter and each account's manual order all persist under
`dsh.session-categories.view.v2` in **browser localStorage**. A new machine, a cleared cache or a different
profile loses them. Sessions and categories themselves do not live there and survive a cache clear.

**4. Deleting a category archives its sessions.**
Recursive delete **archives** the sessions inside (it does not delete them). Their logs are untouched and
they can be unarchived at any time.

**5. Cross-Workspace operations are refused.**
Moving a session into another Workspace's category, moving a category into its own descendant, or acting on a
stale revision are all rejected with a reason. That is protection, not a bug.

**6. Manual order needs the Manual setting.**
Left on `Last updated`, new activity keeps pushing sessions back to the top and overwrites the order you set.

**7. This plugin injects no global CSS.**
All styling goes through CSS Modules (hashed class names) scoped to the DOM it renders. It does not change the
sidebar's global width, the window background, or write to `document.body`. It therefore neither fixes nor
breaks shell-level layout problems.

**8. Uninstall.**
`dsh plugin --profile web remove dsh-session-keeper`. Categories and session data stay in dsh storage.

---

## Behaviour and data

- Recursively deleting a category archives its sessions; it never deletes their durable logs.
- Archive operations retry with the same operation id and recover after a restart.
- Mutations reject stale revisions, cross-Workspace session ids, descendant moves, and assignments to unknown
  categories.
- Batch directories live under the dsh data home as `<batch-id>/<session-id>/`, where a batch id looks like
  `2026-10-17T14-31-25-939Z`.

## Compatibility

The plugin targets the current dsh prerelease plugin APIs and is intended to work with an **unmodified** dsh
installation. dsh does not promise prerelease compatibility across versions — update dsh and this plugin
together when upgrading.

## Repository layout

The repository root is the **installable prebuilt package**. Source packages live under
`packages/workspace/session-categories/`, `packages/client/ui-session-categories/`, and
`packages/bundle/session-categories/`. Build notes — including the upstream gaps this fork had to patch —
are in [BUILD.md](BUILD.md).

## License and credit

MIT. Upstream copyright belongs to the original author, `ht719`; this fork keeps the same license and
attribution and publishes its changes under the same terms.
Upstream: [ht719/dsh-session-categories](https://github.com/ht719/dsh-session-categories).
