# Agent Note: one dialog shell, one action row, one radius scale

Status: implemented

## Problem

负责人又走查了一遍工作区，提了四件事：把已废弃的进度路由清理得仿佛从未存在过；让滚动条吃掉的那 5px 从字段边上消失；所有表单收进同一个组件；所有圆角出自同一套标度。四件都是上一轮留下的半成品事实。

| 发现 | 代码当时的样子 |
| --- | --- |
| 对话框外壳 | 十三个对话框在宿主 `Modal` 上各自拼外壳：`features/extension-presets/ExtensionPresetEntry.tsx` 里七个，`AiSelectionModal`、`SourceEditorModal`、`InstallConfirmModal`、`MarketSection`、`panel.tsx`（编辑器与确认框）各一个，两个服务编辑器经 `ServerConfigModal` 各一个。 |
| 动作行 | `footerHint`、`footerCount`、`footerError`、`modalFooterLeft` 把提示语、字节计数、失败原因或破坏性按钮摆在按钮左边。新建提示 `创建后立即生效，可在列表里停用` 是最明显的一例：按钮行里的一整句散文。 |
| 滚动条 | 对话框正文用自己的 5px 滚动条，于是会滚动的对话框字段比页脚短 5px，滚动条出现时版面还会跳。 |
| 圆角 | 三十三处声明用手写的 4、6、8、10、999 像素，同一屏上就有三种。宿主有圆角标度，也有一份标准说明每个角色该取哪一档。 |
| 废弃路径 | 上一轮把 `/progress` 路由「留给存储层自测与文档」保留了下来，等于保留了一个没人要的第二个读者。 |

## Decision

### 每个对话框只有一个外壳

`ui/DetailModal` 拥有外壳：宿主的标题行、会滚动的正文、一行页脚。`ui/FormDialog` 是同一个外壳加表单正文。对话框传 `actions`，不再传 `footer`；外壳把这一行右对齐渲染，别的什么也不放。被拒绝的请求以 `alert` 交上来，落在标题下方、表单开始的地方，而不是挨着出错的那个按钮。原先待在页脚的提示都回到了正文：指令文件的字节计数与上限放在文档下面，输出风格的命名规则放在名称字段下面，保存的后果写进对话框的说明。

### 滚动条是悬浮的

对话框正文的原生滚动条隐藏且不占宽度。一枚 6px 的半透明滑块画在内容之上、跟随滚动位置，所以无论是否滚动，字段的右边界都与页头、页脚一致，滚动条出现时也没有任何东西跟着挪动。滑块是滚动区域的兄弟节点，不是被滚动内容的子节点，因此不会跟着滚走。

### 聚焦的字段穿自己的边

宿主的全局 `:focus-visible` 给文本控件画 2px 偏移外环，而这张表过去又叠了一层 2px 环：聚焦的输入框读起来像是字段外面又多了一重更重的框。现在聚焦的文本控件保持自己的几何：边框换成 `--dsw-alias-state-business-primary`，再用同色 18% 的 3px 柔光补足提示，不支持 `color-mix` 的浏览器回落到宿主的 `state-business-tertiary`。字段不再写 `outline` 与 `outline-offset`；按钮、卡片与胶囊上的键盘焦点环保留。

### 圆角只用一套标度

所有圆角出自宿主的 `--dsw-radius-*` 档位，按宿主标准写明的角色选：控件与输入 R12，紧凑控件（24px 图标按钮、分段按钮、工具「更多」）R8，分组内容（详情里的卡片、状态带、编辑器、预览、字段组、mono 块）R16，独立列表卡片 R20，悬浮的操作遮罩也是 R20，小的行内细节（焦点环、标签）R4。胶囊保留 999px 并写出 `corner-shape: round`，宿主标准要求任何圆点或胶囊都配对这条曲线。

### 废弃的路由已经清空

`MARKET_ROUTES.progress`、`SourceProgress` 契约、`MarketQueries.sourceProgress` 端口方法、`Catalog.sourceProgress` 及其 begin/step/end 包装、存储层的 `progress()` 与步骤记账、客户端绑定，以及钉住它们的测试全部删除。存储层只保留一条在途获取记录，因为 checkout 探测不能与它抢；这条记录只有来源 id 与是否已克隆。

## Alternatives considered

- **继续用宿主 `Modal`，逐个手修页脚。** 否决：那正是负责人报告的状态。十三行各自漂移，每新加一个对话框就再来一次。
- **在正文与页脚两侧都预留滚动条沟槽。** 否决：它只靠把每个对话框的字段再收窄 5px 来对齐，也挡不住滑块出现与消失。
- **把滑块放在被滚动内容里的独立滚动容器。** 否决：被滚动内容的子节点会跟着滚走；滑块必须是滚动区域的兄弟节点。
- **保留按组件手写的圆角，只是「取同一值」。** 否决：宿主标准是按角色与高度编码的，24px 图标按钮与 96px 卡片本就该取不同弧度。负责人否掉的是随手写死的数值，不是档位。
- **给圆角再做一层插件自己的 CSS 变量。** 否决：宿主的 token 就是那一层，第二层只是多点维护、多点漂移。

## Consequences

- 不提供动作的对话框会渲染出空的页脚行；外壳把它留给设置框架自己的按钮。
- 正文现在是 `overflow: hidden`、滚动下沉一层，所以依赖正文自身滚动的规则（MCP/LSP 的 `detailBody` max-height）随之删除。
- 5px 的内缩从每个对话框消失，而不只是被量过的那两个。
- 卡片的圆角从 10 变成 20，输入框从 8 变成 12，于是市场卡片更圆、字段更有分寸。这是标度在起作用，也是负责人要的那处可见变化。
- 现在有两条面向源码的守卫盯着这个形状：`packages/market-ui/test/dialog-shell.test.ts` 拒绝导入宿主 `Modal` 的对话框、传 `footer` 的对话框、任何 `footerHint` 家族的名字、标度之外的弧度，以及没有配曲线的胶囊；`dialog-footer-size.test.ts` 现在同时扫描 `actions` 与 `footer`。
- 主题 token 守卫需要补上四个宿主圆角 token 与 `--dsw-alias-label-caption`；每一条都在列进去之前对照宿主源码核过。

## Verification

- 这次改动之后 `pnpm run test` 全绿：302 个文件，2711 个测试。
- `packages/market-ui/test/dialog-shell.test.ts`（5 个用例）读源码与样式表；对着改动前的树验过，它会把每一处宿主 `Modal` 导入与每一处手写弧度都标出来。
- `packages/market-ui/test/dialog-footer-size.test.ts` 渲染指令文件与语言引擎详情，断言它们的页脚按钮只有一个尺寸，并扫描每个 `actions` 表达式有没有自带尺寸。
- 在 `market-demo` 里以 1448x1126、设置框架 800x800 现场测量：
  - 用户技能详情的页脚在行首是 删除、行尾是 完成，滚动滑块 opacity 为 1、高度 335px；
  - 连接器新建对话框的整行字段止于 1028，与 创建 同一条边；
  - 钩子新建对话框宽 800，三个字段、两颗页脚按钮，没有任何起草控件。
- `pnpm run typecheck`、`pnpm run lint`、`pnpm run format:check` 与 `pnpm run build` 全绿。
