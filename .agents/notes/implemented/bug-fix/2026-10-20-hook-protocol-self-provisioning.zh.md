# Agent Note: 自供 hook protocol，让插件能够激活

Status: implemented

## Problem

插件入口在模块求值时按值引入 `@deepseek-ai/dsh-hook-protocol`（[hooks 执行器](../../../../packages/market-runtime/src/runtime/surfaces/extension-hooks.ts)）。清单把该包声明为必需 peer，而 dsh profile 设 `autoInstallPeers: false`，peer 永远不会被安装。宿主也不提供它：桌面宿主 0.2.1-rc.2 携带 307 个 `@deepseek-ai` 包，其中没有一个名字匹配 `/hook/`。于是该 import 在插件注册任何东西之前抛 `ERR_MODULE_NOT_FOUND`，丢掉的是全部面，而不只是 hooks 面。本地运行被 devDependencies 里的精确镜像掩盖，镜像把该包放进了本仓自己的目录树。

对齐 gate 也接受这棵树。它按 import 的形态判定 peer 与 dependency，从不过问宿主是否真的提供该 peer，因此一个宿主无法满足的必需 peer 能通过 gate。

## Decision

`@deepseek-ai/dsh-hook-protocol` 成为 `dependencies` 条目，携带支持窗口 `>=0.2.0-rc.2 <0.3.0-0`。正常插件安装时 pnpm 把它装进消费方 profile，静态 import 从 profile 中的副本解析，源码保留原静态 import 不变。`peerDependencies` 条目与 devDependencies 镜像一并删除，锁文件重新生成。

该包适合作 dependency，因为它是一个普通库。它发布的 `lib/index.js` 没有任何 import 语句，不注册 cordis service，只导出函数与类型，所以 profile 中的副本不会遮蔽任何宿主 service。这正是[插件开发标准](../../../../docs/reference/dsh-plugin-development-standard.md)给自供能力规定的条件，也与本插件对 LSP 系列包已有的做法相同。

锁文件把声明的窗口解析到它的下限 `0.2.0-rc.2`，因为 prerelease 范围会解析到窗口内最低的版本。这正是 profile 安装拿到的版本，因此也是本仓现在测试的版本。对本插件引入的每个函数而言，两个已发布产物完全一致：架构评审用 diff 比较了 `0.2.0-rc.2` 与 `0.2.1-rc.2`，唯一新增的是 `selectHookGroups`。本插件从不调用它，但仅用于开发的 bridge 包会调用，这正是下一节要解决的冲突。这个形态在运行时是惰性的，并作为已接受的后果记录在此。

## 开发树里有两份副本，profile 里只有一份

声明的窗口解析到下限，这与仅用于开发的 bridge 包 `@deepseek-ai/dsh-hooks-claude-code` 冲突。该 bridge 把协议声明为 0.2.1 线上的精确 peer，并从其中引入 `selectHookGroups`；prerelease 比较符只匹配自身的 `major.minor.patch` 三元组，因此窗口内没有任何版本能满足该 peer。树里只有一份副本时，bridge 求值自己的 import 就会失败，`user-hooks.test.ts`、`mcp-mounts.test.ts` 与 `project-hooks.test.ts` 里的五个 bridge 测试以 `the @deepseek-ai/dsh-hooks-claude-code package is not installed in this profile` 失败。

解决办法是根目录的 `.pnpmfile.cjs`，其 `readPackage` 钩子把 bridge 清单上的这一条 peer 边改写为 dependency 边，版本取 bridge 自己在 `peerDependencies` 里声明的精确值。钩子从清单读取版本而不是写死，因此基线变动无需改这个文件。结果树里有两份副本：插件声明的 dependency 解析到下限 `0.2.0-rc.2`，仅用于开发的 bridge 自带精确的 `0.2.1-rc.2`。另外四种解法都用 pnpm 11.17.0 实测过，全部失败：peer 边上的 scoped override、带父版本选择器的 override、`dedupePeerDependents: false`、以及用 `packageExtensions` 添加同名 dependency。只要该包已有任一版本存在，pnpm 就不会重新解析 peer 边。

