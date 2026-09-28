# Agent Note: 可选宿主服务一律从服务表读取

Status: implemented

## Problem

套件技能与斜杠命令加载时报 `cannot get property "shell" without inject`，反馈工具注册时报同一条错误（服务名是 `tools`）。三个症状出自同一个写法。

Cordis 解析 `ctx.<name>` 时沿**读取方 fiber 的祖先**向上查找，返回第一个 store 中带该名字的祖先。由**兄弟** fiber 提供的服务对这条链路不可见，走到根 fiber 即抛错。宿主正是从兄弟 fiber 提供 `shell`（bash 沙箱）与 `tools`（工具注册表），于是这些读取在各自的位置上都抛错：

- `src/index.ts` 以 `(ctx as unknown as { shell?: ShellSeam }).shell` 解析 shell seam，所在 entry fiber 的 `inject` 只有 `['skills','commands']` —— 这是 `SuiteSkillProvider.get()` 的路径，也就是每一个 market 提供的技能正文。
- `src/runtime/commands-mounts.ts` 以 `(this.ctx as unknown as { shell?: ShellSeam }).shell` 解析同一个 seam，既落在 entry fiber 上，也落在项目挂载自己的 `['commands']` scope 上 —— 这是每一条套件斜杠命令的路径，且在检查正文里有没有占位符之前就执行。
- `src/runtime/feedback-tool.ts` 在 entry fiber 上读取 `(hostCtx as unknown as ToolsHost).tools`。`syncFeedbackTool` 把异常吞掉，于是日志里不是预期的「宿主没有工具注册表」，而是每次设置同步都出现 `feedback tool mount failed: cannot get property "tools" without inject`，`report_market_issue` 从未注册成功。

测试三处都没拦住，原因相同：它们交给被测代码的是**普通对象**，服务直接挂在对象上。普通对象没有代理陷阱，`stub.shell` 要么读出 `undefined`、要么直接可用，而真实挂载的插件会抛错。`tests/plugin-apply.test.ts` 把这个错误写在了注释里——它说自己的 stub「像宿主的服务代理一样把 tools 服务直接暴露在插件上下文上」，而代理对于 fiber 未 inject 的服务恰恰不会这样做。

规则本身已经写下来两次：`docs/reference/dsh-plugin-development-standard.md` §2.2，以及[设置 Agent Note](../../implemented/architecture/2026-09-13-settings-and-card-ride-the-host.md) 中关于定时器的段落。缺的是一个会失败的测试。

## Decision

**可选宿主服务从服务表读取，且每个服务只有一个解析处。**

`ctx.get(name)` 读的是按 isolate 键索引的全局服务表而非祖先遍历，宿主未提供该服务时给出 `undefined`，并且仍然对提供方 fiber 的 active 状态保持严格。`inject` 只用于硬依赖。

- `src/runtime/dynamic-context.ts` 的 `shellSeamOf(ctx)` 是解析 shell seam 的唯一位置；entry 与 `CommandMountRegistry` 都调用它。
- `src/runtime/tool-registry-observer.ts` 的 `toolsServiceOf(ctx)` 原本就以这种方式为 MCP 状态面板读取 `tools`，现在也支撑 `mountFeedbackTool`。
- `src/runtime/timer-seat.ts` 的 `seatOf(ctx)` 最先采用这个写法，也是设置 Note 记录下来的那一次。

**测试的对象是拓扑，不是被测函数。** `tests/host-service-seam.test.ts` 挂载一棵真实的 Cordis 树：`shell`、`tools`、`skills`、`commands` 各自来自读取方的**兄弟** fiber，然后跑通三条生产路径——entry 注册的技能 provider 加载正文里带 `` !`cmd` `` 占位符的技能、`CommandMountRegistry` 转发注入后的命令正文、`mountFeedbackTool` 在工具服务上完成注册。每个用例同时钉住陷阱本身：同一 fiber 上的属性读取会抛 `without inject`，这样「为什么要从服务表读」的理由不会随时间消失。entry 用例挂载的插件对象由 entry 自己导出的 `name`/`inject`/`apply` 组成，因此后来往注入列表里加服务、或者把某个可选服务当属性读，都会按 loader 的真实方式被执行到。

