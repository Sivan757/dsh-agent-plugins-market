# 发版材料：v0.7.2

> 基准：`dsh-agent-plugins-market-v0.7.1`（2026-09-18）之后 dev 上的提交，含 5 个 `feat:`、4 个 `fix:`、1 个 `feat!`。`feat!` 带 BREAKING CHANGE，release-please 自然算出 **0.8.0**；本次按维护者决定走指定版本入口强制 **0.7.2**（`gh workflow run npm-publish -f version=0.7.2`，Release PR #71 就地重算）。
>
> **状态：已发布（2026-09-22）。** `dev` → `main` 走 PR #70（merge commit `996dede`），Release PR #71（`3526390`）合并于 `c7d347c`；tag `dsh-agent-plugins-market-v0.7.2`、GitHub Release、npm `latest = 0.7.2` 均已确认。`main` 与 `dev` 已收敛。

---

## 一、PR 与分支清理

| 项 | 处置 |
| --- | --- |
| #63 `@codemirror/commands` 6.11.1 | 重定向到 dev 后合并，GitHub 标记 MERGED ✅ |
| #64 dependency-cruiser 18.3.1 | 同上 ✅（解析到 18.4.0，一个 patch 超出提案） |
| #65 zod 4.6.5 | 同上 ✅，`package.json` 声明 floor 升到 `^4.6.5` |
| #66 `@codemirror/view` 6.43.12 | 同上 ✅ |
| #67 `@codemirror/state` 6.7.5 | 同上 ✅ |
| 五个 dependabot 远端分支 | GitHub 随 MERGED 状态自动删除 ✅ |
| `feat/agent-plugins-namespace` worktree + 分支 | 已删除——`594cc22`（agent-plugins v1 一致性与 `com.deepseek.harness` 扩展命名空间）已随 `47fab78` 并入 dev，无遗留 |
| `dsh/fix-release-blockers` 分支 | 已删除——其 3 处安全修复已由 `09445ad` 在 dev 重做（archive 重定向协议校验、错误文本脱敏、OAuth `state` 校验与 grant 合并），原基座落后过多无保留价值 |

合并后 lockfile 曾回退到基座版本：`pnpm install` 不会延续 PR 携带的新版本，需要显式点名这些包重新解析。`build(deps): settle the merged lockfile on the PR versions` 跑两遍 `pnpm update` 确认收敛稳定，最终版本：zod 4.6.5、dependency-cruiser 18.4.0、codemirror commands 6.11.1 / view 6.43.12 / state 6.7.5。

## 二、提交时间规范（本轮的重点工作）

`dsh-agent-plugins-market-v0.7.1..dev` 范围内有 **6 个提交**落在工作日 14:00–18:00 禁用窗口：

- `594cc22`（周四 15:11，agent-plugins v1 一致性）
- 五个 dependabot 头提交（周五 17:46–17:48）

全部顺延到各自当日的 18:00 边界（`filter-branch` 按 hash 显式 pin 日期），改写后 `git diff` 对比确认**内容零变化**，全时间线 `sort -c` 校验单调。由于这些 SHA 已随推送进入远端，改写后用 `git push --force-with-lease` 更新 `dev`（历史重写不可避免，PR #63–#67 已是 MERGED 状态不受影响，其头提交 SHA 变为由内容等价的新提交承载）。

改写后的判定脚本以 `git log --format='%ad|%a'` + awk 过滤星期与 9–12/14–18 小时区间，规则本身不再依赖人工核对。

## 三、发布流程

- [x] `git push --force-with-lease origin dev`（提交时间改写）✅
- [x] PR #70（dev → main）CI 全绿后合并 ✅
- [x] release-please 自然运行开出 0.8.0 候选；`gh workflow run npm-publish -f version=0.7.2` 强制后 Release PR #71 重算为 **0.7.2**，三处核对一致（title / `.release-please-manifest.json` / CHANGELOG / `package.json`）✅
- [x] bot PR 的三个 run 手动 approve（`gh api -X POST .../actions/runs/<id>/approve`）后全绿 ✅
- [x] 合并 #71 → tag（指向 `c7d347c`）、GitHub Release、OIDC 发布 npm ✅
- [x] npm 校验：`dist-tags.latest` = `0.7.2`；tarball 221 个 lib/client/schemas 文件，`lib/catalog/plugin-variables.js` 与 `subagent_role` 工具名随包发布 ✅
- [x] 收敛：`main` 与 `dev` 均在 `c7d347c` ✅

## 四、0.7.2 内容速览

- **MCP 服务面板自助化**：工具行展开输入 schema，保存失败指明字段，粘贴按条目判定，编辑器改为承载全部键的文档（`feat(mcp)` ×2）
- **代理角色委托对齐宿主 subagent 工具**：`subagent_run` 更名 `subagent_role`，参数面与宿主一致，返回值改为可辨识联合（BREAKING CHANGE，本次按补丁强制发布）
- **agent-plugins v1 一致性与 `com.deepseek.harness` 扩展命名空间**
- **MCP 服务器级超时与工具开关**；三方 collection 的来源预设
- **三个评审遗留的安全修复**：archive 下载重定向协议校验、错误文本脱敏、OAuth `state` 校验与 grant 跨进程合并
- **依赖**：zod `^4.6.5`、dependency-cruiser 18.4.0、codemirror 三件套补丁版
