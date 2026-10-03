# DSH 会话间协作能力盘点(cross-session messaging 事实底座)

> 来源:Lead 委派的架构研究 subagent(2026-10-03)。T2 执行者以此为基础撰写完整设计文档,引用的源码路径需复核后沿用。

## 1. tool-agent-team:会话内 Team 工具面(全部同机同进程)

注册于 Agent 精确 scope,仅 Team 成员可见(packages/experimental/tool-agent-team/src/index.ts:164-241,402-421):

- **list_agents**(index.ts:232-240):只列本 Team 的 Lead+teammate,状态 running/inactive/provisioning/failed。发现域 = 一个 Team,不是机器上的会话。
- **send_message**(index.ts:215-230):投递语义在 agent-team/src/mailbox.ts——先 journal 追加 `team/message/queued` 并 flush(mailbox.ts:140-147),再按 target 串行 dispatch;live 目标经 `root.steer()`(mailbox.ts:249-252)或 `steerHostSubagentPrompt`(mailbox.ts:262,定义于 packages/subagent/subagent/src/internal.ts:94-110)进入目标 Session inbox;目标 Session 持久持有 messageId 才记 delivered(mailbox.ts:301-306;session-message.ts:25-31)。inactive 目标冷恢复时先读磁盘日志去重(mailbox.ts:317-331)。上限:maxPending=64/成员、65536 字节(agent-team/src/index.ts:45-49)。
- **wait_agent**(index.ts:242-275):只观察调用后的 roster/mailbox/task 边沿;无 active peer 立即 noProgress;不唤醒 inactive——即没有"等它空闲"的通知订阅。
- **spawn_teammate / interrupt_agent / team_task_\***(index.ts:175-391):Lead-only 创建/打断;任务板带 CAS revision 与 advisory writeScopes。

**同机限定是硬边界**:README 明言"Process-local ownership…never cross-process consensus"(packages/experimental/agent-team/README.md:106)、"One process and one shared checkout"(同文件 :206)、"Mailbox is not cross-process exactly-once"(:210)。Team 服务 inject 全部为进程内服务(agent-team/src/index.ts:62)。

## 2. 会话存储与生命周期

- 布局:`~/.dsh/sessions/<projectKey(cwd)>/<sessionId>/session.v4.jsonl.zstd` + `session.lock`(实测;路径生成 packages/session/session-persistence-jsonl/src/format.ts:254-269,无 cwd 落 `_no-cwd`)。session id 为 UUID,磁盘可枚举(storage.ts:475 起 list() 扫描全部 generation)。
- **live 寻址仅进程内**:SessionStore 是进程内 Map(packages/core/session/src/index.ts:925),`list()`(:1235)只含本进程会话。跨进程只能读盘,不能投递。
- 事件/订阅:cordis 总线 `session/created|event|disposed`、`agent/created|status`,如 agent-team/src/index.ts:107;status 只有 idle/running(packages/core/agent/src/runtime-types.ts:103-109,:280)。全部进程内,无 IPC。
- 投递基建复用价值:agent inbox 有 next-turn/next-step 双通道(agent-loop/src/agent.ts:159,167),消息源 `team-message` 带 messageId/senderName 做去重——这是跨会话消息可直接借用的 durable 投递原语。

## 3. 宿主跨 session 消息/空闲通知/@提及痕迹

grep crossSession/inbox-socket/peer-message/idle/notify 全仓:**无任何宿主级跨 session 消息实现**(命中仅为会话内 agent-team、沙箱 ACL、session-reference 等无关项)。无 per-session UDS/命名管道 inbox,无"订阅其他会话 idle"(agent/status 只在本进程),无 session @提及 UI(未证实存在)。schedule 包(packages/schedule/schedule/src/index.ts:100,188)可向指定 Session 定时注入提醒,是唯一"时间驱动跨 turn 注入",仍同进程。

## 4. 任务看板:能力与局限

- 会话内 Team 任务板(agent-team/src/task-board.ts):journal 持久化在 Lead session log,进程内,上文已述。
- 宿主 GUI 看板:`~/.dsh/task-board/ledger-v2.json`(schemaVersion 4,实测含 tasks/scheduler/recentRequests);本会话工具面 task_board_create/run/schedule/manage 支持 cron、子任务级联并发开真实 session、执行会话落账。**开源 checkout 中 grep 'task_board' 零命中**——实现位于桌面宿主私有侧,源码位置未证实(不在 ~/workspace/deepseek-harness)。
- 定位:它是"异步、拉模式"的会话间协作(卡片→prompt→新 session),无实时消息、无空闲通知、无跨机器。

## 5. Claude Code 文档中 DSH 尚无对应物(docs/scratch/claude-cross-session-messaging.md)

1. 跨会话发现与寻址:ListAgents 列本机其他 live session/cloud/Remote Control(:111-133);@-mention + typeahead + /rename(:42-53)。
2. 投递通道:per-session UDS/命名管道 inbox,socket 路径与 token 导出给 hook/脚本(:232-263)。
3. **notify_when_idle 空闲通知**(SendMessage 参数,12h 过期,:80-107)——DSH wait_agent 只覆盖会话内 Team 且不唤醒。
4. 入站管控 crossSessionInbound accept/hold/refuse + 权限模式两档默认 + dialogExpiry(:190-228)。
5. 跨机器/云投递与 isolatePeerMachines 审批(:134-155,:269-279)。
6. 环路节流/burst 拒绝/百万字符上限(:327-334)——DSH 仅 Team 内有 64 条/64KB 上限。

## 6. 插件侧可挂载的 seam(src/runtime/ 模式)

- 能注册:工具(`ctx.tools.register`,src/runtime/agents/teammate-role-tool.ts:88)、技能/命令/面板/路由(src/index.ts:25-55);能读宿主服务:`ctx.get('agentTeams'|'subagents'|'sessionQuery'|'sessions'|'sessionPersistence')`(src/runtime/agents/teammate-role-runtime.ts:59-60,:130);能订阅全局事件 `ctx.on('agent/created'|'internal/service', {global:true})`(teammate-role-runtime.ts:77;agent-teams-seat.ts:67-73)。
- **能否触达另一个会话**:同进程(GUI 宿主下的会话)——可以,经 ctx.sessions/steer 或 sessionQuery;**另一进程的 CLI/独立会话——无任何 seam**,只能读盘上的持久化 session(sessionPersistence/sessionQuery 均只读),写 ~/.dsh 共享文件或自建 socket 属于绕过宿主(与 maximize-host-reuse 规则冲突)。Web/Desktop 宿主是否单进程承载全部 GUI 会话:由 SessionStore 进程内 Map 推断为是,未直接验证(未证实)。

**结论**:DSH 的消息基建(durable inbox、message source 去重、step-boundary steer)已在会话内 Team 验证成熟,跨会话缺的是三件事:本机会话发现(进程外 live 索引)、投递通道(UDS/管道或宿主 IPC)、空闲通知订阅;任务看板证明宿主已有"Host-authoritative ledger + 调度"的跨会话编排先例可复用。