**测试里手搓的上下文 stub 一律通过 `get` 解析服务。** `tests/dynamic-context.test.ts`、`tests/mcp-mounts.test.ts`、`tests/plugin-variables.test.ts`、`tests/project-commands.test.ts`、`tests/plugin-apply.test.ts` 都已更新：把服务挂在对象上的 stub 是永远不会像宿主那样失败的 stub。

## Alternatives considered

**静态强制——用 lint 规则或检查脚本禁止 `(ctx as unknown as { <service> }).<service>`。** 否决：它拦不住 feedback-tool 那一处——那里先把类型断言赋给局部变量（`const host = hostCtx as unknown as ToolsHost`），再从变量上读取，要覆盖它需要数据流分析而不是选择器。它也无法在不建模 `inject` 的前提下区分「已注入的读取」与「未注入的读取」：合法位置（`src/index.ts` 在 `inject(['tools'])` 的 scope 内读 `tools`、套件指令挂载在它自己注入的 scope 上读 `systemPrompt`）都得加标注，而赋值后再读的写法照样绕过。真实 fiber 树的测试是失败关闭的，而且失败信息就是生产环境那条错误。

**把 `shell`、`tools` 写进 `inject`。** 否决：本插件必须能在两者都不提供的 profile 上加载，而 `inject` 是激活门；写进去会让插件根本不启动。两者按设计都是可选的，这正是它们延迟解析的原因。

**借用宿主的 `internal/get` waterfall 或 `ctx.reflect.get`。** 否决：harness 没有为 `internal/get` 安装任何拦截器，`ctx.reflect.get` 是反射服务自己的内部方法。`ctx.get` 是文档规定的可选读取面。

## Consequences

套件技能与命令恢复加载（含动态上下文），反馈工具恢复注册。每处读取都是一次调用，祖先遍历的陷阱记在解析处而不是各个调用点。`src/runtime/feedback-tool.ts` 去掉了自己的 `ToolsHost` 外壳，直接从 `toolsServiceOf` 取那段注册表切片。

`src/**` 其余的服务读取，要么发生在该 fiber 已注入的地方（`ctx.inject` 下的 `tools`、`llm`、`subagents`、`agents`，各自 inject 下的 `webServer` 与 `loader`，entry 与项目 scope 上的 `commands`，套件指令 scope 上的 `systemPrompt`），要么走 `ctx.get`（凭据存储的 `credentials`、模型目录里的 `llm`、经由 seat 的 `timer`、经 `src/runtime/host-locale.ts` 语言来源的 `settings`）。浏览器半边还有一处字面上的越界：`src/client/index.ts` 在一个只注入 `settingsScope` 的子 scope 上读取 `slots`；它从父级 client-root fiber 的 store 解析得到，所以当前可用，下次改动该文件时应把它归入那个子 scope 自己的 `inject`。

只记录、不改动：entry 的 `inject = ['skills','commands']` 让 `commands` 成为硬门，而三处代码把它当作可选（`CommandMountRegistry` 的「此 profile 没有 `ctx.commands`」诊断、`UserCommandMountRegistry`、以及 entry 自己的诊断）。这些兜底恰恰在 `commands` 缺席时不可达。移动这道门属于激活语义的决定，不在本次修复范围内。

取代关系：[设置 Agent Note](../../implemented/architecture/2026-09-13-settings-and-card-ride-the-host.md) 中关于定时器的段落记录了同一类陷阱（访问器读取）。那份 Note 仍然是设置、卡片与定时器决策的权威；两份互不取代。[宿主语言来源 Note](2026-09-24-host-locale-source-read-and-lifetime.md) 记录了这条规则在存活期上的一半，针对从模块状态经 `ctx.get` 解析的读取，不取代本条。

## Testing

`tests/host-service-seam.test.ts` 是回归门：四个用例跑在真实 fiber 树上、服务来自兄弟 fiber，覆盖 seam 解析、命令挂载、entry 的技能 provider 与反馈工具。把三处解析中的任何一处改回属性读取，对应用例就会以 `cannot get property "<service>" without inject` 失败。

`tests/dynamic-context.test.ts` 继续用一个人造 seam 覆盖注入流程本身，现在经由 `get` 返回该 seam 的 stub 提供。`tests/plugin-apply.test.ts` 只允许通过 stub 的 `get` 解析 `tools`，因此一旦读取退回属性写法，entry 层的断言就会失败。
