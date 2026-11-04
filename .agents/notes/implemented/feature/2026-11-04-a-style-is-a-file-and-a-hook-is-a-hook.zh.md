# Agent Note：风格是文件，钩子是钩子

Status: implemented

## Problem

对其他市场的调研发现，生态里的输出风格有两种形态，而本插件对两种都不够好。GitHub 代码检索在 `output-styles/` 下命中 940 个 Markdown 文件，官方插件参考也把 `output-styles/` 列为插件组件（manifest 的 `outputStyles` 字段可替换它）。Claude Code 把插件风格解析为带 frontmatter（`name`、`description`、`keep-coding-instructions`）的、加命名空间的 Markdown 文件。本插件此前只处理一种形态：官方示例插件的做法——SessionStart 钩子打印文本，页面通过运行该钩子抓取。

那套设计在页面读取时运行套件的程序，让读者逐行按按钮，而且对自带风格文件的套件仍然什么都不显示。它还把钩子放错了面：SessionStart 钩子是钩子，不是输出风格。

## Decision

- **套件的 Markdown 风格按文件读取。** `discoverSuiteStyles` 读 `output-styles/*.md`（或 manifest 的 `outputStyles` 声明，支持与其它 Markdown 组件相同的几种形状），保留 frontmatter 元数据与正文。目录记录把它们作为 `styles` 携带，运行期每行一条，id 为 `suite:<sourceId>/<suiteId>:<name>`。
- **工作区的项目风格从 `.claude/output-styles/` 读。** 从会话工作目录到仓库根之间的每一层目录都读，同名就近取胜，与 Claude Code 的规则一致。行 id 为 `project:<name>`。
- **没有会话的页面既不列项目风格，也不回落到进程目录。** 这与指令链已经遵循的规则一致：设置页不属于任何工作区。
- **钩子注入的人设文本交给钩子面。** 抓取路由、它的状态文档字段、UI 与测试全部删除。钩子页本来就列出那个 SessionStart 钩子及其要执行的命令，钩子就该在那里。

## Alternatives considered

- **保留抓取，作为只有钩子的套件的兜底。** 上面的决定否决：打印 `additionalContext` 的 SessionStart 钩子是宿主已经会运行的钩子，把它再复制成一个可选的风格，会让同一段文本从两条通道到达。
- **扫描时把套件的风格文本复制进插件数据。** 否决：文件才是唯一来源，复制品在套件更新那一刻就过期。每次读取直接读文件。
- **把命名空间写进标签（`suite:style`）。** 标签否决：套件在行上单独显示（`suiteName`），id 承担命名空间。
- **设置页从 `process.cwd()` 读项目风格。** 否决：那是宿主恰好启动的目录，就是指令页刚修掉的同一个缺陷。

## Consequences

- 安装带 `output-styles/` 的套件后会显示它的风格；这些行是只读的，因为套件的文件就是唯一来源。
- 选中套件或项目风格后跟随文件：文件改了文本就改，文件没了就停止注入，没有需要报告的过期状态。
- 选择文档只保留 `styleId`；契约里的 `captured` 字段与抓取路由都已移除。
- 钩子面成为 SessionStart 钩子唯一出现的地方。

## Verification

- 新增测试：扫描器读约定目录、manifest 声明、内联表与缺失目录；服务列出套件文件、跟随改动、在文件被移除后停止注入、按就近原则读项目风格、无会话页面不列项目风格；路由返回套件风格并拒绝未知 id。
- 在 `market-demo`（环境重置后重建）实测：工作目录里的 `.claude/output-styles/team-voice.md` 在无会话的设置页读取中不出现（符合预期）。本轮浏览器自动化不可用，会话作用域的读取与面板由测试验证，未在 GUI 中实测。
- 全量 2559 测试通过，门禁干净。
