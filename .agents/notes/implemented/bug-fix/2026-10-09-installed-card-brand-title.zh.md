# Agent Note: 已安装卡片显示本地化品牌名

Status: implemented

## Problem

已安装卡片在每个人都能看到插件名的地方显示 npm 包名 `dsh-agent-plugins-market`。卡片是插件页里读者第一眼看到的内容，因此这一行读起来像构建产物而不是产品，文档写的入口（`插件 → 已安装 → Agent 扩展`）也与屏幕不一致。

## Decision

两个导出的语言资源都携带 `meta.title`：`locale/en.json` 为 `Agent Plugins`，`locale/zh.json` 为 `Agent 扩展`。已发布宿主渲染包卡片时优先取 `meta.title`，缺失才回退到包名，因此已安装卡片现在显示产品名，并跟随界面语言。

技术标识仍只保留一处：卡片下方的包详情页继续在 `data-plugin-name` 行打印 `dsh-agent-plugins-market`，该 bundle 自身行的行 id 与模块名不变。卡片标题、启停开关标签、打开详情标签与卸载确认都使用同一个本地化标题。

本决策反转[Agent 扩展双语品牌与插件内设置](../feature/2026-10-04-agent-plugins-branding.zh.md)中移除 `meta.title` 的决定。该笔记的其余内容仍然有效：图标资源、`plugins.bundle.config` 绑定、介绍资源与 npm 标识。

## Alternatives considered

**保持只有介绍的元信息。** 这是此前的状态。其理由是宿主把行渲染为标题加上任何与之不同的技术 id，因此品牌标题会产生两行 id。那条理由适用于包下面的*行*列表，不适用于包卡片本身，而它让卡片显示了包名。恢复标题修好了卡片；行列表仍保留自己的 id。

**在 `package.json` 里缩短包名。** 已发布的名称就是安装标识与设置命名空间。改名会破坏已有 profile、patch 文件与设置键。

**改 `cordis.patch.yml` 里的行 id。** 行 id 是配置键（`<包名>#<行 id>`）与 profile 覆盖地址。改它会让所有已保存设置失联，而卡片标题并不读行 id，因此没有任何可见收益。

## Consequences

- 已安装卡片、其开关标签与卸载确认按界面语言显示 `Agent 扩展` 或 `Agent Plugins`。两种语言都由 `tests/package-branding.test.ts` 固定。
- 包详情页继续打印 npm 包名，因此卡片与详情页各显示一次品牌名与技术标识。
- 不引入运行时依赖、设置存储或 profile 改动。宿主在不执行插件代码的情况下读取随包语言资源，因此插件停用时标题仍可用。
- 包详情页里 bundle 自身那一行会重新打印技术标识。行 id 与模块名都是 `dsh-agent-plugins-market`，而宿主会打印每一个与标题不同的值，因此该行在品牌标题下方把这串名字显示两次。改行 id 可以避免，但行 id 就是配置键（`<包名>#<行 id>`）与 profile 覆盖地址，改名会让已保存设置失联。这一行重复是品牌标题被接受的代价。
- 在插件页搜索 npm 包名的读者仍能找到该包：卡片自己的页面在行列表里带有它。

## Testing

`tests/package-branding.test.ts` 断言两种语言的 `meta.title` 等于本地化 `nav` 标签，`meta.description` 等于 `marketCardDesc`。已用桌面 profile 运行安装版宿主校验器，返回 `{"en":"Agent Plugins","zh":"Agent 扩展"}` 且没有元信息错误。
