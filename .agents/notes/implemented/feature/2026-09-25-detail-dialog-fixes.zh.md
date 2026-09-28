# Agent Note：插件面板条目移除删除入口，详情底栏瘦身

Status: implemented

## 问题

维护者报告的四个缺陷，均已在 dev 树上复现核实：

1. PanelResources.remove 对 plugin 来源的面板条目直接 unlink 套件检出内的文件——删除入口越过了套件管理（安装/卸载才拥有插件文件）。
2. ui/detail.module.css 把底栏第一个子元素拉伸占满整行（.footer > :first-child { flex: 1 }），孤立的关闭/完成按钮因此铺满底栏。
3. agent persona 详情对话框把全部路由 frontmatter 压成 kv 标签列里的一行元数据字符串——model/provider/思考强度实际上不可见。
4. MCP 详情底栏带着整服务启停开关，与列表里每张卡片的开关重复，而详情视图是只读的。

## Decision

- 删除 plugin 来源的面板条目现在在 PanelResources.remove 抛错（"由所属套件管理，请卸载套件"），UserPanelSurface 只对用户自建条目提供 onDelete。plugin 条目的编辑与启停按既有设计保留：编辑经过 realpath 包含检查，启停写入用户 override。
- 首子元素拉伸规则删除，它所支撑的填充按钮一并移除：SuiteDetail 只保留主操作（安装）或卸载；UserEntryDetail 与 MCP 详情去掉幽灵关闭按钮（弹窗 chrome 的 closeLabel 与 ESC 仍可关闭）；MCP 底栏保留条件性重新授权与其结果回显，移除重复的开关（卡片开关写同一份 override）。
- agent persona 详情把 model/provider/思考强度渲染为独立的带标签行（snake_case 优先、camelCase 兜底、'inherit' 原样显示），新增双语 locale key；其余元数据保留一行兜底展示，label 与 value 归位。
- 验证轮新增两个测试（删除入口仅出现在用户自建卡片；persona 路由 frontmatter 独立渲染且兜底行保留其余键），并修复其暴露的真实缺陷：routingRows 数组元素缺 React key，kv helper 增加可选 key，路由键从兜底行排除以免重复渲染。

## Consequences

- 依赖门禁不变；测试计数不变（断言随被移除按钮更新）。
- 布局阶段加入的 feature 隔离规则不受影响。

## Verification

- 提交树上 typecheck、eslint、全量测试、check:architecture、prettier 全绿。
