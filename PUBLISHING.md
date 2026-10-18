# 怎么让插件出现在 DSH 插件市场里

> 结论先行：**DSH 市场没有「提交审核」这个动作**，它不存插件，只从「目录来源」拉清单。
> 要让插件出现在那里，只有两条路：**发到 npm** + **被某个目录来源扫到**。

本文依据：DSH Desktop 内置的 `dsh-community-market` 包（`resources/app/node_modules/`），
其 `README.zh.md` 与 `docs/catalog-provider-contract.zh.md`。

---

## 一、市场的工作机制

```
用户设备
  │
  ├─ 市场插件（dsh-community-market，DSH Desktop 内置）
  │      │
  │      └─ 从「当前选中的一个目录来源」拉清单
  │             │
  │             ├─ 标准来源：GET https 上的 /v1/plugins（JSON）
  │             └─ 合作来源：DSH 1024Store / dshfind（内置 adapter）
  │
  └─ 用户在列表里点某个插件 → 市场去 npm 查 latest → pnpm 装
```

关键点：

- 市场**没有默认来源**，用户必须自己选一个（1024Store 或 dshfind，或自己加的）
- 市场**不审核**插件；"收录" ≠ 安全背书（原文反复强调）
- **自动安装的硬性条件**（缺一不可）：
  1. 条目提供**唯一**的 npm 包名
  2. 该包名不是 Desktop 自己的产品 bundle
  3. npm 官方 registry 的 `latest` 返回**同一个包名**且是**精确稳定版本**
  4. npm manifest 声明合法的 **`dsh.bundle.patch`** 路径

⇒ 第 3、4 条决定了：**插件必须先发到 npm 官方 registry**，否则市场里点「安装」是灰的。

## 二、两条路

### A 路：被 1024Store / dshfind 自动扫到（主流）

现状观察（2026-10-17 实查）：

| 事实 | 数据 |
|---|---|
| 1024Store 收录数量 | **13,803** 个 |
| 条目路径形态 | 几乎全是 `owner/repo/子路径` —— **GitHub 仓库形状** |
| 更新频率 | 每日 |

⇒ 这么大的量、这种路径形态，说明它是**爬 GitHub 仓库**的，不是人工收录。

**推论**：有一个公开 GitHub 仓库 + 仓库里是个合法的 DSH 插件包 → 会被扫到。
具体触发条件（仓库要带什么 topic / 什么目录结构）1024Store 没有公开文档，
但同赛道插件都是这个形状，照做即可。

### B 路：自己做「目录来源」（可控，但要运维）

市场支持任何符合公开契约的**标准来源**：一个 HTTPS 上的静态 `manifest.json`
+ 一个 `GET /v1/plugins` endpoint。用户可以把这个地址手动加进市场。
不需要跟市场方合作、不需要改市场代码。

代价：你得自己有个域名 + HTTPS 服务，且用户要手动加地址（不会自动出现在别人的市场里）。
⇒ 适合「自己的插件站」，不适合「让所有人都能搜到」。

## 三、给本项目的建议路径

```
① 发 npm（硬门槛，两条路都要）
   └─ 包名 dsh-session-keeper + version 1.1.6 + package.json 里 dsh.bundle.patch 指向 cordis.patch.yml

② 建 GitHub 仓库 WSNMM3/dsh-session-keeper
   └─ 仓库名与包名一致，README 写清是 DSH 插件
   └─ 放源码 + 已构建产物 + 标注 dsh / dsh-plugin / deepseek-harness 之类 topic

③ 打 tag + 建 GitHub Release（v1.1.6，附 tgz）
   └─ 很多分发渠道只认 Release，不抓 npm

④ 等 1024Store 扫到（每日更新），用户就能在市场里搜到并一键安装
```

**进度（2026-10-18 22:10）**

