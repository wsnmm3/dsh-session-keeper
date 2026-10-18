# sc-build — dsh-session-categories 的可重复构建工程

> 这个目录的存在理由只有一条：**让 8 项客户端代差补丁不再是"补丁"，而是源码。**
> 以前那套是直接改 `node_modules` 里的 `lib/client.js`——插件一升级就全丢，得重打。
> 现在改**源码**、**真编译**，重建一条命令。
>
> 📄 上游发布用的 `README.md` / `README.zh.md` **原样保留**（将来发布要用），本文件只管构建。

---

## 快速开始

```powershell
# node / pnpm 不在默认 PATH 上，先补上
$env:Path = [Environment]::GetEnvironmentVariable("Path","Machine") + ";" +
            [Environment]::GetEnvironmentVariable("Path","User") + ";" + "$env:APPDATA\npm"

cd "E:\AI\DSH\DSH-Workspace\deepseek-harness\default-workspace\sc-build"
npx tsdown                      # 编译 → lib/client.js（+ 会多出一个 lib/style.css）
node scripts/inline-css.mjs     # 把 style.css 折进 client.js，删掉它
node scripts/verify-build.cjs   # 校验：语法 / 加载契约 / CSS 内联 / 依赖集合
```

产物：`lib/client.js`

装入（**client 半边刷新页面即生效，不用重启 DSH**）：

```powershell
Copy-Item "lib\client.js" `
  "C:\Users\ASUS 98\.dsh\profiles\desktop\node_modules\dsh-session-categories\lib\client.js" -Force
