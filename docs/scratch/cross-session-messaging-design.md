# DSH 会话间通信(cross-session messaging)设计文档

> 版本:架构研究稿(2026-10-03) · 对标 Claude Code `Message your other Claude Code sessions` 标注约定:**【事实】** 已复核到源码行;**【推断】** 由事实推导但未直接验证;**【未证实】** 无证据;**【建议】** 提案而非结论。

## 1. 现状盘点摘要

**【事实】会话内 Team 工具面已完备,但发现域被硬限定在一个 Team。** `list_agents` 只列 Lead 与 teammate([tool-agent-team/src/index.ts:232-240]),工具注册在 Agent 精确 scope(:164、:401-422);`send_message` 走 durable mailbox([agent-team/src/mailbox.ts:140-147] 先 journal `team/message/queued`,再按目标串行 dispatch),投递到 live 目标用 `root.steer()`(mailbox.ts:249-252)或 `steerHostSubagentPrompt`([subagent/subagent/src/internal.ts:94-110]),落盘确认先 `sessions.flush` 再校验 messageId(mailbox.ts:273-282、:300-306),冷目标读盘去重(:317-331)。限额常量 `DEFAULT_MAX_PENDING_MESSAGES = 64`、`DEFAULT_MAX_MESSAGE_BYTES = 65_536` 实际在 [agent-team/src/index.ts:43-44]。README 明示"Process-local ownership…never cross-process consensus"([agent-team/README.md:106])、"One process and one shared checkout"(:206)、"Mailbox is not cross-process exactly-once"(:210);服务 inject 全为进程内服务([agent-team/src/index.ts:57])。

**【事实】研究底座的三处行号需要修正**:上条的 64/64KB 常量不在 `tool-agent-team/src/index.ts:45-49`;服务 inject 在 `agent-team/src/index.ts:57` 而非 :62;会话列举 API 是 [session-persistence-jsonl/src/index.ts:475] 的 `list()`,不是 `storage.ts:475`。

**【事实】研究底座低估了宿主已有能力——这是本次复核最重要的发现。** 宿主已经具备"按 sessionId 向任意会话投递"的完整原语:

- `sessionController.resolveAgent(sessionId)` 会**解析或恢复**冷会话为活 Agent([api/session-controller/src/agent.ts:170-204],并作为 Remote 面暴露于 [index.ts:219];服务 id 为 `sessionController`、namespace `session`,见 index.ts:99-136);
- `SessionCommands.prompt()` 支持 `steer`(步边界)/`followup`(下一 turn)双模投递与忙碌拒绝([commands.ts:311-377],:364-365、:372);
- 会话重命名 `rename()`(:193-212)与队列项 steer `updateQueue()`(:432-478)也已存在;
- 定时提醒已经把这条路走通过:`resolveAgent` → `createUserMessage({source:{kind:'schedule'}})` → `agent.followup()` → `sessions.flush()` 确认([schedule/schedule/src/runtime.ts:101、:119-125],失败保活重试 :143-152)。

**【事实】跨进程发现已有只读底座。** `sessionQuery.listSessions()` 合并"磁盘上全部持久化会话"与"本进程 live 会话"并带 `live` 标志([session-query/src/corpus.ts:61-80],持久化来源 :257-272);`sessionController.list` 是"不唤醒 Agent 的全量可见会话列表"(Remote 面)。

**【事实】跨进程无 seam、无宿主消息通道。** 全仓 grep `crossSession|cross-session|inbox socket|peer message` 无宿主级实现;grep `createServer|.listen(` 只命中 ssh TLS helper、`host/webserver`(HTTP,可注册路由与 upgrade,[webserver/src/index.ts:125-176])、测试与语音进程,没有任何会话收件箱 socket。会话日志是**单写者租约**:POSIX `flock(2)` 锁 `session.lock`([session-persistence-jsonl/src/lease.ts:40、:70]),因此第二进程不应直接写他人日志。落盘布局实测 `~/.dsh/sessions/<projectKey>/<sessionId>/{session.v4.jsonl.zstd,session.lock}`,目录 0700([format.ts:254-269、:42])。桌面 profile 组合同树挂载 `session-controller`/`webserver`/`agent-team`/`schedule`/`session-query-sqlite`(`~/.dsh/profiles/desktop/cordis.yml:537、:567、:1364、:1398、:184`)。**【未证实】** 桌面宿主私有实现不可读(`app.asar/dsh` 是 asar 归档而非目录),"GUI 全部会话同进程"只能由 SessionStore 进程内 Map([core/session/src/index.ts:925-926])加 profile 单组合推断。

**【事实】插件侧 seam 仅够做策略层。** 可注册工具/技能/命令/面板,可 `ctx.get('agentTeams'|'subagents'|'sessionQuery')`([teammate-role-runtime.ts:59-60、:130])、可 `ctx.on('agent/created')`(:77)与全局 `ctx.on('internal/service',{global:true})`([agent-teams-seat.ts:67-73]);插件当前实际消费的宿主服务只有 settings、shell、agentTeams、subagents、sessionQuery、systemPrompt、timer。**【推断】** 同一宿主树内的其他服务(如 `sessionController`)对插件也应可达——插件已经用同一机制解析了 `agentTeams`、`sessionQuery`;但插件能否直接调用 `prompt/rename` 这类写方法,取决于服务可见性与权限约定,**未证实**。

