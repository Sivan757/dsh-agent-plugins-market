# Agent Note: 文档站直接渲染使用指南，而不是复述它

Status: implemented

## Problem

`docs-site/` 此前只有四个页面：首页、安装指南、兼容插件参考与常见问题。任何需要用户指南细节的地方，都外链到 `github.com` 上的 `blob/main/docs/user/usage.md`，因此读者一到站点就被送走。站点只是顶着文档站地址的门面页。

指南本身是每种语言一个 223 行的页面（`docs/user/usage.md`、`docs/user/usage.zh.md`），覆盖安装、来源、存储、MCP、LSP、hooks、翻译、设置与操作遮罩：只想找一个答案的读者要滚过九个不相关的话题，除了长页面里的锚点之外也无法链接到其中一节。另外两组成对页面 `agent-roles` 与 `layout-coverage` 在站点上同样只能跳 GitHub。

## Decision

站点直接渲染指南文件。`docs-site/scripts/copy-guide.mjs` 把 `docs/user/*.md` 复制进站点，由 VitePress 按 `docs-site/.vitepress/config.mts` 的 `rewrites` 映射渲染副本（机制原为 Astro 内容集合，已被 [VitePress 重建](2026-10-11-docs-site-vitepress-rebuild.zh.md) 取代）。仓库仍是唯一真源：改动 `docs/user/` 会同时更新 GitHub 视图与已发布站点，不存在会漂移的第二份副本。

路由取自源文件名。英文页位于 `/docs/<名称>/`，中文页位于 `/docs/zh/<名称>/`，语言切换因此有了真实落点：每个指南页都链到紧邻的对应语言页。

链接在迁移后仍然可用。`copy-guide.mjs` 逐一改写作者写下的 Markdown 链接：目标仍留在 `docs/user/` 内的转为站点路由，其余（README、`schemas/`、源码、测试）转为 GitHub 的 `blob/main/` 地址。站点不发布这些文件，因此不假装发布。

