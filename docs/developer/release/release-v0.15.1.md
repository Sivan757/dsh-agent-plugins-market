# 发版材料：v0.15.1

> 基准：`dsh-agent-plugins-market-v0.15.0`（2026-11-13）之后的 2 个提交：1 个 `fix(deps):`，加 1 个不触发版本变更的 `docs(release):`。release-please 自然算出 **0.15.1**。
>
> **状态：已发布（2026-11-16）。** dev → main 走 PR #196（merge commit `af379a3c`），Release PR #197（`5693d6c8`）合并于 `c4922c8a`；tag `dsh-agent-plugins-market-v0.15.1`、GitHub Release、npm `latest = 0.15.1` 均已确认；`dev` 已收敛到 `c4922c8a`。

---

## 一、为什么有这一版

0.15.0 发布后，dependabot 对**已锁定的 `hono@4.13.13`** 新开出 5 条告警（1 low + 4 medium，修补版本 4.13.16）。这些是针对既有版本的新公告，不是 0.15.0 引入的回归：`hono` 在 v0.14.5 与 v0.15.0 的锁文件里同为 4.13.13，因此 0.15.0 已经带着它们发布出去了，而 0.15.0 不可追加，只能补一个补丁版。

| 项     | 内容                                                                                  |
| ------ | ------------------------------------------------------------------------------------- |
| 包     | `hono` 4.13.13 → **4.13.18**                                                          |
| 范围   | `@modelcontextprotocol/sdk` 与 `@hono/node-server` 都声明 `^4.11.4`，无需改动任何声明 |
| 改动面 | 只有 `pnpm-lock.yaml`                                                                 |
| 结果   | dependabot 未解决告警 **2 → 0**（此前 `@hono/node-server` 两条已在 0.15.0 里关闭）    |

## 二、验证证据

- `check:refactor`（typecheck 四项 + lint + format + 契约 + architecture + reuse）✅
- 全量测试 **2657 个通过 / 293 个文件** ✅（与 0.15.0 同数，依赖版本变化未触动行为）
- 宿主对齐 **0.2.2-rc.3**（`next` 通道，44 个包）✅ · prettier ✅ · architecture 323 模块 0 违规 ✅
- `pnpm install --frozen-lockfile` ✅
- PR #196 的 CI：quality、windows、CodeQL、Analyze、Docs site 全绿后合并 ✅
- 已发布产物：`0.15.1` tarball，宿主 peer 与自供依赖同为 `>=0.2.2-rc.3 <0.3.0-0`

## 三、发布流程

- [x] 推送 dev（`d7be2b5c..16d2de5c`）✅
- [x] PR #196 CI 全绿后合并 ✅
- [x] Release PR #197 自然算出 0.15.1；bot 的三个 run 批准后 quality / windows / CodeQL 全绿 ✅
- [x] 合并 #197 → tag（指向 `c4922c8a`）、GitHub Release、OIDC 发布 npm ✅
- [x] npm 校验：`dist-tags.latest` = `0.15.1`（第 3 次复查命中）✅
- [x] `dev` 快进收敛到 `c4922c8a`，与 `main`、`origin/dev` 三者同点 ✅

## 四、当前状态

- 代码扫描告警 **0**，dependabot 告警 **0**，无未解决 issue，无待处理 PR。
- 依赖树里仍有多条 `deprecated` 提示（`@yuku-codegen/*`、`@yuku-parser/*` 的 binding 包），来自宿主的解析器，不影响本插件的运行路径。