| 步骤 | 状态 |
|---|---|
| ① npm 发布 | ✅ `dsh-session-keeper@1.1.6`，`dist-tags.latest = 1.1.6` |
| ② GitHub 仓库 | ✅ https://github.com/wsnmm3/dsh-session-keeper（86 文件，`main` 分支） |
| ② 仓库 topic | ✅ `dsh` / `dsh-plugin` / `deepseek-harness` / `cordis` / `session-manager` / `session-categories` / `plugin` / `typescript` |
| ② 仓库 homepage | ✅ 指向 npm 包页 |
| ③ Release | ✅ `v1.1.6`，含 `dsh-session-keeper-1.1.6.tgz`（344399 B，sha256 `4644572722759c6a5b5739460a65b225c96a2a99ca87198c0798cb65f529fa45`） |
| ④ 等市场扫到 | ⏳ 每日更新，无公开触发文档 |

⚠️ 顺序不能反：**先 npm 后 GitHub**。因为市场点安装时是去 npm 查 `latest`，
如果 GitHub 先上线而 npm 没包，用户看到条目但装不了。

## 四、当前项目的合规检查（对照市场要求）

| 要求 | 状态 |
|---|---|
| 唯一 npm 包名 | ✅ **`dsh-session-keeper`**（2026-10-18 实查 registry 404 = 未被占用） |
| npm `latest` 是精确稳定版 | ✅ `1.1.6`（无 prerelease 后缀） |
| manifest 声明 `dsh.bundle.patch` | ✅ `./cordis.patch.yml` |
| `cordis.patch.yml` 存在且合法 | ✅ `name: 'dsh-session-keeper'` 与 manifest 一致 |
| 包可被 pnpm 安装 | ✅ 已解包验证，8 个导出路径全部可解析 |
| client bundle 加载契约 | ✅ `__ModuleLoader__.load` + 内联 CSS |

## 五、仍然需要人工解决的前置条件

1. **npm 账号登录** — ✅ 已完成（`npm whoami` → `wwiyy`；granular token 在 `C:\Users\ASUS 98\.npmrc`，**2026-11-17 过期**）
2. **GitHub 仓库** — ✅ 已完成（`gh auth status` → `wsnmm3`；仓库 https://github.com/wsnmm3/dsh-session-keeper）
3. **包名** — ✅ 已定为 `dsh-session-keeper`，见下文「命名」
4. **GitHub Release** — ✅ `v1.1.6` 已建并附 tgz

## 六、命名

中文名定为「会话管理」。**英文名已定：`dsh-session-keeper`**（2026-10-18 实查 registry 返回 404，未被占用）。

以下是调研时排除的**已被占且功能撞车**的：

| 包名 | 状态 | 说明 |
|---|---|---|
| `dsh-session-manager` | 占用 (0.7.1) | 也是会话/工作区管理，功能重叠 |
| `dsh-session-center` | 占用 (0.4.2) | 跨工作区会话总览 |
| `dsh-session-admin` | 占用 (0.2.0) | — |
| `dsh-session-hub` | 占用 (0.1.0) | 跨服务器聚合会话 |
| `dsh-session-workbench` | 占用 (1.0.3) | — |
| `dsh-session-organizer` | 占用 (1.0.0) | — |
| `dsh-session-steward` / `-curator` | 占用 | — |
| `dsh-session-folders` | 占用 (0.4.3) | — |
| `dsh-session-deck` | 占用 (0.2.1) | — |
| `dsh-session-vault` | 占用 (0.1.2) | — |
| `dsh-session-tree` | 占用 (0.1.0-beta.1) | — |

同期实测**可用**但未采用的：`dsh-session-manage`、`dsh-session-desk`、`dsh-session-panel`、
`dsh-session-studio`、`dsh-session-craft`、`dsh-session-portal`、`dsh-session-rack`、
`dsh-session-cabinet`、`dsh-session-workshop`、`dsh-session-forge`、`dsh-session-nest`、
`dsh-session-grove`、`dsh-session-bay`、`dsh-session-ledger`、`dsh-session-console`、
`dsh-session-shelf`、`dsh-session-drawer`、`dsh-session-board`、`dsh-session-atlas`、
`dsh-session-navigator`、`dsh-session-categories-fork`、`dsh-session-categories-zh`。

> ⚠️ 上游 `dsh-session-categories` 这个名字**永远发不了**：它属于原作者 `ht719`（`mr.right <2490890113@qq.com>`，只有 `0.1.0`）。fork 必须换名。
