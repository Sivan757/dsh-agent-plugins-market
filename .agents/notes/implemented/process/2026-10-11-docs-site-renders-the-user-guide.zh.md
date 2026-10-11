# Agent Note: 文档站直接渲染使用指南，而不是复述它

Status: implemented

## Problem

`docs-site/` 此前只有四个页面：首页、安装指南、兼容插件参考与常见问题。任何需要用户指南细节的地方，都外链到 `github.com` 上的 `blob/main/docs/user/usage.md`，因此读者一到站点就被送走。站点只是顶着文档站地址的门面页。

指南本身每种语言 223 行（`docs/user/usage.md`、`docs/user/usage.zh.md`），覆盖安装、来源、存储、MCP、LSP、hooks、翻译、设置与操作遮罩。另外两组成对页面 `agent-roles` 与 `layout-coverage` 在站点上同样只能跳 GitHub。

## Decision

站点直接渲染指南文件。内容集合（`docs-site/src/content.config.ts`）以 `../docs/user` 为根做 glob，`docs-site/src/pages/docs/[...slug].astro` 渲染每个条目。仓库仍是唯一真源：改动 `docs/user/` 会同时更新 GitHub 视图与已发布站点，不存在会漂移的第二份副本。

路由取自源文件名，而不是集合 id。glob loader 会把 `entry.id` 转成 slug 并去掉点号（`usage.zh` 变成 `usagezh`），因此 `guideSlug` 改为读取 `entry.filePath`。英文页位于 `/docs/<名称>/`，中文页位于 `/docs/zh/<名称>/`，语言切换因此有了真实落点：每个指南页都链到紧邻的对应语言页。

链接在迁移后仍然可用。渲染出的指南保留作者写的 Markdown 链接，`rewriteLinks` 逐一映射：目标仍留在 `docs/user/` 内的转为站点路由，其余（README、`schemas/`、源码、测试）转为 GitHub 的 `blob/main/` 地址。站点不发布这些文件，因此不假装发布。

仓库根目录通过从工作目录向上查找 `docs/user/usage.md` 确定。用 `import.meta.url` 推导路径会在 Astro 把模块打包进 `dist/.prerender/` 后失效，首次构建已经证实这一点。该辅助模块位于 `docs-site/src/guide/guide.ts`，刻意不放 `lib/` 目录：原因见[后果](#consequences)一节。

站点新增一组指南页、`/docs/` 索引、列出同语言兄弟页的侧栏、语言切换，以及共享导航中的「使用指南」入口。既有页面不再为指南细节外链 GitHub。

`docs-pages.yml` 现在同时监听 `docs/user/**` 与 `docs-site/**`。此前改动指南不会重建已部署站点，站点之所以用 GitHub 绝对地址链接指南，正是因为这一点。

## Alternatives considered

**把指南复制成 `docs-site/` 下的 Astro 页面。** 否决：双语 223 行页面出现两份副本就会漂移，而「`docs/user/` 页面成对编辑」这条仓库规则也将不再是全部事实。站点也无法再证明它发布的内容就是仓库交付的内容。

**把指南作为独立 Astro 内容目录，由构建步骤从 `docs/user/` 同步。** 否决：同步步骤就是第二个真源，且存在过期的窗口，还需要自己的测试。loader 直接读取仓库文件。

**安装 `@astrojs/markdown-remark` 以通过 rehype 插件改写链接。** 否决，因为没有必要。Astro 7 用自己的处理器渲染内容集合，渲染结果中的 `href` 是普通属性，做定向字符串改写即可，无需新依赖。新依赖需要仓库规则要求的理由，而这一条不带来任何收益。

**保留站点的 GitHub 外链，把指南做成一个长页面。** 否决：侧栏、语言切换与逐页 head 元数据正是让指南在站点内可导航的东西。每种语言一个 223 行的长页面读起来像倾倒内容，读者也无法链接到其中某一节。

**加入全文搜索索引。** 暂缓，而非否决。站点只有 11 个静态页面，侧栏足以覆盖；搜索需要客户端索引，以及决定在哪里构建。本次改动不排除它。

## Consequences

站点从此是完整的用户文档，而不只是入口：共 11 个页面，其中 6 个是双语指南。改动 `docs/user/` 会在下一次推送到 `main` 时发布，指南页与站点其余部分共享同一套导航。

链接改写是最脆弱的一环。它是对渲染后 HTML 的字符串改写，不是链接图，因此无法区分「该改写」与「不该动」的链接。`docs/user/` 之外的新链接目标会自动改写为 GitHub 地址，因此错误目标表现为 GitHub 上的 404，而不是站点路由断裂。

`docs-site/scripts/check-links.mjs` 负责守住这一点。它读取构建产物，把每条站内路由、锚点与资源引用逐一解析到实际产出的文件与 id，并对本应被改写却仍是相对路径的链接直接判失败。`docs-pages.yml` 在构建之后运行它，因此断链无法上线。该检查双向验证过：当前内容下 132 条站内链接、6 条锚点、11 条资源引用全部解析成功；注入的四类故障（页面缺失、锚点缺失、相对路径、未改写的 Markdown 链接）都会让运行以退出码 1 失败。

指南继续遵守 [docs/AGENTS.md](../../docs/AGENTS.md) 的双语配对规则：一中一英两个文件同次编辑、行数相同。站点渲染这对文件并互相链接，因此缺少对应语言会直接表现为缺少语言切换。

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

`pnpm --dir docs-site exec astro build` 从仓库根目录构建 11 个页面，这正是 `docs-pages.yml` 执行的命令。产物包含 `/docs/usage/`、`/docs/agent-roles/`、`/docs/layout-coverage/` 及其 `/docs/zh/` 对应页面。

渲染结构与 Markdown 源逐项比对四个页面：标题数量完全一致（`usage.md` 为 8 个 h2、8 个 h3），每个代码围栏对应一个 `<pre>` 块。

`pnpm --dir docs-site run check` 在 12 个文件上报告 0 错误、0 警告、0 提示，并已验证其有效：注入 frontmatter 类型错误会让它失败，而在没有 `docs-site/tsconfig.json` 时同样的注入却通过，这正是该配置属于本次改动的原因。

`pnpm --dir docs-site run check:links` 在该产物上通过。其失败路径通过向构建副本注入四类故障加以证明：页面缺失、锚点缺失、相对路径、未改写的 Markdown 链接都会产生 `BROKEN` 行并以退出码 1 结束。根套件在 Node 24 上保持 213 个文件、2048 个测试全绿。
