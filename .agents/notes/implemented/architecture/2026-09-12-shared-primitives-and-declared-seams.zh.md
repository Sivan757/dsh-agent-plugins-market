# Agent Note: 共享原语与显式分层接缝

Status: implemented

## Problem

三个结构性问题在绿灯之下积累了起来。

`src/application/catalog.ts` 是一个 1,260 行的类，同时拥有六类互不相关的职责：持久化状态与变更队列、扫描与快照缓存、来源获取、安装状态、MCP 与 LSP 用例，以及展示查询。它依赖七个构造后 setter 加一个公开可变字段注入，由 347 行 `apply()` 中十三处调用点分散接线，因此完整的依赖集合只能靠比对构造函数选项与 setter 名称推出来。它以值导入 `src/runtime/` 十六次，而 `docs/design/engineering-refactor-plan.md` 明确把该方向列为错误，两侧都没有任何门禁把关。

runtime 的五个挂载注册表按 surface 各实现了一遍同一套算法：串行化协调过程、挂载新出现的、卸载消失的、对有界退避内的瞬时失败重试、收集诊断、按序销毁。重试时间表、队列主体与销毁尾部在 MCP 与 LSP 之间是逐字节相同的，并且已经开始漂移。"每个服务器的有效视图"（查 override、跳过被禁用项、套用补丁、收集凭证引用）写了五遍，用了三种不同的类型收窄。

两处门禁声称覆盖 Node 边界，实际做不到。dependency-cruiser 不把 `node:*` 边放进模块图，因此 `client-cannot-import-node` 是死规则；而 `src/model/state.ts` —— 唯一导入 `node:fs/promises` 的领域模块 —— 被写进 model 规则的例外，而不是被移走。

## Decision

每个不变量只有一个归属，每种机制只有一个实现，代码声明的每条边界都有真正生效的门禁。

**`Catalog` 变成协作者之上的薄外观。** `CatalogContext` 拥有不可复制的那部分：持久化状态、串行变更队列、修订号与扫描代次、失效流水线、安装状态投影。`SnapshotCache`、`SourceStore`、`InstallStore`、`McpService`、`LspService` 各自持有 context，各自负责一类用例。队列与代次计数器仍然各只有一个（[扫描缓存](2026-09-02-catalog-scan-cache.zh.md)依赖这一点）。外观为 355 行；构造函数仍完整接受 `{ userRoot, dataRoot, onChanged, git?, projectSnapshotTtlMs?, userSnapshotTtlMs? }`，只新增一个可选 `ports`，因此裸构造依然可用。

**依赖集合是显式声明的，而不是猜出来的。** `CatalogPorts` 列出全部宿主接缝，`resolveCatalogPorts` 在其下补齐默认值。延迟解析被刻意保留：settings 与 tools 服务在 `apply()` 之后才解析，因此这些闭包在调用时读取，而不是捕获当时的值。会抛错的默认实现从类体移到默认值对象里，组装点可以直接看到它。

**挂载生命周期只有一份。** `src/runtime/mount-lifecycle.ts` 拥有串行过程队列、重试调度器与统一挂载句柄形态。各注册表保留自己的挂载语义，只提供自己的重试判据——MCP 除 foreign/duplicate 外都重试，LSP 对能力包缺失永不重试。

**每个服务器的投影只有一份。** `effectiveMcpServers` 拥有 override 类型收窄、`applyOverride` 与凭证引用。它携带 `enabled` 而不是过滤，因为两个消费方需要相反的行为：状态清单要展示被 override 禁用的声明，挂载注册表要跳过它。这正是本次重构自己的审计判错的一处——第一版按字面套用"跳过禁用项"，静默地把这些行从状态载荷里删掉了，而当时没有任何测试覆盖。

**组装根只做组装。** `apply()` 从 349 行降到 183 行：协调合并与凭证通知防抖移到 `reconcile-scheduler.ts`，settings 命名空间及其 watcher、项目布局同步、反馈工具开关移到 `settings-namespace.ts`，MCP 凭证记录键与写入它的 OAuth provider 共用 `mcp-auth-record.ts`。唯一一次 `settings.register` 及其刻意的失败隔离保持不变（[调度决策](2026-09-08-runtime-reconciliation-scheduling.zh.md)继续生效）。

