# 发版材料：v0.15.3

> 基准：`dsh-agent-plugins-market-v0.15.2`（2026-11-16）之后的 2 个提交：1 个 `fix(catalog):`，加 1 个不触发版本变更的 `docs(release):`。release-please 自然算出 **0.15.3**。
>
> **状态：已发布（2026-11-17）。** dev → main 走 PR #201（merge commit `76df0195`），Release PR #202（`25f60a92`）合并于 `d68271de`；tag `dsh-agent-plugins-market-v0.15.3`、GitHub Release（published `2026-11-17T11:16:08Z`）、npm `latest = 0.15.3` 均已确认；`dev` 已快进收敛到 `d68271de`。

---

## 一、修复内容

市场把**插件内部的打包副本**发布成了第二个可安装套件。caveman 仓库在 `./` 声明插件 `caveman`，同时在 `plugins/caveman` 放了一份给 Codex 的打包副本（技能是根套件 22 项中的 6 项）。marketplace 的容器补充遍历 `plugins/` 时只问"有没有套件清单"，不问"这个目录是不是已经在同一轮扫描里被解析成了套件"，于是两个根都成了 id 为 `caveman` 的套件。

安装态、套件数据目录、挂载键与预设资源 id 都以 `${sourceId}/${suiteId}` 为键，后果是：市场出现两张同名卡片、装一张两张都亮、技能页列出 28 行（22 + 6）、预设里一个名字渲染出两种身份。

| 位置 | 改动 |
| --- | --- |
| `packages/market-catalog/src/scanning/scan-resolvers.ts` | 补充发现增加边界判断：候选目录落在已解析套件根之内即跳过，并写扫描注记同时点名两个 checkout 相对路径（`suite .: "plugins/caveman" is the content of this suite, not a separate suite; skipped`） |
| `packages/market-catalog/src/application/source-index-schema.ts` | `SOURCE_INDEX_VERSION` 由 1 升到 2：版本 1 的记录可能仍把嵌套包描述成套件，版本不匹配即丢弃并重新发现 |
| `docs/user/sources.md` / `docs/user/sources.zh.md` | 在补充发现的位置写明边界语义，中英文成对 |
| `.agents/notes/implemented/bug-fix/2026-11-17-a-suite-owns-its-subtree.md` | 决策记录：问题、决定、三个被否方案、后果，以及"同名兄弟套件仍共用安装键"这一开放项 |

规则只收窄补充发现：marketplace 明确声明的条目保持权威，所以"声明了 `plugins/alpha`、未声明的兄弟目录 `plugins/beta` 自带清单"仍然得到两个套件。

浏览器复测（独立 profile 链接本仓库，ego 走真实界面）：caveman 来源只渲染一张卡，标注 `技能 22 · Hooks 4 · 快捷指令 1 · 专家 3`；技能页 `全部 22 / 套件 22`；`state.json` 只有一个键 `caveman/caveman`；持久化索引报告一个套件加一条跳过注记。

## 二、验证证据

- 本地：`check:quick`、prettier、`test:contract`、architecture、reuse、exports、duplication、modules、package、css、single-renderer、doc-links ✅（格式检查用 `prettier --check --ignore-unknown .`：工作树里有另一会话未跟踪的 Python 文件，`format:check` 会因"无可用解析器"报错，与本次改动无关）
- 全量测试 **2660 通过 / 1 跳过（293 个文件）** ✅
- 宿主对齐 **0.2.2-rc.3**（`next` 通道，44 个包）✅ · architecture 323 模块 0 违规 ✅
- PR #201 CI：quality（6m29s）、windows、CodeQL、Analyze、Docs site、Dependency review 全绿，状态 CLEAN 后合并 ✅
- Release PR #202：bot 的三个 run 批准后 quality（5m52s）、windows（8m27s）、CodeQL、Analyze、Docs site 全绿，状态 CLEAN 后合并 ✅
- npm-publish job 9m5s：checkout tag → 全量门禁 → build → OIDC trusted publishing ✅
- 已发布产物复核：`0.15.3` tarball **458 个文件**，解包 **8 124 434 字节**；25 个宿主 peer，自供依赖窗口 `>=0.2.2-rc.3 <0.3.0-0`；`lib/.../scan-resolvers.js` 含边界判断，`source-index-schema.js` 为版本 2

## 三、发布流程

- [x] 推送 dev（`eeb2a083..e2dfc7dc`）✅
- [x] PR #201 CI 全绿、CLEAN 后合并（`76df0195`）✅
- [x] Release PR #202 自然算出 0.15.3；`package.json`、`.release-please-manifest.json`、CHANGELOG 三处一致 ✅
- [x] 合并 #202（`d68271de`）→ tag、GitHub Release、npm OIDC 发布 ✅
- [x] npm 校验：`dist-tags.latest` = `0.15.3`（第 11 次复查命中，传播延迟约 5 分钟）✅
- [x] `dev` 快进到 `d68271de`，与 `main`、`origin/dev` 三者同点 ✅

## 四、遗留

- **身份模型仍待决定**：来自不同根、清洗后 id 相同的两个套件仍然共用一个安装键。以 checkout 相对路径作为套件键能结构性地消除它，但会迁移 `state.json`、套件数据目录、挂载键与预设 id。已记录在本次 Agent Note 的 "What the rule does not decide"。
- 仓库仍有 5 个未处理的 dependabot PR（#191–#195），其中 jsdom 30 → 31 属跨主版本升级，需要单看测试。
- 本地未跟踪目录 `docs/scratch/role-scoped-capabilities/` 属于另一个会话，本次提交没有把它扫进来。
