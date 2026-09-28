# Agent Note：插件设置卡片控制器退役到宿主 settings-form 模型

状态：提案

## 问题

`plugins.item` 设置卡片由一个手写控制器驱动（`src/client/features/settings-card/plugin-card-controller.ts`，348 行）：逐字段暂存加显式保存、服务器快照在编辑期间变动时的修订围栏、保存失败保留草稿、unset 即删除字段。它在 2026-09-13 诞生，因为当时已发布包只有 `ConfigForm` scope 服务与原语原子——没有表单模型——卡片只能照契约重建。凭证编辑器（`McpCredentialEditor.tsx`，写只进流程）重复了其中一部分建模。

rc.2 拿掉了这个前提：`@deepseek-ai/dsh-client-ui-primitives` 已从公开 index 发布 settings-form 组——`SettingsFormModel`、`SettingsFieldSpec`、`settingsNumberField`/`settingsTextField` 工厂、`SettingsForm`/`SettingsFormShell`/`SettingsFormActions`、以及 `SettingsSecretField`/`SettingsValueField`——且模型逐条覆盖同样语义：暂存编辑、修订围栏保存、失败保留草稿、unset 复位。维护已发布模型的私有孪生品正是复用规则禁止的漂移。

## 提案

分四步把控制器退役到宿主模型：

1. **语义 spike（scratch 分支）。** 用卡片的真实场景驱动 `SettingsFormModel`——暂存数字字段、对着已前移的服务器修订保存、强制保存失败、unset 字段——与控制器行为逐项对照。这一步是其余一切的门；对照本机样式规范里卡片表单规则的视觉契合也属于 spike。
2. **换页视图。** 卡片 page 视图改经 `SettingsForm`/`SettingsFormShell`/`SettingsFormActions` 渲染，字段规格用 `settings*Field` 工厂构建；summary 视图与 `plugins.item` inject 座（SnapshotStore 投影）不动。
3. **并掉凭证编辑器。** `McpCredentialEditor` 变为绑定模型的 `SettingsSecretField`，写只进保证经 `SettingsSecretSpec.write` 表达——值只过线一次，绝不回渲染。
4. **删除控制器**及其专属测试；wire 投影测试保留。

两个文件的复用账目行在落地变更里翻 `self-built` → `use-host`。

## 已考虑的替代

- 只采用 `SettingsSecretField`、保留控制器。否决：secret 字段绑定 `SettingsFormModel` 生命周期、不能独立使用，这是同一次迁移的全有或全无半边。
- 等 `ConfigField` 进公开 index。否决：模型组今天就可 import 且覆盖卡片字段；`ConfigField` 是原语层的东西，只值得在 spike 失败时再评估一次。

## 验收标准

- `pnpm run check:reuse` 显示两行 `use-host`，引用 `SettingsFormModel` 与 `SettingsSecretField`。
- 卡片行为保持：暂存加显式保存、修订围栏保存、保存失败保留草稿、unset 删除字段、凭证值恰好过线一次。
- 双语 UI 字符串继续走 `locales.ts`；不出现英文-only 面。
- `plugin-card-controller.ts` 删除；typecheck、lint、prettier、复用门禁与客户端构建全绿。

## 风险

- **视觉偏差。** 宿主表单的间距与控件形态可能不符合卡片表单标准；spike 在任何替换落地前裁决，不契合就是保留控制器并刷新 note 的理由，而不是分叉宿主样式的理由。
- **inject 座。** `plugins.item` 交给渲染器的是 SnapshotStore hook；宿主表单必须经这个座绑定，不能再起一个状态实例。做不到则迁移停在第一步并留下结论。
- **rc 线翻动。** 该组只比基线新一版；依赖对齐流程本就计价了这一点，复用门禁的 R2 规则会把上游改名变成当日信号。
