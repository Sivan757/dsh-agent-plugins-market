# 发版材料：v0.15.0

> 基准：`dsh-agent-plugins-market-v0.14.5`（2026-11-13）之后的 11 个提交：5 个 `feat:`（其中 1 个带 `!`）、2 个 `fix:`、2 个 `chore:`、1 个 `docs:`、1 个 `fix(deps):`。按 ADR-0002，0.x 线上的破坏性变更升 **minor**，release-please 自然算出 **0.15.0**，未使用指定版本模式。
>
> **状态：已发布（2026-11-13）。** dev → main 走 PR #189（merge commit `02a61311`），Release PR #190（`89827835`）合并于 `8279d7ee`；tag `dsh-agent-plugins-market-v0.15.0`、GitHub Release、npm `latest = 0.15.0` 均已确认；`dev` 已收敛到 `8279d7ee`。

---

## 一、这一版的破坏性变更

`9baacf19 feat(agents)!: roles ride the subagent seam instead of the Team member API`

宿主删除了 Agent Teams 的成员 API：`agentTeams` 仍在，但改为发布任务图，创建、消息、中断、成员关系与等待都归普通的 subagent 控件。角色层原本建在被删除的 API 上——只要有该服务，座位就撤回 `subagent_role`，Team 面整个挂不上，于是**每个部署都丢了角色委派与它的目录**。

处理：座位、协调小节、`spawn_teammate_role` 及其运行时连同测试一起删除（44 个文件，−2500 行）。`subagent_role` 现在只要 tools、LLM、subagents、agents 与 system-prompt 服务可用就挂载，目录随同一个挂载发布；子代理不需要 Team 专用路径，宿主从 subagent 树推导 Team 成员关系，因此协作开启时角色子代理就是 Team 成员。

**对使用方的影响**：任何用过 `spawn_teammate_role` 或 Team 角色座位的部署会失去这两个名字，替代是 `subagent_role` 加宿主自带的 Team 控件。

## 二、其余内容

| 提交       | 内容                                                                         |
| ---------- | ---------------------------------------------------------------------------- |
| `0dfec73b` | MCP server 停止提供工具时告知会话                                            |
| `d5402593` | 失败的 tool 调用归因到它没到达的那个 server                                  |
| `ef677e07` | 发现按 source 建索引，只读取已安装的 source                                  |
| `86567a79` | 体验报告携带诊断包                                                           |
| `c6dd3c73` | 连接保持住之后才确认恢复（此前首次握手成功即报恢复，抖动的 server 会被误报） |
| `1d3a3b19` | 命令只转发一次调用文本                                                       |
| `5e155d0c` | `@hono/node-server` 2.1.5 → 2.1.7，关闭发布依赖树里的两条 dependabot 告警    |

## 三、发布机制的一处修正

`26f7a9d7 chore(release): implement the pre-1.0 breaking-change rule`：ADR-0002 一直写着 0.x 的破坏性变更升 minor，但 release-please 缺少 `bump-minor-pre-major` 时会提出 **1.0.0**。本次补上该配置（`bump-minor-pre-major: true`、`bump-patch-for-minor-pre-major: false`），本版是它第一次生效——Release PR #190 确实算出 0.15.0 而不是 1.0.0，这条可以通过本版验证。

## 四、验证证据

- `check:refactor`（typecheck 四项 + lint + format + 契约 + architecture + reuse）✅
- 全量测试 **2657 个通过 / 293 个文件** ✅
- 宿主对齐 **0.2.2-rc.3**（`next` 通道，44 个包）✅ · prettier ✅ · architecture 323 模块 0 违规 ✅ · build ✅
- PR #189 的 CI：quality、windows、CodeQL、Analyze、Docs site 全绿、状态 CLEAN 后合并 ✅
- 已发布产物复核：`0.15.0` tarball **418 个文件**，解包 **8 119 867 字节**；24 个宿主 peer 与自供依赖同为 `>=0.2.2-rc.3 <0.3.0-0`

## 五、发布流程

- [x] 推送 dev（`b23faa92..5e155d0c`，11 个提交）✅
- [x] PR #189 CI 全绿、CLEAN 后合并 ✅
- [x] Release PR #190 自然算出 0.15.0；bot run 停在 `action_required`，批准后 quality / windows / CodeQL 全绿 ✅
- [x] 合并 #190 → tag（指向 `8279d7ee`）、GitHub Release、OIDC 发布 npm ✅
- [x] npm 校验：`dist-tags.latest` = `0.15.0`（第 1 次复查即命中）✅
- [x] `dev` 快进收敛到 `8279d7ee`，与 `main`、`origin/dev` 三者同点 ✅

## 六、遗留：hono 的 5 条新告警

发布后 dependabot 对**已锁定的 `hono@4.13.13`** 新开出 5 条告警（1 low + 4 medium，修补版本 4.13.16）。这些是针对既有版本的**新公告**，不是本次改动引入的：`hono` 在 v0.14.5 与 v0.15.0 的锁文件里都是 4.13.13。

可行修法只有一条命令：`@modelcontextprotocol/sdk` 对 `hono` 的范围是 `^4.11.4`，`@hono/node-server` 是 `^1.19.9 || ^2.0.5`，直接 `pnpm update -r hono` 即可升到 4.13.16+ 而不动任何声明。

因为 0.15.0 已经发布、不可追加，这 5 条只能进下一个补丁版（0.15.1）。是否立即发 0.15.1 需要单独决定。