阅读顺序现在位于 `docs-site/.vitepress/guide.ts`（`GUIDES`，即原 `NAV_ORDER`，与 `SECTIONS`）；Astro 时期在 `docs-site/src/guide/guide.ts`，刻意不放 `lib/` 目录：原因见[后果](#consequences)一节。

**指南改为一页一任务。** 223 行的那一对拆成七对：`install`、`sources`、`resources`、`services`、`translation`、`settings`、`workspace`。每页只负责一个主题，读者一进来就能看到自己要找的内容，也能直接链接到它。原先作为旧页面各部分子节的章节（`Project layouts`、`MCP configuration`、`Hooks and LSP`、`Resource detail editing`）上升为新页面的顶层章节，阅读顺序记在指南库中：`GUIDES`（时为 `NAV_ORDER`）列出页面，`SECTIONS` 把它们归入 `Get started`、`Content`、`Capabilities`、`Workspace`、`Reference`。

拆分是机械操作，不是重写：脚本按行区间切片并把文本原样重新写出。只有两处是刻意的：旧文件第 9 行重复了 `Project layouts` 一节已经完整覆盖的内容，作为重复项删除，其中唯一独有的从句并入本就负责该事实的句子；容器标题 `## Format details and development` 与 `## 格式细节与开发` 随容器一并消失。

每个页面都带一行 `**Guide:**` 兄弟页链接，因为站点侧栏在 GitHub 上并不存在：没有它，页面顺序在仓库视图里就不可见。

站点新增 `/docs/` 指南索引、按分组的侧栏、语言切换，以及共享导航中的「使用指南」入口。既有页面不再为指南细节外链 GitHub。

`docs-pages.yml` 现在同时监听 `docs/user/**` 与 `docs-site/**`。此前改动指南不会重建已部署站点，站点之所以用 GitHub 绝对地址链接指南，正是因为这一点。

## Alternatives considered

**把指南复制成 `docs-site/` 下的 Astro 页面。** 否决：双语 223 行页面出现两份副本就会漂移，而「`docs/user/` 页面成对编辑」这条仓库规则也将不再是全部事实。站点也无法再证明它发布的内容就是仓库交付的内容。

**把指南作为独立 Astro 内容目录，由构建步骤从 `docs/user/` 同步。** 否决：同步步骤就是第二个真源，且存在过期的窗口，还需要自己的测试。loader 直接读取仓库文件。

**安装 `@astrojs/markdown-remark` 以通过 rehype 插件改写链接。** 否决，因为没有必要。Astro 7 用自己的处理器渲染内容集合，渲染结果中的 `href` 是普通属性，做定向字符串改写即可，无需新依赖。新依赖需要仓库规则要求的理由，而这一条不带来任何收益。

**保留站点的 GitHub 外链，把指南做成一个长页面。** 否决：侧栏、语言切换与逐页 head 元数据正是让指南在站点内可导航的东西。每种语言一个 223 行的长页面读起来像倾倒内容，读者也无法链接到其中某一节。这也正是该页面后来按任务拆分而不是保持整篇的原因。

**加入全文搜索索引。** 暂缓，而非否决。站点只有 23 个静态页面，分组侧栏足以覆盖；搜索需要客户端索引，以及决定在哪里构建。本次改动不排除它。

**先把指南留作一页，以后再拆。** 否决：拆分正是让页面可被链接的原因，放在同一次改动里只需评审一遍内容迁移，而不是两遍。

## Consequences

站点从此是完整的用户文档，而不只是入口：共 23 个页面，其中 18 个是双语指南（九对）。改动 `docs/user/` 会在下一次推送到 `main` 时发布，指南页与站点其余部分共享同一套导航。

把一个页面拆成七个带来一种新的静默失败：不在 `NAV_ORDER` 里的文件渲染不到任何地方，也不报任何错。`docs-site/scripts/check-guide.mjs` 堵住它。该脚本把磁盘上的文件与指南库对照，在页面未路由、未分组、未在 `SECTIONS` 中命名、缺少对应语言、与对应语言行数不等，或缺少 `**Guide:**` 行时判失败；`NAV_ORDER` 指向不存在的文件时同样判失败，因此拼写错误无法进入构建。

链接改写是最脆弱的一环。它是对渲染后 HTML 的字符串改写，不是链接图，因此无法区分「该改写」与「不该动」的链接。`docs/user/` 之外的新链接目标会自动改写为 GitHub 地址，因此错误目标表现为 GitHub 上的 404，而不是站点路由断裂。

`docs-site/scripts/check-links.mjs` 负责守住这一点。它读取构建产物，把每条站内路由、锚点与资源引用逐一解析到实际产出的文件与 id，并对本应被改写却仍是相对路径的链接直接判失败。`docs-pages.yml` 在构建之后运行它，因此断链无法上线。该检查双向验证过：当前内容下 132 条站内链接、6 条锚点、11 条资源引用全部解析成功；注入的四类故障（页面缺失、锚点缺失、相对路径、未改写的 Markdown 链接）都会让运行以退出码 1 失败。

指南继续遵守 [docs/AGENTS.md](../../../../docs/AGENTS.md) 的双语配对规则：一中一英两个文件同次编辑、行数相同。该规则按对生效，因此拆分之后依然成立：七个新对的行数各自相等，两个既有对也相等。站点渲染这对文件并互相链接，因此缺少对应语言会直接表现为缺少语言切换。

本记录延续[面向 C 端的文档分层](2026-10-10-consumer-first-documentation-tiers.md)：该记录把兼容性参考移入站点，并让站点成为完整文档入口。其决策依然有效，本记录让站点直接渲染指南而不是外链。

## 吞掉源文件的忽略规则

根 `.gitignore` 里有一条裸 `lib/`。在 gitignore 语法中，不含斜杠的模式会在任意层级匹配，因此它同样匹配了 `docs-site/src/lib/`。本次改动的第一个提交于是交付了一个 import `../../lib/guide` 的模板，而被 import 的模块并不在提交里；全新检出将无法构建。

两处修复都在本次改动内完成。辅助模块改放到 `docs-site/src/guide/guide.ts`，绕开该模式；`.gitignore` 与 `.prettierignore` 中的 `/lib/` 把规则锚定到它本来针对的构建产物，嵌套的 `src/lib/` 不会再消失。已验证：根目录的 `lib/probe.js` 仍被忽略，`docs-site/src/lib/probe.ts` 现在可以提交，`client/*.js` 构建产物仍被忽略。

对 `node_modules`、`lib`、`client` 之外的 `*.ts`、`*.tsx`、`*.mjs`、`*.astro`、`*.md` 做了全仓扫描，未发现其它被忽略的源文件。剩余被忽略的路径都是工具状态（`.mnemon/`、`AGENTS.local.md`）与 Astro 的 `.astro/` 缓存。

## 站点自己的类型检查：起初什么都没读

四个根 `tsconfig` 项目都不包含 `.astro` 文件，eslint 只跑 `index.ts packages tests`。没有任何东西读取站点的模板，因此 `docs-site/package.json` 声明了 `@astrojs/check`，却没有脚本或工作流步骤使用它。

补上 `docs-site/tsconfig.json`（继承 `astro/tsconfigs/strict`）与 `check` 脚本后，它才成为真正的门禁。没有 `tsconfig` 时，即使注入 frontmatter 类型错误，该命令仍对 12 个文件报告 0 个错误；有了它，同样的注入会让运行失败。基线随后暴露出三处真实错误与一个未使用变量，全部在本次改动自己的代码里：`entry.filePath`、`entry.body`、`entry.rendered` 在集合类型中都是可选的。页面在这三者任一缺失时直接抛错，因为用缺失字段拼出的路由或空页面比构建失败更糟。

`pnpm --dir docs-site run check` 在 12 个文件上以 0 错误、0 警告、0 提示通过。

三个步骤在两个工作流中运行。`docs-pages.yml` 在推送到 `main` 时于部署前运行它们；`quality.yml` 新增 `Docs site` 作业，在每次推送与拉取请求上运行同样三步，因为 `docs-pages.yml` 只在 `main` 上运行：缺了这个作业，损坏站点的改动会通过审查并在合并后失败。

## 落在页面后面的 sitemap

`public/sitemap.xml` 是手工维护的，只列了四个 URL。本次改动新增七条指南路由却没有动它，因此已部署的 sitemap 将只宣传全站的三分之一。缺陷在于手工维护本身，而不是这一次的遗漏。

`docs-site/scripts/generate-sitemap.mjs` 现在根据产出的 `index.html` 生成 `dist/sitemap.xml`，由 `build` 脚本调用，静态文件已删除。`robots.txt` 仍指向同一地址，该地址现在由构建产出。文件名不是 `index.html` 的页面不会进入 sitemap，因此 `public/` 里的 Google 验证令牌被正确排除。

双向验证过：当前构建写出 11 个 URL，覆盖全部内容页；在 `dist/` 下新增一个页面无需修改脚本就会出现在 sitemap 中，移除并重新生成后消失；构建缺失时以退出码 2 失败，而不是写出空 sitemap。

## Testing

`pnpm --dir docs-site run build` 从仓库根目录构建 23 个页面，这正是 `docs-pages.yml` 执行的命令。产物包含七个任务页、`/docs/agent-roles/`、`/docs/layout-coverage/` 及各自的 `/docs/zh/` 对应页面。

拆分是经过证明无损的，而不是被信任的。旧 223 行那一对的每一条非标题内容行都出现在新页面中，只有两处已说明的例外：重复的第 9 行，以及随容器消失的两个容器标题。两种语言各自独立核对过，每个新对的行数相同。

`pnpm --dir docs-site run check` 在 12 个文件上报告 0 错误、0 警告、0 提示，并已验证其有效：注入 frontmatter 类型错误会让它失败，而在没有 `docs-site/tsconfig.json` 时同样的注入却通过，这正是该配置属于本次改动的原因。

`pnpm --dir docs-site run check:links` 在该产物上通过：24 个页面中的 559 条站内链接、2 条同页锚点与 23 条资源引用全部解析成功。其失败路径通过向构建副本注入四类故障加以证明：页面缺失、锚点缺失、相对路径、未改写的 Markdown 链接都会产生 `BROKEN` 行并以退出码 1 结束。该检查在拆分后抓出四条被拆断的真实跨页锚点——`settings` 仍指向已迁走的 `#project-layouts` 与 `#translation`——任何一条进入部署之前就被拦下。

`pnpm --dir docs-site run check:guide` 在 18 个文件、九对页面通过。其失败路径用三种方式证明：未列入的页面、行数不等的配对、缺少对应语言，各自以退出码 1 结束。

两份 README 与站点自身页面指向的每个 URL 都对照构建产物解析过：14 个不同目标全部存在，包括两个中文锚点。根套件在 Node 24 上保持 213 个文件、2048 个测试全绿。
