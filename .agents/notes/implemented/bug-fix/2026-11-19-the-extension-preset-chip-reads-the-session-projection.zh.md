# Agent Note: The extension preset chip reads the session projection

Status: implemented

## Problem

composer 里的预设 chip 渲染的是状态词，而不是选择本身。它向一条路由索取标签，于是请求在跑时显示 `加载中…`，会话没有活 Agent 时显示 `扩展尚未就绪，先给这个会话发一条消息` / "Extensions are not ready yet. Send a message in this session first."。选择发布不了的会话还会显示第三个词：`会话扩展尚未就绪`。

宿主的 composer chip 没有一个这样。权限 seat 读会话的 `permissions` 投影；模型 seat 读持久的模型选择投影，并通过 `session.selectModel` 提交，而宿主自己写明它会恢复会话。它们的值走会话投影，由历史快照种下、由投影帧推进，所以这些 chip 在任何请求之前就有答案，从不显示等待。

我们这一处还要求人去修复控件自己就能到达的状态：`sessionController.resolveAgent` 正是宿主为每一次 Agent 绑定的读与写用的 seam，而路由只做了一次 `ctx.agents.get`。

## Decision

已提交的选择是一个客户端可见的会话投影。`extensionSelectionProjection`（`packages/market-runtime/src/runtime/host/extension-selection-projection.ts`）折叠最后一条 binding 为 `committed` 的 `market-extension-selection` 消息——待处理请求不会移动 chip——并以 `marketExtensionSelection` 键发布 `{ presetId, presetName, modified }`，`summary: true`。两个单元都经 `SessionProjectionReader`（`projection-reader.ts`）注册，也就是原本拥有进展单元的那套共享生命周期。

composer seat 的会话标准 kit 会交付 `useProjection`，入口用 `useProjection(EXTENSION_SELECTION_PROJECTION_KEY)` 渲染 chip：预设名，或在折叠结果没有命名预设时显示全局词。没有加载词、没有未就绪词、没有指令。第一次答案之前 chip 只画图标，因此不断言自己不知道的事。待处理请求仍然胜过折叠结果，因为面板已应答的意图更新。

窗口路由保留原有职责：菜单行、预设库、清单与全部写入。它在作答前通过 `ctx.get('sessionController').resolveAgent(sessionId)` 激活持久化会话，与并发读共享一次尝试，失败记住十秒，并且对已经在进行的初始化只等待、不报告。没有该 seam 的宿主仍然回答 `extension-session-not-found`。

`epSessionInactive` 与 `epNotReady` 已从中英两份语言表删除。读失败渲染 `epLoadFailed` 及其 code，chip 与菜单都是如此，因为失败不是等待。

## Alternatives considered

- **保留只走路由的标签，用更快的轮询缩短等待。** 落选是因为它在治标：chip 仍依赖一次请求，仍是唯一会等待的 composer chip。
- **完全由路由渲染预设库与选择，不做投影。** 落选是因为标签必须先于请求存在；冷会话的第一次读是一次恢复而不是查表，chip 会在它结束前没有任何内容。
- **用一个中性的加载词代替状态词。** 落选是因为宿主 chip 显示的是选择而不是自己的进度：有了投影，就没有进度可显示。

## Consequences

chip 在第一次渲染就正确：没有 Agent 的会话、静置时、轮次进行中都一样；读失败时它保留最后一次已提交的名字。代价是选择有了第二个发布者：投影只用于显示、从不授权，但它复制了状态机已经在做的折叠，因此两者对"committed"的理解必须一致。

激活失败现在以 `session/writer-held` 或其它 seam code 呈现，而不是等待状态，并由菜单点名。没有组合会话运行时的宿主仍然得到 `extension-session-not-found`，chip 按加载失败渲染它，而不是当成指令。

## Testing

`extension-selection-projection.test.ts` 钉住折叠（待处理被忽略、已提交被接受、重复信封保持同一引用）以及真实 `select` 之后发布的值。`extension-window-activation.test.ts` 钉住激活、共享一次尝试、失败 code 与重试窗口。composer 集成测试钉住 chip 在任何读回答之前就渲染投影出的名字，且读失败仍然提供重试。