```

---

## 目录说明

| 路径 | 作用 |
|---|---|
| `tsdown.config.ts` | 打包配置：`__ModuleLoader__` 信封、typert 别名、`deps.alwaysBundle` |
| `tsconfig.base.client.json` | 基础 TS 配置（**故意不 extends 任何 dsh 内部文件**） |
| `tsconfig.client.json` | 客户端半边配置 |
| `scripts/inline-css.mjs` | **CSS 内联后处理**——见下，这步不能省 |
| `scripts/verify-build.cjs` | 产物校验，exit=0 才算过 |
| `packages/client/ui-session-categories/src/` | **源码**（补丁已合入） |
| `packages/.../src/typert.remote-client.js` | 生成的 typert 运行时（供 alias 内联） |
| `package.upstream.json` | 上游原始 `package.json`（发布清单，保留参考） |
| `../upstream/` | 从 GitHub 拉的上游源码快照 |

---

## 三个坑（都会再踩，别省这一步）

### 1. 上游**不是**可构建仓库

`ht719/dsh-session-categories` 是从 dsh monorepo 搬出来的**源码快照**：

- `packages/**/tsconfig.json` → `extends "../../../tsconfig.base.client.json"`（**不存在**）
- 依赖 `../../../vendor/cordis`、`ui-slots`、`ui-primitives`…（**全不存在**）
- `peerDependencies` 全是 `"workspace:^"`（**独立 clone 出来 `pnpm install` 都跑不通**）
- `.gitignore` 里 `packages/**/lib/` ⇒ **产物是签入的，不是构建出来的**

**正确的样板是** `resources/app/node_modules/dsh-community-market`：
独立仓库 + **实数版本** peerDeps（`0.2.0-rc.2`）+ 自带 `tsdown.config.ts`。
本工程的 `tsdown.config.ts` / `tsconfig*.json` 就是照它写的。

### 2. `@tsdown/css` 是**自动加载**的，而且 `inject` 不是"内联"

tsdown 源码里：

```js
if (pkgExists("@tsdown/css")) {
  const { CssPlugin } = await import("@tsdown/css");
  ...
}
```

⇒ **装了这个包它就自动生效，别在 config 里 `import css from '@tsdown/css'`**
（它只导出具名 `CssPlugin`，**没有 default export**，import 了直接崩）。

而且 `css.inject: true` 的语义是「**保留 import 语句指向 CSS 文件**」——
**不是**把 CSS 内联进 JS。产物会变成：

```js
import './style.css';   // ← 非法！它在 CJS 的 __ModuleLoader__ 信封里
window.__ModuleLoader__.load({ ... })
```

**host 的模块加载器只给 bundle 一个 CommonJS `require`，根本没有 CSS loader。**
⇒ 所以必须跑 `scripts/inline-css.mjs`：它删掉那句 import，把 CSS 折成
`<style data-plugin-css>` 注入。**校验标准：产物里 `data-plugin-css` 出现 1 次、`lib/style.css` 不存在。**

### 3. 依赖必须收敛到**4 个 require**

```
react
react/jsx-runtime
@deepseek-ai/dsh-client-store
@deepseek-ai/dsh-client-ui-primitives
```

加载器**只认插件 `inject` 名单里的 peer 包**。所以这些东西**必须打进包里**：

- `clsx`（小工具）→ `deps.alwaysBundle: ['clsx']`
- `zod` + typert 的 `TYPERT_REMOTE` → `deps.alwaysBundle: ['zod']`
  \+ `alias` 把 `@deepseek-ai/dsh-session-categories/remote` 指向
  `src/typert.remote-client.js`

少内联一个，运行时就 `client-modules: cannot resolve ...`。

---

## 已合入的 8 项补丁（在源码里，不在产物里）

| # | 代差 | 源码位置 |
|---|---|---|
| 1 | `dsh-client-runtime/client` 拆解 | `stores.ts`（→ `dsh-client-store`）、`types.ts`（本地类型面） |
| 2 | `defineStore` 换源 | `stores.ts` |
| 3 | `indexSubagentDescendants` 自写 shim | `tree.ts` |
| 4 | `list.current` → `currentSessionId(list)` | `tree.ts`（7 处）+ `WorkspaceBrowser.tsx`（3 处） |
| 5 | 服务上移：`open` / `startSession` / `pickDirectory` | `index.ts`（→ `ctx.uiWorkspace.*`） |
| 6 | `inject` 加 `uiWorkspace` | `index.ts` |
| 7 | 图标命名 `*Outline16` → `*OutlineRegular` 等 | `Rows.tsx`(37) + `WorkspaceBrowser.tsx`(9) + `WorkspacePicker.tsx`(4) |
| 8 | `package.json` 去掉 `dsh-client-runtime` | ⚠️ 见下 |

> ⚠️ **第 8 项属于 host 半边**（`lib/index.js` / `typert.host.js` 那两处：
> 包名去域名 + codec `create: () =>` 工厂 48 处），**本轮没有源码化**，
> 仍是 WB 侧打过的产物，**升级会覆盖**。要啃得另开一摊。

---

## ⚠️ 一个上游永远缺的文件

`packages/client/ui-session-categories/src/client/rows/Rows.module.css`

**上游仓库里根本不存在**（`Rows.tsx` 第 22 行 `import css from './Rows.module.css'`，
但文件没签入，`.gitignore` 也不背这个锅）。

本工程里那份是**从已发布产物的 `lib/client.js` 里反解回来的**：
把压缩 CSS 抠出来，剥掉 scope 哈希前缀 `QQanJW_`，还原成可编译的 `.module.css`
（39 个类名、7336 字节）。

⇒ **以后再从上游 clone，这文件仍然会缺。** 这份是唯一副本，**别丢、别覆盖**。

---

## 验收（2026-10-17 全绿）

| 检查 | 结果 |
|---|---|
| `scripts/verify-build.cjs` | exit=0（语法 OK / loader OK / CSS 内联 OK / 无 side-car） |
| `patch-sc\smoke.js` | 真物化 + 真调 `apply(ctx)` 全通，`inject` 含 `uiWorkspace` |
| `patch-sc\render-test.js` | **真实 React 18.3.1** 渲染 25 节点 / 11 类型 / 7 effect / **0 错误** |
| 与手工补丁版逐条对账 | **8 项全绿**（`currentSessionId` 14=14、`list.current` 0=0、`uiWorkspace` 5=5、`TYPERT_REMOTE` 2=2、`Outline16` 0=0、依赖集合完全一致） |

渲染树里**亲眼见到 `ViewOptionsMenu`** 与新图标名 `IconSearchOutlineRegular` /
`IconProjectAddOutlineRegular` —— 也顺带推翻了「官方菜单被顶掉」这个旧说法。

---

## 备份

- `lib/client.js.bak-fishrebuilt-20261017005415`（替换前的手工补丁版，319668 字节）
  在 `profiles\desktop\node_modules\dsh-session-categories\lib\` 下
- 上游源码快照：`..\upstream\dsh-session-categories-main\`
