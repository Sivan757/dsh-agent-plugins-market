# Agent Note：文档编辑器改用真正的编辑器

Status: implemented

部分被[单视图记录](./2026-09-16-workspace-document-editor-single-view.md)取代：并排两栏已移除，编辑器在切换按钮后只显示一个通宽视图。

## Problem

文档编辑器编辑的是用户手写的一个 Markdown 文件，此前却只给了一个朴素的 `<textarea>`，并在它上面叠了两行重复的身份信息。

1. **编辑时身份出现两次。** 弹窗标题就是条目名，左窗格的 chip 就是它的文件名，可正文之前仍有一个装着同一个名字的 `名称` 输入框，以及一个把详情弹窗刚展示过的路径再打印一遍的只读框。
2. **副行在复述身后那个弹窗。** `技能 · 用户` 说的是详情弹窗概览行已经说过的话，而用户刚从那页看过来。
3. **这些外壳把两个窗格撑开了。** 正文上方的 `文档` 标签，加上左窗格里的身份行，让编辑框比旁边的预览框起步更低、收尾高度也不同。
4. **文本域不是编辑面。** 没有行号、没有语法高亮、没有括号匹配、没有文档级撤销——它是产品里唯一的代码形界面，也是唯一没有这些的。

## Decision

- **`ui/CodeEditor.tsx` 封装 CodeMirror 6。** 一个受控组件接收 `value`/`onChange`、`markdown` 或 `json` 语法、无障碍 `label` 与 `minHeight`；视图只创建一次，外部值变化通过 dispatch 送入，文本的归属仍是 React。
- **编辑器皮肤取自平台 token。** `EditorView.theme` 从 `--dsw-alias-*` 读取底色、文字、行号槽、当前行、选区与光标，两种主题无需分支即跟随；外框的边框、圆角与底色与表单样式表的控件一致。
- **Markdown 正文就是这个编辑器。** `EntryEditorModal` 在原来渲染文本域的位置渲染它，外面那层字段包裹已经去掉。
- **新建时的身份行落在窗格之上**（见[清理记录](./2026-09-16-workspace-editor-chrome-cleanup.md)），因此两种模式下两个窗格都只是「头部 + 框」。
- **编辑时弹窗只展示文档本身。** 副行与身份行都是新建时才需要的外壳：标题已经说明条目是谁、窗格 chip 已经说明文件是哪个，路径就在用户刚离开的详情弹窗上。新建时仍然要填名称，因为没有别的地方提供它。
- **两个窗格框尺寸一致。** 预览框在 `border-box` 下保有 240px 下限，编辑框是同一下限的 flex 列，因此实测两个框都是 240x408，而不再是 266 与 240。
- **钉住 chip 的行盒让两个头部等高。** 两种文字各自的 chip 会让头部一个 14px、一个 16px，从而把其中一个下方的框推移；chip 的 `line-height` 与头部的 `min-height` 都钉死，头部高度不再随标签文字变化。
- **文档标签移入编辑器的无障碍名称。** `文档` / `命令正文` / `系统提示词` 不再作为框上方的可见一行渲染；窗格头部已经说明了这个界面是什么（`编辑 Markdown`），标签通过 `aria-label` 抵达辅助技术。

## Alternatives considered

- **复用宿主现成的编辑器。** 否决：宿主没有。`@deepseek-ai/dsh-client-ui-primitives` 导出 `CodeBlock`、`JsonBlock`、`ReadBlock`、`DiffBlock`、`TerminalBlock` 与 `MarkdownText`，全部是只读渲染器；harness 自身的包也没有声明任何可借用的 CodeMirror 或 Monaco 依赖。这是「先复用宿主」落到宿主无可复用之处，而不是跳过了检查——上面的导出清单就是那次检查。
- **Monaco。** 否决：比它要进入的客户端 bundle 大一个数量级，而且它的 worker 与主题模型需要与一个自身并不持有 worker 的页面调和。
- **在文本域上叠一层高亮**（透明文本域后面放 `<pre>`）。否决：行号、滚动、选区与高亮对齐都要手写重造，而且仍然没有括号匹配与文档级撤销。
- **保留 `文档` 标签，用对侧占位把两栏拉平。** 否决：预览窗格在原型的同一位置并没有这类标签，占位是为了补偿一行冗余内容而凭空发明的空块；把界面名字在窗格头部说一次，正是原型已有的做法。
- **编辑时保留身份行，让同一套正文服务两种模式。** 否决：重命名本就不提供（文件名就是身份），这一行只能把标题与 chip 再复述一遍。
- **把 JSON 视图也换成编辑器。** 暂不：服务编辑器的 JSON 视图是表单视图所拥有的原始文档转储，换掉它会破坏测试驱动文本所用的 `aria-label` 接缝。用户写正文的地方才是 Markdown 正文。

## Risks

- **客户端 bundle 多了一个运行时依赖。** `@codemirror/state`、`@codemirror/view`、`@codemirror/commands`、`@codemirror/language`、`@codemirror/lang-markdown`、`@codemirror/lang-json` 声明在 `devDependencies` 中并像 React 一样被打进客户端——对「安装方不会自带副本的客户端 bundle」这是正确做法，但它确实带来体积：客户端从 448 kB 涨到约 750 kB。
- 编辑器持有自己的文档，因此在编辑中途重置 `value` 的调用方依赖的是 dispatch 副作用而不是重渲染；若以后每个弹窗出现第二个编辑器实例，需要同样处理。
- jsdom 没有布局，所以上面的对齐是浏览器实测，不是单元测试；测试套件锁定的是组件与接线，不是几何。

## Verification

- `pnpm run check:refactor` 通过；`pnpm run test` 82 个文件 / 638 个测试通过；`pnpm run build` 成功（`client/style.css` 51.67 kB）。
- 隔离 profile 走查，浅色与深色：编辑弹窗渲染标题、窗格头部、带行号与高亮的编辑器、提示与底部，且没有副行与身份行；`getBoundingClientRect` 报告两个窗格框都是 240x408，top（192）与 bottom（432）相同。
- 在编辑器里打字后实时预览在下一帧更新；保存发出 `POST /api/agent-plugins/user-panel/skills/update?name=review-code`（200），随后磁盘上的文件以所输入的那行结尾。