这是开发解析与 profile 安装唯一一处有意不同。消费方 profile 从不安装 bridge，因为 `@deepseek-ai/dsh-hooks-claude-code` 始终是没有 profile 挂载的 optional peer，所以 profile 只解析出一份副本：下限那一份。pnpmfile 只属于开发树。它不在 `package.json` 的 `files` 里，实测打包产物为 340 个条目，其中没有 `pnpmfile`、`pnpm-workspace.yaml` 或 `pnpm-lock.yaml`。因此锁文件记录的是插件声明依赖的一份条目，加上仅用于开发的 bridge 自带的一份嵌套副本，并由 `pnpmfileChecksum` 记录写锁文件时钩子已生效。

钩子被删除时也会硬失败。`pnpm install --frozen-lockfile` 会把锁文件里记录的 `pnpmfileChecksum` 与磁盘上的钩子比对，不匹配时以退出码 1 报 `ERR_PNPM_LOCKFILE_CONFIG_MISMATCH: Cannot proceed with the frozen installation. The current "pnpmfileChecksum" configuration doesn't match the value found in the lockfile`，因此没有人能删掉钩子还保持静默的绿树。当协议下限升到 bridge 声明的那个版本时，钩子应被删除，因为那时一份副本同时服务两边。`packages/market-bundle/test/repo/hook-protocol-lockfile.test.ts` 会报出这个状态，并在消息里点名该钩子已可删除，因此钩子不会活得比它的理由更久。

profile 永远不会收到嵌套副本，原因并不是宿主提供了 bridge。`@deepseek-ai/dsh-hooks-claude-code` 是本仓的 `devDependencies` 条目，消费方 profile 从不安装它。bridge 先前只能通过它的 optional peer 契约进入 profile，而 profile 设 `autoInstallPeers: false`，该设置从不安装 optional peer。桌面宿主 0.2.1-rc.2 两个包也都不提供：它的载荷携带 307 个 `@deepseek-ai` 包，其中没有一个匹配 `/hook/`。因此 profile 既看不到 bridge，也看不到嵌套的协议副本，hooks 面继续返回它本来就在返回的诊断，直到某个宿主或某个 profile 提供 bridge 为止：一条 `{ suiteId, reason }` 记录，reason 为 `the @deepseek-ai/dsh-hooks-claude-code package is not installed in this profile`。这是 hooks 面自己的消息，不是诊断码；`host-missing` 这个码属于 LSP 路径，从不用来描述 hooks。当某个宿主安装确实携带 bridge 时，那份安装同时携带匹配的协议副本，因此在那种情况下嵌套副本同样不必要。嵌套副本只存在于本仓的开发树，bridge 在那里只是一个供五个测试使用的 devDependency。

读 bridge 测试时要留意一处不精确。`hooks-mounts.ts` 把 bridge 的 `import()` 包在 try/catch 里，任何加载失败都报成 `the @deepseek-ai/dsh-hooks-claude-code package is not installed in this profile`。对缺少 `selectHookGroups` 导出这类链接失败，这条消息并不准确：包是装着的，失败的是它的 import。收紧该诊断属于单独的变更，不在本次范围内。

锁文件证据如下：

```yaml
# pnpm-lock.yaml 第 11 行，写这份锁文件时钩子已生效
pnpmfileChecksum: sha256-LHVN6QEBhFh1ZGlBVZpIwdpzqBjyAPqZtJ7eUExsV6o=

# 插件自己的声明解析到下限
importers:
  .:
    dependencies:
      '@deepseek-ai/dsh-hook-protocol':
        specifier: '>=0.2.0-rc.2 <0.3.0-0'
        version: 0.2.0-rc.2(...)

# 仅用于开发的 bridge 自带精确副本
packages:
  '@deepseek-ai/dsh-hook-protocol@0.2.0-rc.2': ...
  '@deepseek-ai/dsh-hook-protocol@0.2.1-rc.2': ...
```

钩子放在仓库根目录，因为 pnpm 只在那里读取它，其他位置都不成立；根目录文件约定允许放置平台工具消费的文件。`packages/market-bundle/test/repo/pnpmfile-hook.test.ts` 直接驱动该钩子，一个目标清单加一个无关清单，断言只有目标的那条协议 peer 边移动，因此条件一旦放宽会在评审中失败，而不会静默改变解析。

## Alternatives considered