**【事实】客户端的 @ 是"文件/资源引用",不是会话 peer 提及。** 命中集中在 [client/ui-deliverables/src/client/index.ts:7、:103-112] 的 `chatFileMentions` 与 [client/ui-conversation/src/client/locales.ts:15] 的引用菜单快捷键,无会话 peer 的 typeahead。

## 2. 与 Claude Code 逐项对齐表

| 能力 | Claude Code | DSH 现状 | 差距 |
| :-- | :-- | :-- | :-- |
| 发现 `ListAgents`(`/list-agents`) | 列 subagent / teammate / 本机其他会话 / 云 / Remote Control,含自身名字 | **部分**:Team 内 `list_agents` 仅本 Team(tool-agent-team:232-240);跨会话只有 `sessionQuery.listSessions` 与 Remote `sessionController.list` | 无统一 peer 视图、无本会话自身可寻址名、无跨进程 liveness |
| 投递 `SendMessage` | 跨进程 socket + 步边界注入 + 回复地址 | **部分**:Team mailbox 语义完整;跨会话靠 `resolveAgent`+`prompt`(steer/followup)与 schedule 的 followup+flush | 无"会话间"语义工具、无 sender 身份与回复地址、无 refused/hold 分级 |
| @提及定向 | `@name` typeahead + `/rename` + 重名消歧 | **无**:宿主有 `rename`/sessionTitle,但那是可被 [session/session-title-llm] 自动改写的展示标题,不是稳定 peer 名;客户端 @ 只覆盖文件引用 | 需 peer 名注册表 + 不可变名/重名后缀 |
| 空闲通知 `notify_when_idle` | 订阅方等被观察会话 idle/exit,12h 过期 | **无**:`agent/status` 只有 idle/running 且进程内([core/agent/src/runtime-types.ts:109、:280]);`wait_agent` 明确"never wakes inactive"(tool-agent-team:242-275) | 需 idle 边沿订阅 + 跨进程回发 |
| 入站管控 `crossSessionInbound` | accept/hold/refuse + 权限模式两档默认 + `dialogExpiry` | **无**:现有投递路径无入站闸门 | 需 hold 队列、过期、持有上限、批准交互 |
| 跨机器/云 | Remote Control 中继 + `isolatePeerMachines` | **无**(DSH 无远程控制面;`~/.dsh/integrations` 的 im/feishu/imessage 是入站渠道,非同会话通信) | 需中继服务与产品决策,建议不做 |
| 节流 | 大小上限、burst 拒绝、环路节流 | **部分**:仅 Team 内 64 条/64KB(agent-team/src/index.ts:43-44),去重靠 messageId([session-message.ts:25-31]) | 跨会话层无大小/速率/队列上限,无环路收敛 |

## 3. 落点建议:宿主 core 新 surface,而非插件实现

**【建议】主落点为宿主**(建议扩展 `packages/api/session-controller`,或新建 `packages/experimental/session-peer`),插件只做策略/技能/展示增强。理由三条:

1. **host-reuse 原则(硬约束)**。插件仓库 [AGENTS.md:50] 要求"宿主已有能力必须先用,自建需写 `## Alternatives considered`"。而 `resolveAgent`、`prompt`、`list`、`rename`、inbox 投影、flock 租约**宿主全部已有**;插件自建等于重复造 5 个宿主能力,评审成本高于直接落宿主。
2. **跨进程无 seam 是决定性约束(事实)**。插件能触达的另一会话只有"本进程内"与"盘上只读"两端(`sessionPersistence`/`sessionQuery` 只读),而写盘路径被 `session.lock` 单写者租约保护(lease.ts:40、:70)。**任何跨进程投递都必须由属主进程 drain**,这要求在宿主内新增端点与目录契约,插件无从实现。
3. **工具面归属**。`send_peer_message`/`list_peers` 属宿主工具面(与 tool-agent-team 同构),不应由插件注册,否则每个插件各装一份、权限边界无法统一。

**【推断】** 唯一适合插件承载的是:peer 命名策略、入站审批的交互皮肤(Skill/命令/面板),以及把"@提及"做成提示词约定。

## 4. 数据通道设计

**分层 A:同进程(先做,零新基建)。** 完全复用 team-message 原语:消息 source 用 `{kind:'session-peer-message', messageId, senderSessionId, senderName}`;发送方 `sessionController.resolveAgent(target)`(冷会话也能恢复)→ 目标 `agent.steer(msg)`(运行中,步边界)或 `agent.followup(msg)`(空闲,起新 turn)→ `ctx.sessions.flush(target)` 确认(与 mailbox.ts:273-282 同构)。**去重**:messageId 由发送方生成,判定复用 `messageAccepted`(session-message.ts:25-31)——历史里有该 messageId,或 `next-turn`/`next-step` 投影里已有(core/agent-loop/src/inbox.ts:21-24、:82-89),即已送达;重放同一 messageId 天然幂等。

