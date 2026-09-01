# 来源获取扩展设计：本地收编、克隆提速与非 Git 来源

状态：设计稿（待评审）　日期：2026-09-01　基线：dsh-agent-plugins-market 0.5.3

---

## 0. 问题陈述

三个相互关联的问题：

1. **手动克隆的仓库在界面上不显示。** 用户因网络/代理原因无法从 UI 克隆 GitHub 仓库，只能手动 `git clone` 到 `~/.dsh/agent-plugins/.sources/`，但 UI 仍然看不到这些仓库。
2. **克隆慢且容易超时。** UI 克隆走 `git clone --depth 1`，固定 120 秒超时，无代理、无镜像、无重试；弱网环境基本不可用。
3. **来源类型只支持 Git 与本地目录。** Claude Code 官方已支持 `archive`（HTTPS zip）等 7 类 source，Codex 支持本地路径 / `owner/repo` / HTTPS / SSH Git URL；本插件市场需要跟上。

---

## 1. 现状与根因（证据）

### 1.1 为什么手动克隆不显示

**根因：用户维度只扫描 `state.json` 里登记的 sources，不扫描 `.sources/` 下的未登记目录。**

- `src/catalog/source-catalog.ts:30-37` — `discoverSourceListWithNotes()` 的 `checkouts` 仅由 `state.sources` 构造；
- `src/catalog/source-catalog.ts:38-47` — 只有 `dimension === 'project'` 才会 `readdir(checkoutRoot)` 把未登记目录纳入扫描；用户维度（`~/.dsh/agent-plugins`）没有这条分支。

**本机验证**（2026-09-01）：`~/.dsh/agent-plugins/.sources/` 下有 20 个目录，`state.json` 只登记 12 个 source。未登记的手动克隆包括：`browser-use`、`claude-code-config`、`claude-code-plugins-plus-skills`、`claude-plugins-community`、`context7`、`mcp-memory-service`、`skills`、`taste-skill` 共 8 个。

**连带坑：重新添加同一 URL 会导致二次克隆而非收编。**
`src/application/catalog.ts:377-418` 的 `addSource()` 先经 `pickSourceId()`（`catalog.ts:453-467`）选 id——若 `.sources/<id>` 已被手动克隆占用，会退避到 `<id>-2` 后缀，然后**克隆一份新的**，而不是直接登记现有目录。

**当前可用的 workaround**：`local: true` 源（UI「local dir」模式，`src/routes.ts:120-124`、`SourceEditorModal.tsx:57-76`）。把手动克隆的路径（绝对路径或 `~/…`）以本地目录形式登记即可立刻显示，且 `local` 源永不触发克隆/删除。

### 1.2 克隆路径现状

- `src/catalog/git.ts:17-24` — `git clone --depth 1 [--branch B]`，`execFile` 无 shell（防注入，保留）；超时固定 120s；无重试；`git pull --ff-only` 更新。
- 代理：`execFile` 继承 DSH 进程环境变量，`HTTPS_PROXY` 实际有效，但插件无自身配置项，GUI 进程通常不带代理变量；错误信息也不提示代理。
- 更新：`git pull --ff-only` 对 shallow 仓库有已知的 "refusing to fetch into branch" 类失败面。

### 1.3 对标：Claude Code / Codex 支持的来源类型（调研结论）

| 能力 | Claude Code | Codex |
| --- | --- | --- |
| GitHub `owner/repo`（可钉 ref） | ✅ | ✅ |
| Git URL（HTTPS / SSH，可 `#ref`） | ✅ | ✅ |
| 指向 marketplace.json 的远程 HTTPS URL | ✅ | ❌ 未找到依据 |
| 本地路径 | ✅ | ✅ |
| monorepo 子目录（`git-subdir`） | ✅ | ❌ |
| npm 包 | ✅ | ❌ |
| **HTTPS 压缩包**（`{source:"archive", url, sha256?}`） | ✅ 仅 zip、强制 HTTPS、≤256 MiB、可选 sha256（v2.1.224+） | ❌ 未找到依据 |
| 本地命令产出（`command`） | ✅（v2.1.229+） | ❌ |

