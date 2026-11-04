# Agent Note：可以把失败交给别人的一份报告

Status: implemented

## Problem

连接器或语言服务器失败时，面板知道地址、传输方式、归类后的成因与建议。想求助的读者只能对着截图重新敲一遍，而对面还得猜四个失败行里说的是哪一个。

## Decision

- **一段可复制的文本，一个构造器。** `ui/diagnostics.ts` 输出界面名、条目标名、状态、每行一个事实（地址或命令、传输方式、工具数、原因、建议）、成因链与观测时间。事实顺序固定、空值丢弃，因为报告是给人读的，不是给程序解析的。
- **两个详情都有。** 连接器详情把「复制诊断」放进操作行，语言服务器详情放在页脚，于是服务失败和服务器失败出现在同一个位置、用同一句话。
- **剪贴板的结果会回报。** `copyText` 返回浏览器是否接受写入；文档未聚焦就足以让剪贴板 API 拒绝，此时若宣称复制成功就是在说谎。

## Alternatives considered

- **复制 JSON。** 否决：读者是在聊天窗口里的人，而一段带脱敏字段的 JSON 只会引来第二轮「哪个字段重要」的问答。
- **把这堆文本常驻在面板里而不是按钮。** 否决：五行文本大多数人用不到，而且会把每一行的列表往下挤（正是页签切换那条笔记去掉的缺陷）。
- **翻译事实标签。** 否决：标签指向宿主的数据字段（`endpoint`、`transport`），翻译过的标签更难和日志对照；值本来就是面板显示的语言。

## 与早前笔记的关系

建立在[「失败行说明原因」](../bug-fix/2026-10-31-a-failed-row-says-why.zh.md)与 [「一种读取失败呈现」](../bug-fix/2026-10-31-one-read-failure-presentation.zh.md)之上：那两条决定失败在屏幕上**说什么**，这一条把同一段话做成可以带离屏幕的文本块。

## Consequences

- 一份失败报告是一次粘贴，并且点明了是哪一行。
- 读者需要的建议句就在文本里，不只在屏幕上。
- 语言服务器详情的页脚第一次有了「完成」以外的操作。

## Verification

- 在 `market-dev` 实测：对失败的 `kuboard` 连接器点「复制诊断」，复制到 `dsh-agent-plugins-market · 连接器 (MCP) · kuboard` 以及 `state: 连接失败`、 `endpoint: https://kuboard.platform.zealwon.com/mcp`、`transport: streamable-http`、 `tools: 0`、原始原因、本地化建议与 `causes: - MCP error -32001: Request timed out`；对话框回显「诊断已复制」。
- `packages/market-ui/test/client-diagnostics.test.ts` 钉住行序、空值丢弃与两种剪贴板结果。
- `packages/market-ui/test/mcp-status-render.test.ts` 打开一个失败行，断言复制出的文本与回显。
