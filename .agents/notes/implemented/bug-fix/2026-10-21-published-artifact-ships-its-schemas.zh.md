# Agent Note: 发布产物携带校验器要读的 schema

Status: implemented

## Problem

校验器从磁盘读取随包携带的 JSON Schema。`packages/market-catalog/src/scanning/validate.ts:42` 从编译后的模块向上找到最近的 `package.json`，并返回它旁边的目录。在发布产物里模块落在 `lib/packages/market-catalog/src/scanning/validate.js`，因此解析结果是 `<包根>/packages/market-catalog/schemas`（`validate.ts:60`）。而 npm 的 `files` 列表写的是一个根级 `schemas` 目录。

这个配对到 2026-10-11 还成立。提交 `eec7ee6` 把 schema 挪到它唯一的消费方旁边，并让解析器认识打包后的路径，但 `files` 项仍是 `schemas`。npm 会静默丢弃匹配不到任何文件的 `files` 项，也不报告。于是 0.10.0 与 0.11.0 一个 schema 文件都没发：0.11.0 的 tarball 有 340 个路径，其中没有一个包含 `schemas`。此后每次清单与 `mcp.json` 校验都会在 `…/packages/market-catalog/schemas/1.0.0/plugin.schema.json` 上抛 `ENOENT`，每台机器都必现。0.9.2 用旧的解析器发的是根级 `schemas/` 目录，共 33 个文件，这就是只有 0.10.0 及之后出问题的原因。

这个后果记录在 issue #113 和配套的 [终止性 extension 会话失败降级该步](./2026-10-21-terminal-extension-session-failure-degrades-the-step.zh.md) 中：第一次校验发生在会话 capture 里，所以这次抛出让每个工作区会话都起不来。

## Decision

`files` 列表写 `packages/market-catalog/schemas`，正是打包后解析器算出的那个目录。npm 对目录项按递归发布，因此 tarball 携带全部 33 个随包文件，约 150 KB。解析器不变：工作区布局仍通过 catalog 包自己的 `package.json` 解析，打包布局仍通过根 `package.json` 解析。

现在有仓库测试守住这个配对。`packages/market-bundle/test/repo/published-schemas.test.ts` 从 `validate.ts` 的 `SUPPORTED_VERSIONS` 读出受支持的版本，要求每个版本都有 `<version>/plugin.schema.json` 与 `<version>/mcp.schema.json`，并要求每个路径在 npm 语义下被 `files` 覆盖——目录项覆盖其子树。第二个用例从源码里读出解析器的打包分支，要求它的字面量与受守的路径相等，因此任何一侧改名都会让测试失败。两个用例都只读文件系统：不打包、不构建、不联网。

## Alternatives considered

**发布整个 `packages/` 树。** 同样能补上 schema，代价是把每个私有工作区源码树、它的测试与夹具都放进公开产物。权威副本只有 schema 库本身。

**保留 `files` 的名字，在构建时把 schema 复制到根级 `schemas/` 目录。** 这能恢复 0.9.2 的形状。它需要一个新的构建步骤，以及一份磁盘上的第二副本——而仓库把这些记录为逐字节的随包副本，所以副本会与 `packages/market-catalog/schemas` 漂移，且没有测试会察觉。

**把 schema 当模块引入，让打包器内联。** 规范禁止的是加载时抓取 schema，不是内嵌 schema，所以这能满足 §5.2。代价是丢掉文档与兼容性报告按路径引用的磁盘库，并且需要 `tsc` 原样输出到 `lib/` 的 JSON 引入路径。修 `files` 只需一行，且让产物布局与检出布局一致。

**只发布 `1.0.0` 与 `1.1.0`。** 运行时只读这两个目录。但这会把方言与命名空间的参考契约从 tarball 里去掉，并使发布的目录比解析器命名的目录更窄，于是守卫必须把这个收窄写进去。完整库只多约 100 KB。

**加载时抓取 schema。** 校验器实现的那份规范禁止这样做（§5.2、§7.2.1）：加载插件必须离线可用，且不得抓取 schema。

## Testing

守卫在修前的清单上失败，修后通过。我用两次真实打包端到端证明了打包后的行为：`tsc -p tsconfig.json` 之后 `npm pack --ignore-scripts`，再从每份解包树里引入校验器。

- 修前：340 个路径，包含 `schemas` 的为 0。解包后的校验器对 1.0.0 与 1.1.0 的 plugin 与 MCP schema 都抛 `ENOENT`。
- 修后：374 个路径，33 个 schema 条目。解包后的校验器对两个 spec 版本的最小清单与 `mcp.json` 校验无错。

在最终树上执行 `pnpm pack --config.ignore-scripts=true` 得到同一个 374 路径集合：两份路径列表 `diff` 无输出。

## Consequences

坏的 `files` 项不再能不经仓库测试就进入发布。这个测试证明的是文件集合与解析器字面量，不是 npm 的归档本身，因此 npm 的 `files` 语义变化或将来引入通配项时，测试会保守地失败而不是静默通过。

发布产物增加了 schema 库的体积，私有工作区包仍然保持私有。

0.10.0 与 0.11.0 的 tarball 在 registry 上仍然是坏的。第一个能校验清单的发布，是携带这条决定的那个版本。
