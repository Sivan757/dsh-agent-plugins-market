# Agent Note: 通过入口 Config schema 投影插件设置

Status: implemented

## Problem

插件此前在运行时注册设置命名空间：`apply` 注入宿主 `settings` 服务并调用 `settings.register(ns, schema)`。在 dsh 0.1.7 上这个调用已不存在——设置服务（`SettingsForms`）把每个已加载条目的 `Config` schema 投影成以 profile 条目 id 为键的命名空间，没有 `Config` 导出的条目就没有命名空间。于是市场从 `settings/describe` 里消失：插件页的 `configForms.whileServed` 永远不触发，配置条目不出现，「项目布局 / 下载区域 / MCP 增强」在新界面上无从 reach。

## Decision

入口导出 schemastery `Config` schema：五个市场设置声明为 volatile（宿主每次变更原地更新其引用，并发出 `loader/volatile-update`），启动字段保持 plain。`MarketSettingsNamespace` 不再注入任何服务——它读取 volatile 引用，并从 `loader/volatile-update` 监听里重新同步运行时反应（MCP 后端、项目布局、反馈工具、源更新器）。旧的 `setBackend` HTTP 路由保留为「接受但不写」：值现居宿主设置文档，从插件页编辑。

命名空间 id 保持 `dsh-agent-plugins-market`：设置服务以 profile 条目 id 作为命名空间键，bundle patch 以这个名字插入条目。

## Alternatives considered

- **继续对旧宿主做运行时注册。** 否决：`settings.register` 在 0.1.7 已移除，命名空间在运行线上永远无法出现。
- **把五个设置声明为非 volatile config。** 否决：每次开关切换都会拆掉并重载整个插件 fiber，为宿主可以原地应用的开关丢掉活跃 MCP 挂载与会话状态。
- **用手写的 describe 端点供卡。** 否决：那会分叉宿主的设置文档、revision fencing 与脱敏，这些本来就归宿主设置服务所有。

## Consequences

- 命名空间与所有宿主侧命名空间同一生命周期：只在条目 fiber 活跃时出现在 `settings/describe`，其 revision fencing 由设置服务自持。
- 宿主原地写入 volatile 值，开关应用无需卸载；插件在 `loader/volatile-update` 上重读引用完成反应。
- cordis 移到宿主实际运行的 ~4.0.4 线，schemastery 到 ^3.18.4；cosmokit 成为直接 dev 依赖，因为入口导出的 Config 类型引用了它。

## Related decisions

命名空间 id 与 volatile-update 反应取代 0.8.0 入口使用的运行时注册——0.1.7 的设置服务已不再暴露它。
