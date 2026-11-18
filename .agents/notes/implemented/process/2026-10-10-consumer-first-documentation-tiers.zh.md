# Agent Note: 面向 C 端的文档分层

Status: implemented

## Problem

两个根 README 达到 242 行，同时服务三类读者：首次来访者、已经在用插件的人，以及来查布局优先级的维护者。约三分之一是开发者参考内容：布局优先级表、布局支持矩阵、项目扫描开关、抽样验证与仓库结构。C 端读者在读到快速开始之前就离开了首屏。同一份 FAQ 存在三处，分别在 `README.md`、`docs/user/usage.md` 与 `docs-site/src/pages/faq.astro`，且没有任何一处被指定为准。

安装一节还把终端命令放在最前，而 DSH 图形界面已经支持按包名安装插件：侧边栏的插件页会打开「添加插件」对话框，接受 npm 包名、仓库地址或本地目录（harness checkout 中的 `packages/client/ui-plugin-manager/src/client/locales.ts` 第 56 至 70 行）。

## Decision

每个入口只服务一类读者，对应 Diátaxis 的一个象限。README 是门面与教程，文档站是完整文档，`packages/market-ui/src/locales.ts` 是界面文案的唯一真源，`CONTEXT.md` 继续充当维护者词汇表。一个主题只出现在一处。

两个 README 各 148 行，章节顺序一致：价值、演示、快速开始、热门仓库、功能亮点、日常使用、兼容性、常见问题、文档、反馈。`README.md:57` 把功能亮点拆成核心能力与进阶能力两层，因此 MCP OAuth、按工作区生效的开关这类进阶能力各自独占一行，不再埋在复合句里。

演示一节紧跟价值陈述，用带字幕的五步讲完一个故事：添加来源、安装套件、保存扩展预设、在会话里切换预设、开始工作。它是在一次性 profile 里对图形界面的真实录屏，因此不会出现维护者自己的工作区内容。两种语言各录一份，即 `docs/screenshots/demo.en.gif` 与 `docs/screenshots/demo.zh.gif`，图片链接到旁边同一份录屏的 MP4。动图下方的五行编号文字重复了字幕，动图加载不出来时故事仍然完整。

日常使用一节以第二份录屏开头，录制方式相同，即 `docs/screenshots/workspace.en.gif` 与 `docs/screenshots/workspace.zh.gif`。它讲的是不安装任何东西也能做的事：写一个技能、编辑系统提示词、关掉会话用不到的连接器工具、选一个输出风格。四行编号文字重复了它的字幕。六张页面截图退出了 README：它们展示的界面后来已经改动，画面里还是维护者自己的工作区。

价值陈述以读者搜索的词开头：一个技能与扩展管理器，Claude Code、Codex、Cursor、Kimi 的插件仓库原样安装。随后的热门仓库一节点名五个仓库，并列出市场在每个仓库里识别到的内容。2026-11-18，四个技能仓库在一次性 profile 里经已发布的 0.15.3 包的市场路由添加并安装，技能面板分别列出 15、39、22、19 个技能。第五个 claude-plugins-official 是演示录屏所安装的来源。该节给出的是当天的数量。微信群退出了 README，最后一节把反馈引向 GitHub Issues。

快速开始改为图形界面五步。终端命令降为一行替代方式。所有图片改用 `raw.githubusercontent.com` 绝对地址，因为 npm 以不同的基础路径渲染同一份 `README.md`。

兼容性内容整体移出 README。`docs-site/src/pages/compatible-plugins.astro` 承接运行时能力表、布局优先级表、支持矩阵、项目开关与抽样验证，README 只链接过去。README 保留四条高频问题，其余指向站点 FAQ，站点 FAQ 成为唯一真源。站点的安装页、首页与 FAQ 均把图形界面路径放在最前。

## Alternatives considered

**只重写措辞，保留现有结构。** 否决：问题在内容分配，不在文字。三类读者仍会争夺同样的 242 行。

**把八个私有包拆成公开发布的 npm 包。** 本次否决，其自身价值也暂缓。插件只发布一个产物、工作区包保持私有，拆包会把发布面从一个版本变成九个，而目前没有任何外部消费者提出需要。若将来真要拆，需要为每个包准备独立的 npm 首页文案，属于另一个决策。

**把兼容性表格留在 README，压缩别处。** 否决：GitHub 与 npm 渲染同一份 `README.md`，README 是唯一同时服务首次来访者与布局支持评估者的页面。参考细节属于带自身导航的文档站。

