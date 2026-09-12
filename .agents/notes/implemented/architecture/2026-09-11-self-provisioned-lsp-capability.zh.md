# Agent Note: Self-provisioned LSP capability — the plugin installs and mounts its own seam

Status: implemented

## Problem

插件为每个启用的套件挂载一个 `dsh-lsp-stdio` provider，却把 LSP 能力的其余部分留给部署方。那份契约假设了 dsh 宿主并不具备的行为：

1. **dsh profile 从不安装 peer。** `initProfile` 会把 `nodeLinker: hoisted` 与 `autoInstallPeers: false` 写进 profile 的 `pnpm-workspace.yaml`，因此 `peerDependencies` 是声明而非安装。`dsh plugin --profile <p> add <pkg>` 只是把参数转发给 profile 目录里的 pnpm，而 pnpm 只安装 `dependencies`。
2. **安装包本身不携带 LSP 包。** `$DSH_HOME/profiles/node_modules` 镜像运行中 `dsh` 安装包的依赖闭包，这正是 `dsh-llm`、`dsh-tools`、`dsh-mcp-client`、`dsh-hooks-claude-code` 无需 profile 操作即可解析的原因。`lsp/` 组只经 e2b bundle 进入依赖树——在一个真实 profile 上实测，该 fallback 有 249 个包，其中没有任何 LSP 包。
3. **装上包也还不够。** 这三个包都不声明 `dsh.bundle`，所以 `dsh plugin add` 只把它们装成普通依赖，`reconcilePlugins` 不会让它们成为 layer；只有部署方自己插入那两行，`ctx.lsp` 与 `lsp` 工具才会存在。本机的参考配置正是手工如此：三个 profile 直接依赖，加上 profile 自己的 `cordis.patch.yml` 里两行 `insert`。

结果是：一个宣称支持语言服务器的能力，在任何标准安装上都静默降级为 `host-missing` 诊断。

## Decision

插件自己拥有整条能力链：既安装这三个包，也自己挂载缺失的两层 seam。

**供给方式由依赖种类表达。** `@deepseek-ai/dsh-lsp`、`@deepseek-ai/dsh-lsp-stdio`、`@deepseek-ai/dsh-tool-lsp` 从可选 peer 移入 `dependencies` 并对齐宿主基线，于是用户安装插件时 pnpm 就把它们放进 profile——不需要第二条命令，也不需要确认步骤。安装包已经携带的能力包仍是 `peerDependencies`：为它们自带一份副本会把宿主服务的第二个实例放进 profile 并遮蔽安装包自己的那份，而修好的模块 fallback 正是为防止这一点而存在。

**挂载是惰性的。** 第一个 server 变为需要时，`LspMountRegistry` 先挂 `@deepseek-ai/dsh-lsp`、再挂 `@deepseek-ai/dsh-tool-lsp`；最后一个 server 消失时释放它们。因此从不启用 LSP 套件的 profile 永远不会多出一个 `lsp` 工具。顺序即契约：工具注入 `lsp`，stdio provider 注册进它。

**不去问 profile 里已经有什么。** 供给是插件的属性，不是部署方的属性：版本由本包的依赖声明决定，让位给别的层注册的 seam 就等于静默运行那一层的版本。因此两次挂载都是无条件的，而被占用的 seam 会以 `seam-conflict` 诊断返回，并点名要移除的那一层——手工的 `cordis.patch.yml` 行，或 profile 对该包的依赖。只有响亮地失败，才是让对齐后的副本真正运行起来的唯一途径。

**失败仍是诊断，不是重试。** 加载不到能力包时报告 `host-missing` 并给出重装命令，且永不进入重试调度；该失败会在下一次 reconcile 时重试，因此修好 profile 无需重启插件即可恢复。

对齐门禁（[宿主依赖对齐门禁](../process/2026-09-11-host-dependency-alignment-gate.md)）增加了配套规则：`dependencies` 条目必须携带 `^<baseline>`，源码引入的宿主包可声明在两个段中的任意一个，而 `--fix` 从不在两段之间搬动包。

## Alternatives considered

- **让位给 profile 已注册的 seam**（`ctx.get('lsp') !== undefined` 就跳过挂载）。否决：这会让实际运行的版本变成部署方的属性——一个带更旧手工 pin 的 profile 会继续跑那份旧副本，而本包的声明说的是另一回事，正是本插件要消除的那种漂移。被占用的 seam 改为报告冲突并点名要移除的那一层。
- **保留 LSP 包为可选 peer，在诊断里打印安装命令。** 否决：这让功能只对读诊断的用户生效。该能力是作为插件的一部分宣传的，供给它就是插件的职责。
- **把宿主自己的服务包（`dsh-tools`、`dsh-llm`、`dsh-hooks-claude-code` 等）也加进 `dependencies`**，让每个宿主 surface 都钉在实测版本上。否决：安装包已通过共享 fallback 提供它们，而 profile 本地副本会为该 profile 里所有插件遮蔽它。那个副本正是观察到的 `dsh-hooks-claude-code@0.1.2-rc.1` 遮蔽 `0.1.5-rc.1` 安装包的成因——以放弃共享实例保证为代价换取控制权。
- **通过插件自己的 `cordis.patch.yml` 插入那两行。** 否决：`insert` 是无条件 push（[`vendor/include`](https://github.com/deepseek-ai/deepseek-harness)），固定的 `id: lsp` 会与手工组装 profile 已插入的行冲突并重复加载该服务。带 `ctx.get()` 守卫的运行时挂载没有这种冲突，而且还能以"确实启用了 LSP 套件"为条件。
- **在插件启动时挂载 seam，而非按需。** 否决：那会把面向模型的 `lsp` 工具发布到每个会话，即使没有任何 provider，等于把一个可用 surface 变成每次调用都返回 `LSP_UNAVAILABLE` 的工具。
- **运行时向 profile 安装**（插件内 spawn `pnpm add`）。否决：宿主没有暴露安装 API，插件无法获知自己的 profile 名，在宿主运行时写另一个进程的 `node_modules` 需要重启才生效，而且它会让一次 agent 驱动的安装成为用户机器上的静默副作用。

## Consequences

- LSP 在标准安装上开箱可用：安装插件是唯一一步，语言服务器可执行程序仍由用户负责。
- 发布包现在会往每个消费方的 profile 里装三个宿主包。它们不大，但对从不启用 LSP 套件的用户来说 profile 的 `node_modules` 变大了。
- 该能力的版本是插件声明的基线，而不是安装包的版本。当 profile 已带有更旧的手工 pin 时，pnpm 会在 profile 根保留那个 pin 并把插件的副本嵌套进去，两者共存；插件把 provider 注册进 profile 实际发布的那个 `ctx.lsp`。
- 插件自身的测试套件需要为新增的两个 loader 提供 stub：注册表的 context 依赖现在是 `plugin` 加一次服务查询，而"profile 已供给"成为测试中的默认情形，使 stdio 行为保持原有覆盖不变。
