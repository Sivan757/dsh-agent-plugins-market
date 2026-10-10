# Agent Note：配置父级资源 id 不再落盘

Status: implemented

## Problem

扩展预设携带了不可见的配置父级资源 id。用户 hooks 配置（`market:@user-hooks/user-hooks`）与每个项目原生布局套件（`market:native/<dir>-native`）在任何界面都没有卡片：资源列表会过滤带 `configuration` 分类的行。但勾选它们的任一子项都会把父级 id 写进选择集，捕获路径也会写入——`initialSelection` 收集所有可用且未被全局关闭的行，配置父级恰好通过该过滤。从未碰过项目资源的用户，每个新会话的默认选择里也带着 `market:native/*`；复制预设还会把这个 id 带到别的工作区。

## Decision

卡片无法渲染的父级 id 一律不落盘。契约现在枚举配置父级 id（`CONFIGURATION_PARENT_IDS`），并在每个持久化点剔除：`captureExtensionSelection`、预设库的 create 与 update、预设传输的两个方向。复制与粘贴的预设只含子项 id；仍带显式父级 id 的旧数据保持可读，并在下一次保存或复制时自然脱落。

运行时改为从选中的子项派生配置父级的授权：

- `extensionResourceEnabled` 在任一所属子项被选中时授予配置父级行；配置父级的子项只凭自身 id 授予。
- `projectExtensionSuites` 经 `suiteOwnsResourceId` 判定套件入选，接受显式父级 id 或任一所属子项 id；`session-extension.ts` 里 `@user-mcp` 的运行时派生保留，并从此有了同族规则而非孤例。
- `ExtensionRuntime.selected` 为完全不发布行的配置父级 id 派生授权——hooks 桥与挂载过滤按裸套件 id 寻址时走的正是这条路径。
- 清单不再在候选与 legacy 两条循环里发布 `@user-hooks` 的 market 行，与 `@user-mcp` 的既有做法对齐。
- 客户端 `toggleResource` 不再写入父级 id，`resourceSelected` 只凭子项自身 id 判定，管理窗口的草稿种子与服务端捕获一致。

捕获保留一处细节：`initialSelection` 的护卫集合必须保留父级 id，因为子项只有在集合里见到父级时才会被保留；仅发布的最终选择剔除它们。

## Alternatives considered

- **彻底不再发布配置父级行**：`parents` 可用性映射与 owner 标注仍消费这些行，而旧数据兼容无论如何都需要派生逻辑，最小切口保留行作内部簿记。
- **收紧 `ENTRY_ID` 文法**拒绝配置父级 id：一个 id 是否配置父级取决于数据而非词法，且文法是旧数据读取的兼容边界。
- **一次性迁移旧预设与会话快照**：运行时同时接受两种形态，复制或保存即脱落的 id 不值得一次迁移。

## Consequences

预设、副本与新会话的捕获选择只含某处卡片可渲染的 id。代价是多出一套需要理解的授权形态：授权、投影与运行时门各自从子项派生配置父级，hooks 桥消费的是派生形态。配置套件不存在“父级开、子项全关”的语义——空投影不挂载任何东西，这与此前不可见父级无法单独开关的行为一致。

## Testing

`tests/extension-configuration-parents.test.ts` 钉住 id 枚举、传输与捕获剔除、两种派生授权形态、真实套件契约不变、仅子项投影。`tests/extension-suite-inventory.test.ts` 现在断言 hooks 套件无论有效或被拒都不发布 market 行。scoped-effects 验收仍经公开路由仅用子项 id 跑通一条被授予的用户 hook。
