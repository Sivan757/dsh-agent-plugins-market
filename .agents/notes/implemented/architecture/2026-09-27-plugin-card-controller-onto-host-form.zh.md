# Agent Note：插件设置卡片控制器退役到宿主 settings-form 模型

状态：已实现

## 问题

`plugins.item` 设置卡片曾由一个手写控制器驱动（`src/client/features/settings-card/plugin-card-controller.ts`，348 行）：逐字段暂存加显式保存、服务器快照在编辑期间变动时的修订围栏、保存失败保留草稿、unset 即删除字段。它在 2026-09-13 诞生，因为当时已发布包只有 `ConfigForm` scope 服务与原语原子——没有表单模型——卡片只能照契约重建。凭证编辑器（`McpCredentialEditor.tsx`，写只进流程）重复了其中一部分建模。

rc.2 拿掉了这个前提：`@deepseek-ai/dsh-client-ui-primitives` 已从公开 index 发布 settings-form 组——`SettingsFormModel`、`SettingsFieldSpec`、`settingsNumberField`/`settingsTextField` 工厂、`SettingsForm`/`SettingsFormShell`/`SettingsFormActions`、以及 `SettingsSecretField`/`SettingsValueField`——且模型逐条覆盖同样语义：暂存编辑、修订围栏保存、失败保留草稿、unset 复位。维护已发布模型的私有孪生品正是复用规则禁止的漂移。

## 决策

控制器已退役到宿主模型。`src/client/features/settings-card/market-card-form.ts` 把市场的 `ConfigForm` scope 绑定到 `SettingsFormModel`，每个字段一条自定义 `SettingsFieldSpec`——卡片编辑四个布尔与 `downloadRegion` 枚举，没有一个是文本——所以每条 spec 的草稿文本就是值的线格式（`true`/`false`、区域词），不可解析的草稿挡住保存。page 视图渲染在宿主 `SettingsForm` 框架内：只读提示、保存控件、失败回显都是框架的；市场只保留自己的行。布尔走宿主 `Switch` 原子、区域走宿主 `SegmentedControl` 原子，都接到模型的 `edit`/`resetField`；带复位的「已自定义」徽标原样保留。宿主客户端探针仍是浏览器本地知识，随投影走；兼容模式守卫（关掉 `mcpEnhanced` 而宿主客户端缺失）折进投影的 `invalid`，与之前一样挡住保存。`McpCredentialEditor.tsx` 由 `McpCredentialFields.tsx` 取代，控件即 `SettingsSecretField`，写一次保证即 `SettingsSecretSpec.write`——字面量只过线一次，绝不回到状态。保存进行中的暂存编辑会被拒绝，因此保存成功清空暂存表时不会抹掉更新的编辑。

## 后果

- **离开页面即丢弃暂存。** 宿主框架在 unmount 时调用 `onDiscard` 且自身不提供放弃控件；卡片采纳这一点作为该 slot 的标准，仅在存在编辑时渲染自己的放弃入口。
- **summary 视图跟随 shell。** 未被服务的命名空间现在连一句话简介也隐藏，与框架的 unavailable 行一致，不再是旧的无条件渲染。
- 控制器与凭证编辑器的复用账目行已翻 `use-host`，引用 `SettingsFormModel` 与 `SettingsSecretField`。
- 布尔/枚举字段的自定义 spec 是形态上唯一的有意偏离：已发布工厂面向文本与数字输入，市场绑定自带两个 spec 构造器，而不是把控件硬塞进文本框。
- 2026-09-13 的 settings-and-card note 仍是 slot 座与 scope 服务的锚点；本 note 只覆盖控制器退役。

## 已考虑的替代

- 只采用 `SettingsSecretField`、保留控制器。否决：secret 字段绑定 `SettingsFormModel` 生命周期、不能独立使用，这是同一次迁移的全有或全无半边。
- 等 `ConfigField` 进公开 index。否决：模型组今天就可 import 且覆盖卡片字段；`ConfigField` 是原语层的东西，只值得在 spike 失败时再评估一次。
