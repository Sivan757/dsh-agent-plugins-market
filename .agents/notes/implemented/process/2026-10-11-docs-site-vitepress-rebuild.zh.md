# Agent Note: 文档站重建于 VitePress 2

Status: implemented

## Problem

Astro 7 站点需要三个自研机制，而静态文档框架本就内置：渲染后 HTML 上的链接改写器、构建产物上的死链检查器，以及 sitemap 生成器。它的模板用正则读取指南标题，类型检查（`astro check`）也只读站点自己的文件。而在上游，Astro 7 是一个完整的 Web 框架；这个站点只是九对双语 markdown 加四个落地页。两者的落差正是自研代码填补的部分。

VitePress 2 发布的正是这一类站点，且上述机制内置：内部死链让构建失败，sitemap 是一行配置，暗色模式与搜索是主题特性，markdown 就是它优化的写作格式。

## Decision

站点是以 `docs-site/.vitepress/config.mts` 为根（`srcDir: '.'`）的 VitePress 2.0.0-alpha.20 工程。用户明确要求 2.0 线，该线尚在 alpha；版本采用精确 pin，未来的 alpha 不会悄悄破坏构建。

[文档站直接渲染使用指南](2026-10-11-docs-site-renders-the-user-guide.md) 的决策保持不变：`docs/user/` 仍是唯一写作真源，页面以行数相等的英中成对发布，每页保留 `**Guide:**` 兄弟链接行。本次变更替换的是该记录的渲染机制，而不是它的决策。

构建是五步链（`docs-site/package.json`）：

1. `copy-guide.mjs` 把 `docs/user/*.md` 复制进 `guide/`，同时改写每个链接：指南页目标变为站点路由（`/docs/<name>`、`/docs/zh/<name>`），其余变为 GitHub 的 `blob/main/` 地址。改写逻辑从「渲染后 HTML 字符串替换」前移到复制步骤，直接作用于 Markdown 源文本，出错即响亮失败。
2. `vitepress build` 按配置里的 `rewrites` 映射渲染副本，保持 Astro 时期的 URL。
3. `directories.mjs` 把每个产物 `<route>.html` 移入 `<route>/index.html`。GitHub Pages 只有在这种目录布局下才能解析 README 深链的尾斜杠地址；`cleanUrls: true` 让内部链接去掉后缀，从而在移动后仍然可达。`404.html` 与搜索引擎验证文件保持扁平，因为两者只在站点根有效。
4. `generate-sitemap.mjs` 按最终产物写 `sitemap.xml`，使用尾斜杠地址。VitePress 内置 sitemap 从路由记录推导，产出的是带 `index.html` 后缀的集合；从产物文件推导还能把验证文件排除在外。
5. `check-links.mjs` 解析产物中的每个 href：路由与锚点对照产物文件与 id。

语言切换由 `copy-guide.mjs` 以静态 HTML 注入到副本的第一个标题之后。VitePress 2 在预渲染时，默认主题的布局 slot 拿不到页面标识（`useRoute()` 为空，SSG 产物中 `page.relativePath` 是空字符串），slot 组件无从得知自己位于哪个页面。而切换的对端地址只由文件名决定，复制步骤正是唯一掌握这一信息的地方。

`docs/index.md` 的指南索引用 `import.meta.glob` 从副本文件读取标题，落地页因此不会与指南页面漂移。`.vitepress/guide.ts` 承载 `GUIDES`（路由表，即原 `NAV_ORDER`）与 `SECTIONS`（侧栏分组），`check-guide.mjs` 从该文件读取两者。

Astro 源码（`src/`、`astro.config.mjs`）已删除。`check:guide` 增加第五项断言——构建副本必须等于改写后的源文，过期副本无法过关——GitHub Pages 工作流的步骤缩减为 `check:guide`、`build`、`check:links`。

## Alternatives considered

**留在 Astro 7。** 否决：三个自研机制将成为永久维护负担，而框架的重量对一个静态站点毫无收益。尤其是「渲染后 HTML 改写」永远无法校验锚点，这正是 `check-links.mjs` 至今存在的原因。

**VitePress 1.6.4（最新稳定版）。** 因用户明确要求 2.0 线而否决。alpha 被精确 pin，CI 构建不受时间影响，上游发布新的 alpha 也不会未经许可进入锁文件。

**用服务端重定向实现目录式地址。** 否决：GitHub Pages 不提供重定向配置。产物必须是物理的 `<route>/index.html`。

**语言切换做成主题 slot 组件。** 两次探针证实了 SSG 缺口后被否决：slot 触发了，但预渲染时所有页面标识 API 都是空的，组件在交付的 HTML 中什么都没渲染。静态注入可用 grep 验证。

**保留 Astro 时期的 `astro check` 步骤。** 否决：它类型检查的是 `.astro` 模板，而模板已不存在。剩余的 TypeScript（`guide.ts` 与配置）由 VitePress 自身的构建间接读取，为四个文件再建一个 tsconfig 毫无收益。

## Consequences

自研面收缩一个脚本：sitemap 生成器、链接改写器（并入复制步骤）与 Astro 模板类型检查消失；`directories.mjs` 是新增。暗色模式、代码复制按钮与移动端导航成为主题特性，旧站点的 CSS 不再需要手工近似。

指南页面改经 VitePress 的 markdown 管线渲染：英文标题的锚点 slug 与 Astro 锚点一致，README 深链的中文锚点（`#其他安装方式`、`#存储与发现`）原样保留。全部十四个 README 深链目标都在最终产物中解析通过。

指南页内的锚点现在由 `check-links.mjs) 对照产物 id 校验，补上了 HTML 字符串改写时期的校验缺口。

alpha pin 是一项长期成本：VitePress 2 转稳后，pin 随之更新并重新验证构建。`pnpm-workspace.yaml` 的 `minimumReleaseAgeExclude` 未列入 `vitepress@2.0.0-alpha.20`，pnpm 的发布年龄窗口本就把它当作声明范围内的一员；精确 pin 正是让升级保持刻意的原因。

`guide/` 是 gitignore 的构建态，与 `dist/` 同类。缺失时 `check-guide.mjs` 会给出明确报错，因此全新克隆必须先跑构建链再做检查——脚本的编排本就如此。

## Testing

`pnpm --dir docs-site run check:guide` 通过：九对 18 个文件，含新增的副本同步断言（过期副本会失败）。

`pnpm --dir docs-site run build` 产出 23 个页面加 `404.html` 与验证文件：扁平转目录移动 21 个、保留 2 个，sitemap 以尾斜杠形式列出 22 个 URL。每轮验证前都从删除 `dist/` 起做了干净构建。

`pnpm --dir docs-site run check:links` 通过：25 个页面、541 条内部链接、113 个锚点、142 处资源引用、125 条外链全部解析。锚点校验由含两个中文锚点的 README 集合实际锻炼。

全部十四个 README 深链目标（`README.md` 与 `README.zh.md`）用临时探针脚本对产物解析；包括两个中文锚点在内的每个目标都存在。

构建站点用 `vitepress preview` 启动并在 Chrome 中检查：首页 hero 与特性网格正常渲染，指南页侧栏分组与高亮正常，注入的语言切换显示当前语言并可跳对端，默认即暗色模式，代码块带复制按钮。以上均有截图确认。

`pnpm --dir docs-site run typecheck`（对 `guide.ts` 与配置的 `tsc --noEmit`）通过。

## Related

扩展 [文档站直接渲染使用指南](2026-10-11-docs-site-renders-the-user-guide.zh.md)：本记录保留其决策、替换其机制。