**分层 B:跨进程。** 每会话一个收件箱端点 + 全局目录键控:

- **目录键控**:端点描述文件放会话私目录下 `<sessionsRoot>/<projectKey>/<sessionId>/peer-endpoint.json`(实测该目录已 0700、随会话 id 唯一、天然按用户隔离),内含 `sessionId`、`pid`、`socket`、`token`、`hostId`、`heartbeatAt`;会话 attach 时写、dispose 时删。
- **通道**:macOS/Linux 用 UDS、native Windows 用命名管道(与 Claude 一致);Unix 侧靠目录 0700 限制同用户,Windows 侧用每会话 token 首行认证。备选是复用已部署的 `host/webserver` 路由(webserver/src/index.ts:125-176)——省一个端点类型,但把消息面暴露在 HTTP 端口,需独立鉴权,建议不选。
- **liveness**:探测端点 `heartbeatAt`,并可用 `session.lock` 的零超时 flock 试探(lease.ts:70 的 `SessionWriteLease.acquire` 语义)判断是否被别的进程占着。
- **生命周期与清理**:端点心跳过期(如 24h 无更新)回收文件;消息落在 `inbox.jsonl`,由**属主进程单写者 drain** 进 inbox 后标记 delivered 并裁剪;发送方在投递前丢弃目标已死或超 TTL 的消息。
- **限额(建议)**:单会话未投递上限 64 条、消息 64KB(先对齐 Team,后续再放宽到 256KB)、per-sender 速率、held 队列上限与过期(对齐 Claude 的 hold 100 条 / 5 分钟 `dialogExpiry` / 队列 50 条)。

## 5. 分阶段实施拆解

| 阶段 | 内容 | 验收标准 | 工作量 | 前置 |
| :-- | :-- | :-- | :-- | :-- |
| P0 发现(只读) | 宿主新增 `list_peers`,数据源 `sessionQuery.listSessions` + 只读标题投影 | 能列出本进程全部会话:id、标题、cwd、live;**不含任何投递路径** | S | 无 |
| P1 同进程投递 | `send_peer_message({target,message,notifyWhenIdle?})` + 会话级入站 `accept/hold/refuse`;复用 resolveAgent/steer/followup/messageId | 两会话互发;运行中步边界收到、空闲起新 turn;同一 messageId 重放只出现一次;hold 期间不投递且可放行 | M | P0 |
| P2 空闲通知 | 监听 `agent/status` 边沿 → 会话目录内 idle 订阅记录 + 12h TTL | 被观察会话空闲后订阅方收到一行通知;超期自动清理并告知 | M | P1 |
| P3 跨进程端点 | `peer-endpoint.json` + UDS/命名管道 + token + drain + flock 存活探测 | 两个独立 dsh 进程互投;被杀进程的消息不丢不重;跨用户不可投递 | L | P1;需先拍板 IPC 形式 |
| P4 管控与节流完备 | burst 拒绝、held 队列上限/过期、per-sender 速率、大小上限 | 压测环路场景能自动收敛 | M | P1/P3 |
| P5 跨机器/云 | 中继服务 | —— | —— | **建议不做**,缺产品面 |

## 6. 开放问题(需拍板)

1. **落点**:接受"宿主 surface + 插件仅策略"的结论吗?若要插件先行,必须显式接受跨进程能力缺失。
2. **peer 命名语义**:复用可被 LLM 自动改写的 sessionTitle,还是新增不可变显式 peer 名(含重名消歧后缀)?影响 P0/P1 数据模型。
3. **入站默认值**:DSH 的 permission 档位不同于 Claude 的 bypass 类,是否默认 `accept`?是否要在 GUI 做逐条批准对话框(可复用宿主交互层)?
4. **跨进程 IPC 形式**:自建 UDS/命名管道(需目录与安全评审)还是复用 `host/webserver` 127.0.0.1 路由(需鉴权)?
5. **落盘与隐私**:inbox 消息是否进入 session 持久化历史(影响 token 计费、可分享性),保留多久?
6. **与 Agent Teams 的边界**:是否维持"团队内结构化协议消息 vs 会话间纯文本"的严格切分?
7. **容器/移动端**:是否声明"容器内会话与宿主会话互不可达"(对齐 Claude 的容器边界)?

---

**本轮补做的复核**(相对首版):确认 `SessionController` 的服务 id 与命名空间([api/session-controller/src/index.ts:99-136]),把"插件能否触达它"从"未证实"上调为"推断";确认客户端 `@` 仅覆盖文件/资源引用([client/ui-deliverables/src/client/index.ts:7、:103-112]),据此收紧了 @提及行的判定。

**需要你确认的事项**:文档尚未落盘(本会话全程只读,未创建或修改任何文件);落盘路径与是否要把"插件可否直接调用宿主写方法"这条推断单独列为待验证项,由你或宿主团队决定。另外文中行号均基于当前 checkout,若 Lead 落盘前宿主有变动,建议按文中引用逐条抽查一次。