- **保留 peer，并把 hooks 面降级为一条诊断。** 否决为本 issue 的方案：它把整体激活失败换成既有能力的静默丢失，而要走到诊断状态还需把 import 改成惰性，涉及约 15 个调用点以及 `createDetachedRuns` 字段初始化器。对一个拥有 cordis service、无法自供的包，这仍是正确的形态。
- **删除并行执行器，复活宿主 bridge。** 否决为本 issue 的方案：它需要八到十二个工程师日，会移除 `ExtensionHooks` 提供的逐 hook 选择与插件路径环境，而且并不会让插件激活更快。`reconciler.ts` 里的死 bridge 需要自己的变更与自己的决策记录。
- **把协议代码 vendor 进本包。** 否决：它重复上游逻辑并丢掉有版本的契约，而这正是对齐 gate 要守住的东西。
- **在本次变更里提交宿主清单并新增 gate 规则。** 否决为本 issue 的方案：307 个名字随每次宿主发布漂移，本次修复不需要清单。通用守卫属于单独的变更。

## Consequences

- 一次 profile 安装现在会把一个包放进 profile，静态 import 在那里解析。已经带有该包的 profile 继续可用，因为该库无状态，任一副本都能满足该 import。
- 声明的窗口解析到下限 `0.2.0-rc.2`，所以 profile 运行的是较旧候选线上的协议代码，而宿主运行 `0.2.1-rc.2`。对这个包而言差异是惰性的，且 gate 强制该窗口，因此本次修复接受它。下限副本把 `@deepseek-ai/dsh-invariants` 声明为 peer，且它的 `dsh-session` 与 `dsh-shell` peer 指名 `0.2.0-rc.2`，而宿主运行 `0.2.1-rc.2`，于是 profile 安装会为这三者打印 unmet-peer 警告。它的 cordis peer 是 `~4.0.4`，运行 4.0.4 或 4.0.5 的宿主都能满足，因此 cordis 不在这些警告之中。安装以退出码 0 结束，这些警告是预期结果，不是失败。
- 删除 dev 镜像是有意为之，不是清理时的偶然。用本仓钉住的 pnpm 11.17.0 做的探针显示，同时在两节声明只会解析出一份副本，版本取 dependency 范围，dev 条目被丢弃。镜像因此是惰性的，保留它只会让清单声称测试跑在 `0.2.1-rc.2` 基线上，而实际跑在 profile 安装的下限副本上。删除它关闭了这个缺口，任何依赖较新副本的测试现在会失败，而那正是信息。
- hooks 执行器没有改动，逐 hook 选择、插件路径环境、持久化的 `hook/invoked` 与 `hook/result` 配对继续工作。不需要改 README，因为用户可见的承诺（hooks 在生命周期事件上运行）没有变化。
- 两个打包测试在旧清单形态上失败、在新形态上通过，所以将来若有人把该包改回必需 peer，坏掉的会是测试而不是用户安装。

## Testing

- `packages/market-bundle/test/repo/hook-protocol-provisioning.test.ts` 读取根清单，要求存在携带支持窗口的 dependency、没有必需 peer、没有 peer 元数据条目、没有 dev 镜像。它的 fixture 用例覆盖修复前的形态与漂移的范围。
- `packages/market-runtime/test/hook-protocol-exports.test.ts` 从 `extension-hooks.ts` 读出 import 列表，引入已安装的副本，要求每个被引入的值都存在。第二个用例要求解析出的副本恰好是声明范围解析出的下限。这个比较捕获的是声明漂移：已声明范围但解析出另一个副本时，它会因版本不符而失败。面对修复前的清单，它会更早因另一个原因失败，因为没有声明可读下限，于是抛出 `package.json no longer declares @deepseek-ai/dsh-hook-protocol as a dependency`。
- `packages/market-bundle/test/repo/hook-protocol-lockfile.test.ts` 读取 `pnpm-lock.yaml`，不用 semver 解析器就钉住这份拆分：根 importer 持有声明的下限，bridge 快照持有 bridge 自己声明的版本，且协议版本恰好两个。fixture 用例覆盖了使钩子可删除的合并状态。
- `node scripts/check-host-alignment.mjs --host-version 0.2.1-rc.2` 报告检查了 36 个包且无违规。
- 钩子在场时 `rm -rf node_modules && CI=true pnpm install --frozen-lockfile` 成功；删除钩子后同一条安装命令失败。

## Related decisions

- [Force the host dependency baseline to one release line before it can ship](../process/2026-09-11-host-dependency-alignment-gate.md) 拥有本次变更所满足的 gate 规则。
- [Self-provisioned LSP capability](../architecture/2026-09-11-self-provisioned-lsp-capability.md) 是「由本包安装宿主能力、而不是要求 profile 提供」的先例。