来源：[Claude Code 官方文档 · plugin-marketplaces](https://code.claude.com/docs/en/plugin-marketplaces)、[openai/codex PR #17087](https://github.com/openai/codex/pull/17087)、[PR #21396](https://github.com/openai/codex/pull/21396)。注：本仓库 `scan-resolvers.ts:98` 对 `github-release` 的识别是对第三方方言的宽容，并非官方 schema。

---

## 2. 方案

### 2.1 问题一：把手动克隆的仓库扫描进来

分四层，递进实现：

**A. 立即可用的官方姿势（无需改代码）**：以 `local: true` 源登记手动克隆路径。文档化即可。

**B. 收编（Adopt）未登记 checkout —— 核心特性**

1. `overview()` / 前端扫描用户维度 `.sources/` 下未被 `state.sources` 占用的目录（目录名不含 `.` 前缀）；
2. 对每个未登记目录执行新增的 `git remote get-url origin`（`git.ts` 新 helper），拿到原始 URL；
3. Overview 的 Sources 区显示「检测到 N 个未登记的本地仓库」，每个带 **收编 / 忽略** 操作；
4. 收编 = 以「目录名 + origin URL」构造 `SourceRef` 追加进 `state.json`，**不克隆、不移动、不改 id**，与现有目录完全对齐。origin 读不到（非 git 目录）时也可收编，URL 记为 `local:` 占位或直接落为 local 语义。

**C. `addSource()` 幂等收编**：输入 URL 后，若候选 id 的 checkout 目录已存在，且其 origin 的 `canonicalGitUrl()`（复用 `scan-resolvers.ts:78`）与输入一致 → 直接登记复用现有目录，跳过克隆；不一致才按现状后缀避让。这同时修复「手动克隆后又在 UI 里添加同一仓库 → 二次克隆」的坑。

**D. （可选）自动发现开关**：配置 `scanUnmanagedSources`，用户维度概览自动附加未登记目录为只读临时源（无 URL、不可 refresh），适合「先看到、再决定要不要收编」。默认关闭，避免把垃圾目录扫进市场。

### 2.2 问题二：优化克隆速度

按收益排序：

1. **代理可配置**（弱网第一杀手）：插件配置新增 `git.proxy`（http/https 代理 URL），clone/pull 以 `-c http.proxy=… -c https.proxy=…` 注入；同时文档说明 `HTTPS_PROXY` 环境变量路径。克隆失败且错误含超时/连接类字样时，错误信息追加「可配置代理或镜像」提示。
2. **镜像模板**：配置 `git.urlRewrite`（如 `https://ghproxy.example/https://github.com/`→ 前缀替换）。git 原生做法是 `url.<base>.insteadOf`，等价于在命令行注入 `-c url.<base>.insteadOf=https://github.com/`。
3. **codeload tarball 回退**（GitHub 专用，与 2.3 的 archive 能力共用下载器）：git 协议被掐而 HTTPS 文件下载通常可达。`https://github.com/<owner>/<repo>` → `https://codeload.github.com/<owner>/<repo>/tar.gz/refs/heads/<branch|HEAD>`，下载解压到目标目录。策略：git clone 失败（或配置 `git.fallbackTarball: true`）后自动回退；lockCommit 用 tarball 的 ETag/`x-github-commit`（codeload 不带的话可先打 GitHub API 拿 sha，失败则记 `tarball:<sha256>`）。
4. **超时与重试可配置**：`git.timeoutMs`（默认 120s）、网络类失败重试 1 次；clone/pull 注入 `GIT_HTTP_LOW_SPEED_LIMIT=1000 GIT_HTTP_LOW_SPEED_TIME=30`，让僵死连接尽早报错而不是吃满超时。
5. **参数微调**：clone 追加 `--no-tags`（depth 1 已隐含 single-branch）。
6. **更新策略替换**：`git pull --ff-only` → `git fetch --depth 1 origin <branch> && git reset --hard FETCH_HEAD`（shallow 友好、更快、幂等），分支未钉时先 `git remote show`/`symbolic-ref` 解析默认分支或缓存首次克隆分支。

### 2.3 问题三：支持 Git 之外的来源形式

**SourceRef 扩展**（`src/model/types.ts`）：

```ts
interface SourceRef {
  id: string
  url: string                 // git URL / 本地路径 / 压缩包 URL
  branch?: string             // git only
  local?: boolean             // 现有：本地目录
  kind?: 'git' | 'local' | 'archive'   // 新增，可选；缺省按 url 形态推断（.zip/.tar.gz/.tgz → archive）
  sha256?: string             // archive 完整性校验（对齐 CC 官方 schema）
}
```

- `state.json` 只加可选字段，`version: 1` 不 bump，向后兼容。
- 推断规则：`local` 显式为真 → local；URL 以 `.zip/.tar.gz/.tgz` 结尾或 `kind` 显式 → archive；其余 → git。

**archive 来源的获取管线**（`src/catalog/archive.ts` 新模块）：

1. **下载**：Node 内置 `fetch` 流式下载到 `.sources/<id>/` 临时文件；强制 HTTPS（允许配置放宽为内网 http）；大小上限 256 MiB（对齐 CC）；可选 sha256 校验，不匹配即拒绝。
2. **解压**：zip 用纯 JS 依赖 `fflate`（零原生依赖、体积小）；`.tar.gz` 用系统 `tar`（macOS/Linux/Win10+ 自带）。**必须防 zip-slip**：逐条目校验解压目标不逃逸目标根目录。
3. **布局归一**：单顶层目录 → 剥壳取其内容为 source 根（与 GitHub codeload 行为一致）；多顶层目录 → 整体为 source 根。
4. **锁定语义**：archive 无 HEAD；`lockCommit` 记 `sha256`（有配置时）或下载响应 ETag/Last-Modified 哈希。
5. **refresh 语义**：archive → 重新下载比对 sha256/ETag，未变化则短路。

**复用关系**：下载器 + 解压器同时服务 2.2 的 codeload tarball 回退——一次建设，两处受益。这是先做 archive 管线的额外理由。

**marketplace entry 联动**（`scan-resolvers.ts`）：entry `source` 为 archive/zip URL 时，当前只能落成 `remote` 卡片；可在卡片操作里加「添加为 archive source」，把 URL 转成 `kind: 'archive'` 的 SourceRef 一键收编。

**npm / git-subdir / command**（Claude Code 独有能力）：列为后续 Phase，不在本期；`github-release` 非官方 schema，不建议做一级支持。

### 2.4 UI 变化

- `SourceEditorModal`：三段选择（Git / 本地目录 / 压缩包 URL）+ archive 的可选 sha256 字段；Git 段保留分支字段。
- Overview Sources 区：来源行显示 kind 徽标；未登记检测条（2.1-B）。
- `locales.ts` 补双语文案。

---

## 3. 实施分期

| 阶段 | 内容 | 量级 |
| --- | --- | --- |
| P0（文档） | 2.1-A：local 源登记手动克隆的用法写进 README | 极小 |
| P1 收编 | `git remote get-url` helper；overview 未登记检测 + adopt 路由（`sources/adopt`）；`addSource` origin 匹配幂等收编 | 小 |
| P2 提速 | 代理/镜像/超时/重试配置；`GIT_HTTP_LOW_SPEED_*`；fetch+reset 更新策略；codeload 回退（依赖 P3 下载器，可对调） | 中 |
| P3 archive | `archive.ts`（下载/校验/解压/防穿越）；SourceRef.kind；refresh/install/lock 语义；UI 三态编辑器 | 中 |
| P4（可选） | `scanUnmanagedSources` 自动发现；npm/git-subdir；entry→archive 一键收编 | 小 |

依赖关系：P1 独立；P3 的下载器被 P2 的 tarball 回退复用，若 P2 优先实施可先落下载器最小集。

## 4. 测试要点

- 收编：origin 匹配/不匹配/无 origin（非 git 目录）三态；收编后 refresh、remove 不误删用户手动克隆？——**约定**：收编源的 remove 仅删登记与 install 记录，checkout 目录非本插件克隆时（有 origin 但非我们创建的 reflog/标记）提示确认。简单实现：收编源一律不删目录（与现有 `local` 源一致），文档说明。
- 幂等收编：同 URL 二次 addSource 不产生 `-2` 后缀、不二次克隆。
- archive：zip-slip 用例（`../../` 条目名）、sha256 不匹配、>256MiB、tar.gz 双顶层目录、刷新短路。
- 提速：代理注入出现在 git argv；低速率失败快速返回。
- 回归：`pnpm run check:refactor`（typecheck + lint + contract tests + architecture）。

## 5. 风险与取舍

- **安全**：解压路径穿越、SSRF（archive URL 指向内网）——默认强制 HTTPS + 大小上限 + 可选 sha256；放宽 http 需显式配置。下载走 `fetch` 不经 shell。
- **兼容**：`kind` 可选字段对旧 state.json 零影响；wire 契约 `SourceOverview` 加 `kind` 可选字段，客户端缺省按 git 渲染。
- **codeload 回退的局限**：仅覆盖 GitHub；其他 Git 托管靠代理/镜像配置。回退产出的目录不是 git 仓库，后续 refresh 走「重新下载」而非 pull——实现时在 lock 元数据中标记 `acquisition: 'tarball'`。
