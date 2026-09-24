# 发版材料：v0.8.0

> 基准：`dsh-agent-plugins-market-v0.7.2`（2026-09-22）之后 main 上的提交，含 1 个 `feat:`、3 个 `fix:`，release-please 按 semver 自动算出 **0.8.0**。
>
> **状态：已发布（2026-09-24）。** `dev` → `main` 无需独立 PR（dev 已收敛）；Release PR #74（`c76d271`）合并于 `65befcd`；tag `dsh-agent-plugins-market-v0.8.0`、GitHub Release、npm `latest = 0.8.0` 均已确认。`main` 与 `dev` 已收敛。

---

## 一、门禁与发现

- [x] `pnpm run check:refactor` ✅（158 模块 0 违规）
- [x] `pnpm run test` ✅ **820 个测试全绿**
- [x] `pnpm run build` ✅ · `pnpm --dir docs-site exec astro build` ✅ 4 页
- [x] `pnpm run check:host-alignment` ✅ 基线 **0.1.7-rc.1**（`next` 通道），18 个包全部符合
- [x] Release PR #74 的 quality / windows / CodeQL / Analyze / Dependency review 全绿后合并 ✅
- [x] npm 校验：`dist-tags.latest` = `0.8.0`；tarball 227 个文件，`plugin-message-source.js`（0.1.7 适配）随包发布，宿主 peer 钉在 `^0.1.7-rc.1` ✅
- [x] 收敛：`main` 与 `dev` 均在 `65befcd` ✅

## 二、本轮发现并修复的问题

**对齐门禁在发版第一步就挂了**：`check:host-alignment` 报 `fetch failed`，与 registry 连通性无关——逐请求探测 20 次全过，但脚本一次性 fan out 约 18 个 dist-tag 请求时，本网络在 TLS 握手阶段重置其中约三分之一。修复：改为串行遍历请求（[脚本内注释](../../scripts/check-host-alignment.mjs)），整个 run 只需几秒，连跑 7 次全部通过。`fix(alignment)` 已提交并随本次发布。

## 三、0.8.0 内容

- **dsh 0.1.7-rc.1 宿主对齐**（`chore(host)`，见 [next-channel-baseline 决策](../../.agents/notes/implemented/process/2026-09-23-next-channel-baseline.md)）：消息来源改为 merge-extensible（插件声明 `plugin-market` source）、`agent/session-start` 并入 `agent/created`、session header version 4、客户端设置服务 `configForms` + `plugins.item` 卡片 slot、图标 `*Medium` 后缀、三个新增浏览器依赖进 devDependencies
- **feat(agents)**：读取 `.agents` 布局携带的全部 surface
- **fix(catalog)**：项目 LSP 诊断按 POSIX 分隔符报告；skill 目录读取为一个技能
- **docs**：项目重定位为一站式 skills / subagent / MCP / LSP 管理器，README 增加微信群二维码
- **fix(alignment)**：对齐门禁 registry 查询改为串行

## 四、发布流程记录

- [x] `dev` 与 `main` 先对齐（main 上的 0.1.7 对齐提交 fast-forward 回 dev）✅
- [x] release-please 在 0.1.7 对齐提交合入 main 后自动开出 Release PR #74（0.8.0）✅
- [x] dev 后续提交（`fix(alignment)`）通过向 release 分支合并带入，#74 随之更新 ✅
- [x] CI 全绿后合并 #74 → tag / GitHub Release / OIDC 发布 npm ✅
