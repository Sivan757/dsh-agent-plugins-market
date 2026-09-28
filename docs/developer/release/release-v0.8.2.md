# 发版材料：v0.8.2

> 基准：`dsh-agent-plugins-market-v0.8.1`（2026-09-24）之后 dev 上的 27 个提交，含 5 个 `feat:`、11 个 `fix:`，release-please 自然算出 **0.9.0**；本次按维护者决定走指定版本入口强制 **0.8.2**（`gh workflow run npm-publish -f version=0.8.2`，Release PR #84 就地重算）。
>
> **状态：已发布（2026-09-28）。** `dev` → `main` 走 PR #83（merge commit `a4665a9`），Release PR #84（`393981e`）合并于 `2601feb`；tag `dsh-agent-plugins-market-v0.8.2`、GitHub Release、npm `latest = 0.8.2` 均已确认。`main` 与 `dev` 已收敛。

---

## 一、门禁

- [x] `pnpm run check:refactor` + `check:reuse` ✅（169 模块 0 违规；reuse 台账 51 行、341 个导出名）
- [x] `pnpm run test` ✅ **886 个测试 / 100 个文件全绿**（覆盖 81.61% 行）
- [x] `pnpm run build` ✅ · `pnpm --dir docs-site exec astro build` ✅ 4 页
- [x] `pnpm run check:host-alignment` ✅ 基线 **0.1.7-rc.2**（`next`），21 个包全部符合
- [x] Release PR #84 的 quality / windows / CodeQL / Analyze / Dependency review 全绿后合并 ✅
- [x] npm 校验：`dist-tags.latest` = `0.8.2`；tarball 237 个文件，`lib/runtime/host/shell-path.js` 随包发布，宿主 peer 钉 `^0.1.7-rc.2` ✅
- [x] 收敛：`main` 与 `dev` 均在 `2601feb` ✅

## 二、提交整理

工作树中 27 个文件（`refactor(mcp)`：新增服务对话框改为单一短表单，移除模板与粘贴导入通路及其 API）整理为一个提交，并把 3 个落在周一 14:00–18:00 禁用窗口的提交顺延到 18:00 边界，`git diff` 确认内容零变化。

## 三、Windows / Linux CI 修复（本轮的核心发现）

新增的 `tests/shell-path.test.ts` 在 Linux 与 Windows 上大面积失败，两处原因，都在测试侧：

1. **平台未限定。** 产品的登录 shell 探测刻意只对 `darwin` 生效（决策见 [bare-command-resolution](../../../.agents/notes/implemented/bug-fix/2026-09-26-bare-command-resolution.md)），而期望探测真的运行的 8 个用例没有限定平台，在其他 runner 上探测直接返回 `undefined`。改为逐用例 `withPlatform('darwin')` 固定平台，与该文件里既有的「非 darwin 时不做任何事」用例保持一致。
2. **分隔符写成 POSIX 的 `:`。** 产品用 `node:path` 的 `delimiter` 拆分与拼接 `PATH`，Windows 上是 `;`，所以按 `:` 拼出的多段 `PATH` 在 Windows 上只是一个条目，解析、追加、扩展后缀三处断言都落空。改为全部经 `delimiter` 构造，与仓库其他跨平台用例同一规则。

两处修完，quality 与两个 windows job 全部转绿。

## 四、发布流程

- [x] 提交时间顺延（3 个提交）→ `git push --force-with-lease origin dev` ✅
- [x] PR #83（dev → main）CI 全绿后合并 ✅
- [x] release-please 自然运行开出 0.9.0 候选；`gh workflow run npm-publish -f version=0.8.2` 强制后 Release PR #84 重算为 **0.8.2**，三处核对一致 ✅
- [x] bot PR 的三个 run 手动 approve 后全绿 ✅
- [x] 合并 #84 → tag（指向 `2601feb`）、GitHub Release、OIDC 发布 npm ✅
- [x] npm 与 tarball 校验 ✅ · 分支收敛 ✅

## 五、0.8.2 内容

- **新增 MCP 服务改为单一短表单**：名称、传输方式与该方法必需的字段；表单覆盖不到的键写在编辑器的 JSON 视图。模板快捷方式、粘贴框与 `mcp-servers/import` 通路及其 API 一并移除，`mcp-servers/add` 成为唯一写入路径。
- **来源胶囊**：只显示来源名称与套件数量，控件悬停出现，标签不再被挤压。
- **插件来源条目**：内容只读、状态可切换，角色提供仅路由编辑器。
- **服务详情单一状态带**：状态、标签与该方法提供的恢复动作合并呈现。
- **裸命令经登录 shell 的 `PATH` 解析**，套件声明裸可执行文件无需绝对路径。
- **插件卡片改用宿主的设置表单模型**，手工分段控件改用宿主分段控件；新增 `check:reuse` 台账门禁。
- 宿主依赖线升至 **0.1.7-rc.2**。