**以六张页面截图开头，不加演示。** 否决：六张静态页面说明工作区里有什么，却说明不了使用顺序。带着“怎么控制会话带哪些扩展”来的读者，只能在功能亮点的一行里找到答案。截图还会随每次界面改动过时，因此 README 不再内嵌它们。

**把每张页面截图各换成一段动图。** 否决：六段动图重复了下方的页签表，每次界面改动的重录工作也成倍增加。两份录屏对应读者带来的两个问题：装什么，写什么。

**继续以“一站式管理器”开头，并把插件介绍成一个市场。** 否决：截至 2026-11-17 的 14 天里，仓库有 197 个独立访客，新增 3 个 star。而本插件无需改动即可安装的那些仓库，其社区移植版各有 168 到 381 个 star，一个技能管理器有 581 个。读者按名字找技能仓库，或者找技能管理器，这两者此前都不在 README 的开头。

**用 video 元素直接内嵌 MP4。** 否决：README 在 GitHub 与 npm 上必须渲染一致，而图片已经在两处从绝对地址渲染，动图走的是同一条路。npm 上的视频内嵌没有验证过。MP4 保留为链接目标，因为它更清晰，也能暂停。

**用动效代替产品录屏。** 否决：录屏证明流程确实如画面所示。动效在每次界面改动后都要重画，而且证明不了任何事。

## Consequences

八个录屏文件给仓库历史增加约 28 MB 的二进制媒体。市场页、预设管理器或输入框旁的预设按钮一旦改动，演示录屏即过时。技能、系统提示词、连接器或输出风格页签一旦改动，工作区录屏即过时。过时的录屏需要两种语言各重录一份。

六张页面截图留在 `docs/screenshots/`，直到某次发版把新 README 发布出去。本次改动之前发布的 npm 版本，其 README 仍从 `main` 加载这些截图，提前删除会让那个 npm 页面的图片失效。

热门仓库表里的数量会随五个仓库的变化而过时。扫描器的技能发现逻辑一旦改动，或者某个列出的仓库调整了布局，都需要把同样的检查再做一遍。

`screenshots.json` 放在仓库根目录，因为社区插件商店在 `package.json` 旁边读取它，并以该目录解析其中的路径。它列出 `docs/screenshots/` 下的五张静态图，取自英文录屏。`docs/screenshots/social-preview.png` 用于仓库的社交预览设置，只有仓库所有者能上传。

微信群二维码图片与六张页面截图一样暂留在 `docs/screenshots/`，原因相同。

文档站从此承接兼容性参考及其入站链接。本次改动当时，`.github/workflows/docs-pages.yml` 只监听 `docs-site/**`，因此 `docs/` 下的改动不会重建已部署站点，站点改用 GitHub 绝对地址链接这类页面而不是渲染它们。[文档站直接渲染使用指南](2026-10-11-docs-site-renders-the-user-guide.md) 随后把 `docs/user/**` 加入触发路径，并让站点直接渲染指南页面，因此本记录关于 GitHub 外链的后果已不再描述现状。

有三条入站链接指向被移走的 README 表格：`docs/user/usage.md` 及其中文版，以及 `packages/market-catalog/schemas/README.md`。三条现已指向站点锚点 `compatible-plugins/#shared-layout-precedence`。[文档站直接渲染使用指南](2026-10-11-docs-site-renders-the-user-guide.md) 随后把该指南拆成七个任务页，因此 `docs/user/usage.md` 已不存在。

`CONTRIBUTING.md` 仍在描述已被移除的 `src/` 目录。本次改动把它的目录结构更正为 `index.ts` 加上 `packages/`。

`docs/reference/version-audit-2026-10-07.md` 按 242 行版本引用 README 行号。这份带日期的审计快照保持行号不变，因为改写它会篡改那次审计的记录。

本记录部分取代[README 信息结构](2026-09-08-readme-information-structure.md)：其章节顺序与「继续扩充功能列表」这一备选方案已不再描述现状，而其文案规则通过[面向用户的文案不展示决策与多余提示](2026-09-11-user-facing-copy-omits-decisions.md)继续有效。两条记录保持活跃并互相链接。

## Testing

`pnpm run format:check` 与 `tsconfig.json`、`tsconfig.client.json` 两个 TypeScript 项目均通过。全量 vitest 在 Node 24 上通过：213 个文件、2048 个测试。`packages/market-bundle/test/repo/compat-report.test.ts` 仍能从两个 README 中找到 `docs/reference/compat-report.md` 与 `docs/user/layout-coverage` 链接。Astro 构建产出四个页面，线上路由与优先级锚点均返回 200。
