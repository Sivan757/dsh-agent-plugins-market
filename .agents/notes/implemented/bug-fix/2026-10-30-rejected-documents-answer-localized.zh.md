# Agent Note：被拒绝的配置用读者的语言解释

Status: implemented

## Problem

文案评审发现的两处缺陷，都关于对话框用读者用不上的话解释自己。

**被拒绝的文档说英文。** `server-form.ts` 直接抛带英文消息的 `Error`（"Configuration must be a JSON object"、`mcpServers must contain only the service key "…"`），编辑器把它接在本地化的「JSON 无效」后面：每次粘贴的文档出错，中文用户读到的是中文标签加一句英文。

**钩子详情说的是另一种方言。** 它的区块间距 22px、标题 13px 句首大写；而旁边的 MCP、LSP 与套件详情用共享的 `.block`（上边距 18px）与 `.blockHead`（11px 大写、加字距）。同一个窗口里的两种对话框读起来像两个产品。

## Decision

- **被拒绝的文档带错误码，句子由编辑器负责。** `ServerFormError` 携带五种错误码之一（`not-object`、`service-key`、`policy-key`、`single-service`、`service-object`），消息里点名服务键时一并携带。它的英文 `message` 保留给日志与追踪；编辑器把错误码映射成词典键并插值，因此渲染出来的是本地化句子。不是 `ServerFormError` 的错误仍渲染自己的消息，因为那是宿主文本，本插件无法翻译。
- **钩子详情复用共享区块节奏。** 区块改用 `panel.block` 与 `panel.blockHead`；本地 `.section` 与 `.sectionTitle` 规则删除，外层列不再在区块自身外边距之上再加 22px 间距。

## Alternatives considered

- **在抛出错误的地方翻译。** 否决：`server-form.ts` 是没有翻译器的纯解析器，给它塞文案会让一个「只测 JSON 形状」的模块开始承载界面词语。
- **保留英文消息、在前面加中文标签。** 否决：那正是读者已经看到的东西。
- **给钩子详情单独写一套 18px/11px 规则而不复用面板的。** 否决：两份文件里相同的数值一定会漂移，只有复用能一直相等。

## Consequences

- 粘贴坏文档的读者每个问题只读到一句本地化说明，而不是中文标签加英文原因。
- 新的拒绝原因现在需要一个错误码和一条词典，类型系统会强制这一点。
- 钩子详情的标题与其它详情对话框读起来同一重量。

## Verification

- `packages/market-ui/test/client-detail-editors.test.ts` 与服务配置相关用例保持绿；删除钩子规则后 `pnpm run check:css` 报告没有未使用类。
- 四个类型检查、`check:refactor` 与全量测试通过。
