# Agent Note：预设管理器的卡片带着面板的事实

Status: implemented

## Problem

同一个连接器在两个界面上读起来不同。设置页显示「已连接」、endpoint、「工具 4」，失败时显示「连接超时 · 10.0s」；预设管理器显示原始挂载键（`cloudflare__cloudflare`）、transport，别的什么都没有——没有 endpoint、没有工具数、没有状态、没有原因。读者在决定「这个要不要进预设」时，得去另一个界面查这一行到底是什么。

## Decision

- **清单携带活的实情，而不只是可开关的结论。** `ExtensionResource` 新增 `runtime`（状态、代码、原因、下层消息、挂载耗时）与 `transport`，面板会数工具的地方再加 `toolCount`。管理器画与面板相同的槽位：显示名、正文、meta、计数，以及用同一个分类器（`failureGuidanceKey` + `failureCause` + 挂载耗时）生成的告警行。
- **管理器自己的含义留在自己的槽位。** 边条与状态词仍然说这个界面的问题——这一行在不在预设里——因为模态框回答的就是这个。活状态出现在不会被混淆的位置：作为告警行，用面板的措辞。
- **名字用显示名。** 套件服务挂载为 `<suite>__<key>`；清单行现在携带面板显示的那个键，两个界面用同一个名字称呼同一行。

## Alternatives considered

- **把管理器的状态词换成活状态。** 否决：模态框的存在是为了显示预设包含什么，一行「在预设里但已断开」会读成「没被包含」。
- **两个状态词都做成徽章。** 否决：一张卡上并排「已启用」和「连接失败」，会让人猜哪个控制什么。
- **管理器为失败另写一套措辞。** 否决：分类器与句子已经存在；再加一套措辞，正是两个界面当初漂移的原因。

## Consequences

- 服务行在两个界面上读起来一致，只差那个属于本界面的「是否包含」用词。
- 将来新增一项活事实只有一处要改：清单。
- `toolCount`/`runtime` 都是可选，背后没有进程的面不受影响。

## Verification

- 在 `market-dev` 实测，管理与设置对比、连接器面：管理器 `cloudflare · 套件 · 已启用 · https://mcp.cloudflare.com/mcp · 工具 4 · streamable-http`，面板 `cloudflare · 套件 · 已连接 · … · 工具 4 · streamable-http`；失败行 `kuboard · … · https://kuboard.platform.zealwon.com/mcp · 工具 0 · streamable-http · 连接超时 · 10.0s` 与面板一致。
- 语言引擎、技能、输出风格、系统提示词四面按同样方式复核：正文、计数、作用域与原因均与各自面板一致。
- 全量测试通过（2526），门禁干净。
