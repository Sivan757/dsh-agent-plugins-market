# Agent Note: Agent 扩展双语品牌与插件内设置

Status: implemented

## Problem

插件需要区别于技术 npm 标识的用户可读名称与图标。将设置注册为 plugins.item 会把第三方扩展放在官方插件旁，并产生第二个配置入口。

## Decision

npm 标识保持 dsh-agent-plugins-market。导出的语言资源只携带 meta.description，不含 meta.title：宿主在标题缺失时回退到包名，组件行因此只显示一次身份，而不是品牌名旁边并列两行技术名。品牌名保留在我们自己的界面上——工作区页签、设置分区标签与 README。package.json 的 icon 指向随包发布的 256px PNG：它由用户提供的图案等比缩放，保留透明背景，并低于宿主 256 KiB 限制。发布文件列表包含双语资源与图片。

既有 SettingsForm 绑定注册到 plugins.bundle.config，以 npm 包名为 key，不再注册 plugins.item。配置显示在已安装插件的详情页内。设置工作区仍可通过本地化品牌名称进入；标签 thunk 与宿主语言渲染器无需重新注册即可更新。命名空间、持久化键、保存/放弃行为与技术标识保持不变。

本决策部分取代[设置与卡片复用](../architecture/2026-09-13-settings-and-card-ride-the-host.zh.md)中的入口位置。[宿主表单模型](../architecture/2026-09-27-plugin-card-controller-onto-host-form.zh.md)继续持有表单状态与持久化行为；其中的官方卡片摘要不用于插件配置槽。

## Alternatives considered

**把翻译名称写入 dsh.meta 或模块导出。** 已发布 rc.2 宿主在不执行插件代码的情况下读取导出的语言 JSON。自行发明清单字段只会静默退回技术包名。

**保留独立 plugins.item 卡片。** 已发布槽契约将该列表保留给官方设置条目。按包名分派的 bundle 槽可把相同表单放到已安装插件自身页面。

**嵌入原始分辨率图片。** 用户提供的 PNG 超过宿主图标大小限制。缩放原图保留透明度，将体积降到 46,744 字节而不改变设计。

## Consequences

没有新增运行时依赖或设置存储。宿主读取随包资源，因此插件停用时元信息仍可显示。测试固定语言资源的描述导出、标题缺失、图片尺寸与大小、技术标识、槽归属及绑定清理。独立 DSH profile 已验证已安装分类、图片加载、内嵌设置，以及中文切换英文时介绍和设置文案即时更新。
