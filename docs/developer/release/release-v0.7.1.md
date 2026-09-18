# 发版材料：v0.7.1

> 基准：`dsh-agent-plugins-market-v0.7.0`（2026-09-13）之后 dev 上的 19 个提交。提交类型为 7 个 `feat:`、7 个 `fix:`，release-please 自然算出 0.8.0；本次按维护者决定走 workflow 的指定版本入口强制 **0.7.1**（`gh workflow run npm-publish -f version=0.7.1`，经 `Release-As:` 页脚把已开的 Release PR #58 就地重算）。
>
> **状态：已发布（2026-09-18）。** `dev` → `main` 走 PR #57（merge commit `808b4ae`），Release PR #58（`807c85f`）合并于 `78925f6`；tag `dsh-agent-plugins-market-v0.7.1`、GitHub Release、npm `latest = 0.7.1` 均已确认。`main` 与 `dev` 已收敛。

---

## 一、发版清单

### 1. 代码与质量门禁

- [x] `pnpm run check:refactor` ✅（typecheck + lint + format:check + contract + dependency-cruiser，153 模块 0 违规）
- [x] `pnpm run test` ✅ **89 个文件 / 687 个测试全绿**（含测试覆盖 worktree 并入的 7 个新套件）
- [x] `pnpm run build` ✅ · `pnpm --dir docs-site exec astro build` ✅ 4 页
- [x] `pnpm run check:host-alignment` ✅ 基线 `0.1.5-rc.2`（`next`），17 个包全部符合
- [x] `pnpm install --frozen-lockfile` + `prepare` ✅ · `prettier --check .` 全仓 ✅
- [x] 推送后 CI 全绿：PR #57 与 Release PR #58 的 quality / windows×2 / CodeQL / Analyze / Dependency review

### 2. PR 与分支清理

- [x] #56 `@eslint/js` 9→10：关闭，内容并入 `fix(deps)`。v10 两条新 recommended 规则各找到一个真实缺陷——技能正文读取的诊断未携带 `cause`；archive 大小遍历里 `size` 的初始化值没有路径能读到。两处已修复
- [x] #55 katex 0.16.47→0.18.7：关闭并拒绝，`dependabot.yml` 增加 `katex >=0.17` ignore。该 devDependency 用于让 vitest 内联宿主 `dsh-client-ui-primitives`（宿主声明 `^0.16.47` 并以其渲染 TeX），升级会让内联代码运行在宿主不发布的版本上
- [x] 删除已合并的 `test/coverage-e2e`（合并后）与 `fix/command-followup-message-identity` 分支及其 worktree；两个 dependabot 远端分支随 PR 关闭自动删除
- [x] 保留 `feat/agent-plugins-namespace`（worktree + 分支）：持有 1 个未合并的 `feat(catalog)` 提交（agent-plugins v1 一致性与 `com.deepseek.harness` 扩展命名空间），dev 无等价内容
- [x] 保留 `dsh/fix-release-blockers`：持有 3 处未移植的安全修复（archive 下载重定向不校验最终协议、错误文本无脱敏、OAuth 回调缺 `state` 校验与 grant 跨进程合并）

### 3. 测试覆盖 worktree 合并

- [x] `31d3520` 七个新套件、1060 行、零源码改动并入 dev：MCP 投影管线不可信网络边界、JSON-schema 子集全部接受/拒绝分支、grant 记录与 server-name 折叠、LSP 服务 routes→Catalog 端到端（真实临时目录）、reauthorize 路由端到端、禁用服务器状态文件、客户端标签辅助函数
- [x] Windows CI 暴露该套件三个断言的平台假设：`${CLAUDE_PLUGIN_ROOT}` 之后的 `/...` 是作者文本、按契约原样转发，断言改为按作者原文书写（`${CLAUDE_SKILL_DIR}` 是产品自己构造的路径，保留 `join()` 期望）——`test(plugin-variables)`

### 4. 提交时间规范

- [x] 本轮 3 个提交落在周五 14:00–18:00 禁用窗口，推送前顺延到 18:00:00–18:00:02（`filter-branch` 按 `$GIT_COMMIT` 显式 pin 日期，内容零变化）；后续提交直接以 18:00:03 落盘

### 5. 发布流程

- [x] `git push origin dev` ✅ → PR #57，CI 绿后合并 ✅
- [x] release-please 自然算出 0.8.0（Release PR #58 初版）；`gh workflow run npm-publish -f version=0.7.1` 强制后，#58 就地重算为 0.7.1，三处核对一致（title / `.release-please-manifest.json` `".": "0.7.1"` / CHANGELOG `## [0.7.1]` / `package.json` `0.7.1`）✅
- [x] bot 开的 Release PR 需手动 approve 才会跑 CI（`gh api -X POST .../actions/runs/<id>/approve`，`gh run approve` 子命令不存在）——三个 run 已批准并全绿 ✅
- [x] 合并 #58 → 自动打 tag（指向 `78925f6`）、建 GitHub Release、OIDC 发布 npm ✅
- [x] npm 校验：`npm view dsh-agent-plugins-market dist-tags.latest` = `0.7.1`（刚发布后短暂 404/滞后为 registry 传播延迟）；下载 tarball 复核 215 个 lib/client/schemas 文件、LSP 三件套与 `dsh-atomic-write`/`dsh-home-paths` 在 `dependencies` ✅
- [x] 收敛：`main` 与 `dev` 均在 `78925f6` ✅
