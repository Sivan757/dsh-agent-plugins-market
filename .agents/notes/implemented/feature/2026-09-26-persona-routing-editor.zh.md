# Agent Note：plugin persona 暴露仅路由的编辑器

Status: implemented

## 问题

plugin 来源的面板条目内容改为只读后，agent persona 丢失了唯一一项机器本地设置：路由 frontmatter（model、provider、思考强度）属于用户机器的配置，而非套件拥有的文本。plugin 条目的铅笔被隐藏后，安装后无法再调整路由。

## Decision

Agent persona 是只读内容的例外，范围收得很紧：

- 服务端：`assertStateFlipOnly` 对 agents 类型精确放行 `model`、`provider`、`reasoning_effort` 及其 `reasoningEffort` 别名——叠加在 `disabled`（全类型）与 skills 的 invocation 键对之上。正文必须逐字节不变；其余任何键的增、删、值变化都拒绝。
- 客户端：plugin persona 的铅笔打开仅路由形态的编辑器（EntryEditorModal 新增 `routingOnly` 属性，隐藏文本标签行与原始 CodeEditor）。结构化的 `RoleMetadataFields` 控件是唯一可编辑面；名称字段在编辑模式本就不渲染（既有行为）。
- plugin 的 skills 与 commands 保持仅开关；用户自建条目保留完整编辑。

## Consequences

- 原始 Markdown 正文编辑器不会为 plugin persona 打开，正文规则无法从 UI 绕过。
- `reasoning_effort` 为规范存储键；`reasoningEffort` 别名在输入时接受并归一化移除。
- agent persona 的兜底元数据行排除路由键，避免与独立行重复渲染。

## Verification

- 探针测试：plugin persona 的仅路由翻转成功并重写注册文件；正文编辑与 `tools` 编辑分别被拒绝且文件保持不变。
- 入口矩阵：plugin persona 与用户卡片有铅笔，plugin skill/command 卡片无；删除钮仅在用户卡片。
- 全量测试、typecheck、eslint、架构门禁与 prettier 全绿。
