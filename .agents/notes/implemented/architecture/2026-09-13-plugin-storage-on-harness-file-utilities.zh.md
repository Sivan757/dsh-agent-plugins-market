# Agent Note: 插件存储改用宿主文件工具

Status: implemented

## Problem

这个插件持久化的所有东西——`state.json`、Agent 布局根下的 MCP 与 LSP 声明、每个 suite 的 override、LSP 启用集、feedback 时间戳、以及用户自建的 Markdown 面板——此前都是手写 `node:fs`，其中四处还各有一套 `writeFile` + `rename`。这些 rename 没有一个带重试，而 Windows 在覆盖已存在文件时会出现瞬时 `EACCES`、`EBUSY`、`EPERM`；也就是说，在一个负责安装他人代码的插件里，它自己的持久状态反而是保护最弱的文件路径。home 解析同样是手写的，并且会把空白的 `$DSH_HOME` 解析成当前工作目录。

## Decision

持久化写入改走 `@deepseek-ai/dsh-atomic-write` 的 `writeFileAtomic`，home 解析委托给 `@deepseek-ai/dsh-home-paths`。两者都是宿主为这一层自备的工具：`settings-file`、`credentials-local`、`agent-presets`、`llm-deepseek`、`app-boot` 依赖前者，12 个宿主包依赖后者。每处写入都显式声明 mode——插件私有状态用 `0o600`/`0o700`，供其他 Agent 工具读取的 Markdown 面板用 `0o644`。

`ctx.fs`——宿主那个确实自带原子文本写入的抽象 `FileSystem`——是刻意不用的：

- 它是**执行世界**的文件系统，不是本进程的。`packages/fs/fs-sandbox` 写明了这条原则：`ctx.fs` 与 `ctx.subprocess` 共同定义一个世界；E2B 实现保持"宿主拥有 … plugin objects … session logs and persistence … skills"，而"沙箱状态是刻意短暂的：超时与 dispose 会删除远端文件与非托管状态"。把持久插件状态接到那里，就等于把它放进一个会被销毁的世界。
- 出厂 profile 挂的是 `fs-sandbox`，其 `workspace-write` 只允许 `[workspaceRoot, '/tmp', tmpdir()]`。本插件的每个根都在其外，因此裸调 `writeText` 会被拒绝；要用它就得由插件声明一条比会话策略更宽的策略——而宿主并没有"harness 自有"或"插件自有"的模式。
- 该契约没有二进制写入，也没有 `mkdir`、删除、重命名、复制，所以源码获取与卸载清理无论如何都共不了这条 seam。

## Consequences

现在每一次持久化写入都是一次原子发布，带 Windows 重试、不跟随被埋符号链接的 `wx` 临时文件创建，以及由该调用负责建父目录。四份各写一套的同类逻辑收敛成共享的一份。

随之而来两处行为变化。以前会跟随符号链接目标写入的调用，现在会替换掉那个链接本身。另外空白的 `$DSH_HOME` 或 `$DSH_AGENTS_HOME` 现在视为未设置，不再把 home 解析到当前工作目录——一个畸形的覆盖值再也不能把插件的存储指到它碰巧启动的那个目录。配置了 `$DSH_AGENTS_HOME` 时也会展开前导 `~`，与宿主对自己 home 的规则一致。

## Alternatives considered

**通过 `ctx.fs.writeText` 写。** 那样会跟随部署方挂载的后端，并拿到 `fs-local` 更强的实现——fsync，以及 Windows 上基于 `ReplaceFileW` 的 DACL 保留。基于上面三条理由否决；其中 E2B 那条是决定性的：宿主已明确决定插件状态不进入执行世界，何况本插件还会调起宿主上的 `git` 与 `tar`，它的文件与它的进程必须同处宿主世界。

**保留手写 temp + rename，再加一个重试。** 那是在四个地方重新实现宿主已经测过的东西，而且那份实现仍然缺少防符号链接的临时文件创建。

**直接调用 `fs-local` 的裸 `writeFileAtomic` 而不是用工具包。** 那是最强的实现——staging 目录、fsync、Windows DACL 复制——但 `@deepseek-ai/dsh-fs-local` 只导出根入口与 `./src/*`，裸模块是 TypeScript 源码而不是可导入的运行时入口。

## Testing

`tests/state.test.ts` 钉住插件现在依赖的性质：写入两层不存在的目录会创建它们；连续两次写入只留下一个文件、内容是第二次的；并且（在 POSIX 上）替换后的文件带 `0o600`。`tests/paths.test.ts` 覆盖宿主展开的各种波浪号形式、配置过的 harness home，以及两个根的空覆盖规则。套件其余部分端到端跑过迁移后的调用点：`mcp-direct-config`、`lsp-direct-config`、`mcp-overrides`、`storage-migration`、`user-store`、`panel-resources` 与 `state` 都会把自己写出去的内容读回来。
