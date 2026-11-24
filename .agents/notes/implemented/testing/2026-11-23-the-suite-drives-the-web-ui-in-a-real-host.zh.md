# Agent Note: The suite drives the Web UI in a real host

Status: implemented

## Problem

仓库此前带着 302 个 Vitest 文件，分布在八个包的 test 目录里。它们钉住了扫描、路由、挂载、MCP 桥、翻译引擎与客户端渲染，这些层每次改动都要付 fixture 维护的代价。宿主 0.2.3-alpha.1 候选版随后移除了测试所依赖的契约：Cordis 4.2 只通过 `Context.root` 暴露根上下文，`@deepseek-ai/dsh-client-ui-primitives` 删掉了 `rankByName`，导出清理也带走了一批仅供测试的入口。本次改动的方向是删除测试用例，只围绕前端界面重建。

## Decision

- Vitest 体系整体移除：没有包的 test 目录，没有 `vitest.config.ts`，没有 `tsconfig.test*.json`，没有测试脚本，`devDependencies` 里也没有 `vitest`、`jsdom`、覆盖率工具或仅供测试的宿主镜像。属于那些测试的 fixture 一并删除。
- `e2e/` 下的一套 Playwright 用例在真实宿主里驱动插件的 Web UI。`e2e/host.mjs` 在 `node_modules/.cache/e2e` 下准备一个隔离的 `DSH_HOME`，安装钉在 `HOST_SUPPORT_FLOOR` 的宿主 CLI，安装链接本仓库的 profile，写入一个本地 fixture 源，然后启动 `dsh --profile market --no-open --port`。Playwright 以它为 web server；浏览器用机器上已装的 Chrome（`channel: 'chrome'`），同一时刻只有一个 worker，浏览器上下文 locale 为 `en-US`，被启动宿主的代理变量指向一个关闭的端口，让预置 Git 源快速失败，页面上只剩种子 fixture 的数据。宿主还拿到该 home 下的 `DSH_AGENTS_HOME`：`$DSH_AGENTS_HOME`（默认 `~/.agents`）是用户手写技能、快捷指令与 MCP 服务的地方，不覆盖它，开发者个人的资源就会出现在套件的页签上。
- 用例只断言读者看得见的东西：工作区页签行、市场刷新、搜索、状态筛选、网格/列表切换、套件详情、来源增删，以及安装/卸载与技能列表。`e2e/support/market.ts` 承担每个用例共享的宿主导航（设置、Agent 扩展）并关掉启动期的提示。
- 宿主基线在 `scripts/host-support-window.mjs`、`package.json` 与 `pnpm-workspace.yaml` 移到 `0.2.3-alpha.2`：支持区间 `>=0.2.3-alpha.2 <0.3.0-0`，dev 镜像取该基线，Cordis `~4.2.0-alpha.1`，schemastery `~3.20.0-alpha.1`，cosmokit `~1.10.0-alpha.1`。`scripts/check-host-alignment.mjs` 同时读取 `next` 与 `alpha` 两条 tag 并取较新的版本，因为 0.2.3 线的 alpha 发布到 `alpha` 时 `next` 仍停在 `0.2.2-rc.5`；`--channel` 仍可显式指定单条 tag。
- 随之而来的两处生产代码适配：MCP 桥用 `ctx[Context.root]` 读根上下文；技能菜单用本地的 `rankByName`（`packages/market-ui/src/ui/rank-by-name.ts`）排序，因为宿主不再导出该函数。
- CI 在 Linux 与 Windows 上用 Node `24.22.3` 运行这套用例，不再安装 Playwright 浏览器包。

## Alternatives considered

- **保留 Vitest 覆盖非 UI 层，再在旁边加 Playwright。** 否决：要求是删除重建，而两套栈会让删除本要消除的维护成本翻倍。
- **用下载的 Playwright Chromium 运行。** 否决：本环境可用的下载通道慢到不可用，而用例需要的是一个浏览器而不是特定构建；CI 镜像与开发机都已自带 Chrome。
- **通过插件 HTTP API 给用例准备市场数据。** 否决：直接写插件自己的 `state.json` 更省事，而且那本来就是宿主读取的持久化契约；用例仍只断言渲染出的界面。
- **把支持下限留在 `0.2.2-rc.5`。** 否决：按 semver 的预发布规则，`>=0.2.2-rc.5 <0.3.0-0` 匹配不到 `0.2.3-alpha.2`，而 alpha 又移除了插件用过的 API。

## Related

- [Resolve the alignment baseline from the prerelease candidate line](../process/2026-09-23-next-channel-baseline.md) 记录了更早的「只看 `next`」规则；本 Note 取代它的单 tag 默认，但把 `next` 保留为候选 tag 之一。

## Consequences

- 一条用例通过，意味着用户能在真实宿主里完成那个操作，包括市场周边宿主自己的设置页与插件页。
- 扫描、路由、挂载、MCP 桥、翻译引擎与 hook 事件表不再有自动化测试。它们改为在宿主里手工验证，推送前的证据表也这样写。
- 机器上第一次 `pnpm run test` 需要联网安装宿主 CLI 与一个 profile，之后缓存在 `node_modules/.cache/e2e`，后续启动只需数秒。宿主 engines 要求 Node `^24.22.3 || >=26.13.1`。
- desktop profile 链接本仓库时 app 仍跑 `0.2.2-rc.5`，而本插件现在要求 `0.2.3-alpha.2`。app 升到 alpha 线、或把 desktop profile 换回已发布的稳定包之后，链接的插件才恢复可用。
- 输入框的预设入口在这条宿主线上不渲染：宿主调用 `conversation.input.left` 这个位置时没有传 session id，于是 `PresetEntrySlot` 自己隐藏并告警一次。市场自己的设置面不受影响；要等宿主传入会话身份，入口才会出现。
