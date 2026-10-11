# Agent Note: 面向 C 端的文档分层

Status: implemented

## Problem

两个根 README 达到 242 行，同时服务三类读者：首次来访者、已经在用插件的人，以及来查布局优先级的维护者。约三分之一是开发者参考内容：布局优先级表、布局支持矩阵、项目扫描开关、抽样验证与仓库结构。C 端读者在读到快速开始之前就离开了首屏。同一份 FAQ 存在三处，分别在 `README.md`、`docs/user/usage.md` 与 `docs-site/src/pages/faq.astro`，且没有任何一处被指定为准。

安装一节还把终端命令放在最前，而 DSH 图形界面已经支持按包名安装插件：侧边栏的插件页会打开「添加插件」对话框，接受 npm 包名、仓库地址或本地目录（harness checkout 中的 `packages/client/ui-plugin-manager/src/client/locales.ts` 第 56 至 70 行）。

## Decision

每个入口只服务一类读者，对应 Diátaxis 的一个象限。README 是门面与教程，文档站是完整文档，`packages/market-ui/src/locales.ts` 是界面文案的唯一真源，`CONTEXT.md` 继续充当维护者词汇表。一个主题只出现在一处。

两个 README 都压到 140 行，章节顺序一致：价值、截图、快速开始、功能亮点、日常使用、兼容性、常见问题、文档、交流群。`README.md:62` 把功能亮点拆成核心能力与进阶能力两层，因此 MCP OAuth、按工作区生效的开关这类进阶能力各自独占一行，不再埋在复合句里。

快速开始改为图形界面五步。终端命令降为一行替代方式。所有图片改用 `raw.githubusercontent.com` 绝对地址，因为 npm 以不同的基础路径渲染同一份 `README.md`。

兼容性内容整体移出 README。`docs-site/src/pages/compatible-plugins.astro` 承接运行时能力表、布局优先级表、支持矩阵、项目开关与抽样验证，README 只链接过去。README 保留四条高频问题，其余指向站点 FAQ，站点 FAQ 成为唯一真源。站点的安装页、首页与 FAQ 均把图形界面路径放在最前。

## Alternatives considered

**只重写措辞，保留现有结构。** 否决：问题在内容分配，不在文字。三类读者仍会争夺同样的 242 行。

**把八个私有包拆成公开发布的 npm 包。** 本次否决，其自身价值也暂缓。插件只发布一个产物、工作区包保持私有，拆包会把发布面从一个版本变成九个，而目前没有任何外部消费者提出需要。若将来真要拆，需要为每个包准备独立的 npm 首页文案，属于另一个决策。

**把兼容性表格留在 README，压缩别处。** 否决：GitHub 与 npm 渲染同一份 `README.md`，README 是唯一同时服务首次来访者与布局支持评估者的页面。参考细节属于带自身导航的文档站。

## Consequences

文档站从此承接兼容性参考及其入站链接。`.github/workflows/docs-pages.yml` 只监听 `docs-site/**`，因此 `docs/` 下的改动不会重建已部署站点；站点改为用 GitHub 绝对地址链接这类页面，而不是渲染它们。

有三条入站链接指向被移走的 README 表格：`docs/user/usage.md` 及其中文版，以及 `schemas/README.md`。三条现已指向站点锚点 `compatible-plugins/#shared-layout-precedence`。

`CONTRIBUTING.md` 仍在描述已被移除的 `src/` 目录。本次改动把它的目录结构更正为 `index.ts` 加上 `packages/`。

`docs/reference/version-audit-2026-10-07.md` 按 242 行版本引用 README 行号。这份带日期的审计快照保持行号不变，因为改写它会篡改那次审计的记录。

本记录部分取代[README 信息结构](2026-09-08-readme-information-structure.md)：其章节顺序与「继续扩充功能列表」这一备选方案已不再描述现状，而其文案规则通过[面向用户的文案不展示决策与多余提示](2026-09-11-user-facing-copy-omits-decisions.md)继续有效。两条记录保持活跃并互相链接。

## Testing

`pnpm run format:check` 与 `tsconfig.json`、`tsconfig.client.json` 两个 TypeScript 项目均通过。全量 vitest 在 Node 24 上通过：213 个文件、2048 个测试。`tests/compat-report.test.ts` 仍能从两个 README 中找到 `docs/reference/compat-report.md` 与 `docs/user/layout-coverage` 链接。Astro 构建产出四个页面，线上路由与优先级锚点均返回 200。
