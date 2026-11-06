# Agent Note：MCP 桥按宿主自己的类型注册

Status: implemented

## Problem

桥把工具交给宿主注册表时，走的是一份手写的宿主契约副本：`host-contract.ts` 逐字段复写了 `ToolDefinition`、`ToolExecution` 和 `ToolExecutionResult`，注册缝上再把宿主上下文强转成 \`{ tools?: { register?: (definition: unknown) => () => void } }\` 好让副本通过。

宿主 0.2.2-rc.1 拓宽了这份契约——执行上下文长出了调用身份、解析后的参数和 step 准入，结果变成了失败分支不带 \`value\` 的判别联合——而手写的副本停在原地。判别联合的副本正是编译器无法核对的那个东西，于是漂移只以一个遮住它的 cast 的形式暴露。插件带着一份已经不再描述宿主实际传给工具体的东西的类型发了版。

## Decision

- **宿主的形状改为 type-only 引入。** `host-contract.ts` 用 `import type` 从 `@deepseek-ai/dsh-tools` 再导出 `ToolDefinition`、`ToolExecution`、`ToolExecutionResult` 和 `ToolRunContext`，编译时擦除：市场仍然不会加载第二份宿主运行时，而编译器从此核对桥注册的每个定义是否满足宿主实际强制的契约。
- **注册缝上的 cast 删掉了。** `bridge.ts` 在注册时读 `ctx.tools`——宿主自己的带类型服务——注册表缺失时依旧以同一条明确报错失败。
- **桥自己的缝保持手写。** `ToolHost`、`McpResult` 和 JSON 值词汇表是桥的面，不是宿主的；它们继续在这里声明。
- **运行时行为不变。** `finalizeContent` 仍在失败结果上提前返回，公开工具名仍是 `mcp__<server>__<tool>`，两阶段的先取后换同步原样未动。

## Alternatives considered

- **把手写副本刷新成新的联合。** 否决：这修得了今天的漂移，也给下一次漂移重造了条件——一份编译器无法对照其来源核对的副本。
- **把宿主类型作为运行时依赖引入。** 否决：副本存在的理由就是市场不加载第二份宿主运行时；type-only 引入在保持这条性质的同时，没有放弃副本提供的任何东西。
- **保留 cast，在别处加类型测试。** 否决：测试断言的是作者记住的东西；编译器核对的是随包发出去的东西。

## Consequences

- 宿主契约再变化时，会在本仓库的 typecheck 上失败，而不是以一个无声的 cast 收场。
- `@deepseek-ai/dsh-tools\` 是部署方供给、本仓库构建时针对的 peer，type-only 引入不增加任何安装时的体积。
- 桥自己的缝保持原状，读 `host-contract.ts` 的人看到的是被区分开、而不是混在一起的宿主契约与桥的缝。