**边界变得可强制。** 状态编解码器移到 `src/runtime/state-store.ts`，`src/model/` 只剩记录，规则不再需要例外。两条失效的 dependency-cruiser node 规则由 `eslint.config.mjs` 的 `no-restricted-imports` 取代——它能看见这些导入——覆盖 `src/model`、`src/contracts` 与 `src/client`。dependency-cruiser 新增 `contracts-import-nothing`、`model-cannot-import-server-layers` 与 `application-cannot-import-client-routes-or-index`。

结构之外一并清理：七个无消费者的 catalog 导出（含三个被废弃的清单读取器）、四个死的 `Catalog` 成员、一个重复定义的 `hasSuiteManifest`、五份文件系统探测实现、69 个无处引用的 CSS 类与 56 个语言键、三个客户端 API 辅助函数、`PanelShell`/`PanelAction`，以及 `api.ts` 中十三份相同的 fetch 样板。

## Alternatives considered

- **保留单体 `Catalog`，把六类职责写进文档。** 否决：setter 与可变字段让未接线的依赖变成运行时失败而非编译错误，而每个新用例都往同一个文件里再加第七类职责。
- **把持久化 store 移进 `src/application/`，让设计文档的箭头（`application -> model, catalog, contracts`）字面成立。** 延后而非否决：这些 store 做文件系统操作，而 `AGENTS.md` 允许 `runtime/` 或 `application/` 做；迁移本身合理，但会搬动十来个 runtime 也在导入的模块。当前耦合已通过 `CatalogPorts` 显式化，文件搬迁作为未完成项保留，而不是做一半。
- **所有 surface 共用一个泛型挂载注册表类。** 否决：各注册表在挂载什么、失败意味着什么、销毁顺序上并不相同。只有机制是共享的，因此只抽出机制。
- **直接删掉失效的 dependency-cruiser node 规则，不做替代。** 否决：边界真实存在，ESLint 规则能强制它。一条永远不触发的规则比没有规则更糟，因为它读起来像是有覆盖。
- **在每处调用点保留五行式的"每服务器有效视图"。** 否决：它已经出现分歧，而这种分歧是静默的行为差异，不是风格差异。

## Consequences

- `src/` 规模持平（22,140 → 22,121 行）。这是结构变更而非行数精简：拆分在消除重复的同时增加了模块骨架。变化的是极值：最大源文件从 1,260 行降到 551 行，`apply()` 从 349 降到 183，`src/client/` 减少 618 行，`src/catalog/` 减少 124 行。
- 重构在自身范围之外发现了一个真实缺陷：`redactUrl`/`redactValue` 用 `.test()` 探测带 `g` 标志的正则，`lastIndex` 会在调用之间前进，导致同一个值里每隔一个 `${...}` 凭证引用被替换成 `[redacted]`——与该模块自己的文档相反。改用非全局正则修复，并由两个在旧代码上失败的回归用例固定。
- 测试数从 504 变为 507：一个断言已删除实现细节导出的测试，改由它原本覆盖的 `archiveInstall` 行为承接；另新增四个用例（三个针对脱敏缺陷，一个把被 override 禁用的服务器固定进状态清单）。
- 刻意仍保留的重复：`details.ts` 与 MCP 服务各自推导服务器视图，因为它们必须展示被禁用的声明和未脱敏的源形态；`commands-mounts.ts` 与 `user-commands.ts` 共享一张 wanted-diff-register 表，但两处调用点在描述、诊断与 reconcile 签名上并不一致。两者都判定为低于抽取门槛，而不是为了对称强行合并。
- LSP 面板新增的视图模型目前只由面板渲染测试覆盖，单元测试会是更强的保障。
- `src/application/` 仍然可以导入 `src/runtime/`；该方向保持"已声明、待处理"，而不是被禁止。

## Verification

- `pnpm run check:refactor` —— 两个 TypeScript 工程、ESLint、Prettier、契约测试与 dependency-cruiser —— 全绿。
- `pnpm run test` —— 70 个文件、507 个测试。
- `pnpm run build` —— 产出 `lib/` 与客户端 bundle。
- 每条新 ESLint 边界都通过在各覆盖层文件中导入 `node:path` 验证确实触发；每条新 dependency-cruiser 规则都用临时探针文件验证确实触发。
- 脱敏修复通过还原旧模块并观察两个新用例失败来验证。
- 挂载生命周期抽取用假定时器下的临时对照脚本做了新旧比对：两个 surface 的诊断、销毁顺序、重试时刻与放弃日志完全一致。
