# Agent Note: 可选 peer 不能是值导入

Status: implemented

## Problem

`dsh-agent-plugins-market@0.12.0` 把 `@deepseek-ai/dsh-session-query` 声明为**可选** peer，而 `packages/market-runtime/src/runtime/host/extension-session-state.ts` 的第一行就是它的副作用导入。副作用导入会产出真实的运行期导入。在发布 tarball 装进空目录后实测，`await import('dsh-agent-plugins-market')` 以 `ERR_MODULE_NOT_FOUND` 失败并点名该包，插件因此一行都没注册。

两件事掩盖了它。dsh profile 设 `autoInstallPeers: false`，所以插件自己的安装从不装任何 peer。已发布的桌面 profile 又从 `~/.dsh/profiles/node_modules` 提供了该包（旁边还有 248 个宿主包），所以桌面应用加载正常。本仓库的树里还带着 devDependencies 镜像，本地每次运行也都能解析。

同一个缺陷就藏在下一个导入，只因第一次失败中断了求值而未被发现。`@deepseek-ai/dsh-tools` 同样被声明为可选，而 `packages/market-bundle/src/platform/feedback-tool.ts` 从它按值导入 `defineTool`，`settings-namespace.ts` 又静态到达该模块。只要 session-query 能解析，插件就会改在 `dsh-tools` 上失败。

对齐门禁对两者都放行。它从导入语句的**形态**推断必选还是可选，把每个 `from` 从句都当作静态导入，从不追问该语句是类型导入还是值导入。类型导入在构建时被擦除、运行期零成本，因此这两个包另外三处用法上的标记是成立的，而门禁无法把它们分开。

## Decision

可选 peer 只在导入会被构建擦除时才成立。`extension-session-state.ts` 改用 `import type` 导入 `SessionQueryEngine`，`sessionQuery` 的 cordis 增强仍到达编译器，而运行期不再产出任何导入。声明仍是带支持窗口 `>=0.2.0-rc.2 <0.3.0-0` 的可选 peer。

回退路径就是该模块本已在读的接缝。`optionalService(ctx, 'sessionQuery')` 是本插件读取可选宿主服务的既有容错方式，模块经它回答 `undefined`，而不是抛错。不提供服务包的 profile 不治理任何 agent：每个 pre-step 钩子原样放行，每个受管资源保持拒绝，`status()` 报告 `extension-session-query-unavailable`，`read()` 返回 `undefined` 而非一份能授权任何东西的状态。提供该服务的宿主行为与从前完全一致。

这正是其它可选接缝给出的答案。`hooks-mounts.ts` 把缺失的 bridge 报成一行带原因的套件行，LSP 路径报 `host-missing`。不可用的能力由一个可被调用方点名的代码报告，绝不是 `TypeError`，也绝不是一个被静默允许的回合。

`@deepseek-ai/dsh-tools` 没有这样的接缝。它的 `defineTool` 是纯函数，在构建工具定义时运行，各调用方在挂载时读取结果，所以惰性加载只是把失败往后挪。它改为必选 peer：安装包供给它，和其它服务包一样，可选标记随之删除。

**门禁现在区分两种导入形态。** `scripts/check-host-alignment.mjs` 读取每个宿主说明符所属的语句，把生产文件的值导入与类型导入分开记录。新违规 `optional-static` 在 `peerDependenciesMeta[name].optional` 被设到某个被生产文件按值导入的包上时失败，`--fix` 删除该标记而不是把它带上线。`optional-undeclared` 规则不变：只经 `import(...)` 到达的包仍要求该标记。两条规则合起来说明：标记描述运行期的行为，而不是清单的期望。

## 不含宿主包的安装仍然需要的导入链

在重新构建的 tarball 上实测，装进空目录。`npm install` 会自行解析必选 peer，所以普通安装现在到达 `IMPORT OK`。扣掉全部 peer 后（`--legacy-peer-deps`，即 profile 的形态），只剩五个 `dependencies` 条目可解析，而导入链按此顺序要求这十六个宿主说明符：

```text
 1. @deepseek-ai/dsh-session              peer
 2. @deepseek-ai/dsh-home-paths           dependency
 3. @deepseek-ai/dsh-timeout              peer
 4. @deepseek-ai/dsh-atomic-write         dependency
 5. @deepseek-ai/dsh-llm                  peer
 6. @deepseek-ai/dsh-tools                peer
 7. @deepseek-ai/dsh-agent                peer
 8. @deepseek-ai/dsh-system-prompt        peer
 9. @deepseek-ai/dsh-subagent             peer
10. @deepseek-ai/dsh-lsp                  dependency
11. @deepseek-ai/dsh-scope                peer
12. @deepseek-ai/dsh-hook-protocol        dependency
13. @deepseek-ai/dsh-subprocess           peer
14. @deepseek-ai/dsh-credentials          peer
15. @deepseek-ai/dsh-attachment           peer
16. @deepseek-ai/schemastery              dependency（非宿主包）
```

`@deepseek-ai/dsh-session-query` 已不在其中。其余每个说明符都有声明，其中每一个 peer 都是安装包供给的包，这正是[插件开发规范](../../../../docs/reference/dsh-plugin-development-standard.md) §2.1 所述的供给划分。

## Alternatives considered

- **把 session-query 自供给为 `dependencies` 条目**，与 `dsh-hook-protocol` 和 `dsh-lsp` 一样。否决：那两个是无状态纯库，profile 副本不可能遮蔽宿主服务。`dsh-session-query` 导出 cordis `Service`，而观察会话日志的正是宿主的那个实例。profile 本地副本会成为宿主服务的第二个实例，也就是[自供给 LSP 能力](../architecture/2026-09-11-self-provisioned-lsp-capability.zh.md)笔记自己列出的、不要自供给宿主服务包的理由。
- **彻底删掉该导入，只留裸的 `ctx.sessionQuery` 读取。** 否决：这个导入是类型导入，有其作用。它带来 `sessionQuery` 增强与 `SessionQueryEngine` 类型，没有它属性读取既不过类型检查也不指向任何已发布成员。
- **在 `dsh-tools` 的四个调用点各自惰性导入。** 否决：`defineTool` 在定义构建时运行，调用方在同一次挂载中把结果交给 `ctx.tools.register`。惰性加载只是把失败推迟到挂载，并给反馈工具加上第二个"不可用"诊断，而这个插件没有该包根本无法工作。必选 peer 的答案零成本，也与安装包已经供给该包的事实一致。
- **让门禁读产物 JavaScript 而不是源码。** 作为通用规则否决：门禁跑在 pre-commit 钩子与 `prepack` 上，不能依赖构建已经跑过。读说明符所属的语句能从源码回答同一个问题，且夹具测试把 `import { type X, y }` 混合语句钉在值导入一侧。
- **对所有 peer 都删除可选标记。** 否决：`dsh-mcp-client` 与 `dsh-hooks-claude-code` 只经 `import(...)` 到达且确实优雅降级，标记对它们成立，`optional-undeclared` 规则继续要求它。

## Testing

- `packages/market-runtime/test/session-query-seam.test.ts` 读取源文件，要求该包恰好出现一次且位于 `import type` 语句中，并要求清单保留可选 peer。改成值导入或删掉声明都会让它失败。
- `packages/market-bundle/test/integration/extension-session-query-seam.test.ts` 在不挂 `sessionQuery` 插件的上下文里挂载状态服务，要求 `status()` 报告 `extension-session-query-unavailable`、`read()` 返回 `undefined`、agent 保持 idle、`initialize()` 以该代码拒绝。
- `packages/market-bundle/test/repo/host-alignment.test.ts` 增加一例，在夹具树上运行真实脚本：带可选标记的值导入报 `optional-static` 且 `--fix` 删除标记，而类型导入保留标记并通过。
- `pnpm run build && npm pack` 后装进空目录，再执行 `node --input-type=module -e "await import('dsh-agent-plugins-market')"`，到达 `IMPORT OK` 并列出 `Config, apply, inject, name`。同一条命令对 0.12.0 的 tarball 以 `ERR_MODULE_NOT_FOUND` 失败，点名 `@deepseek-ai/dsh-session-query`。
- `node scripts/check-host-alignment.mjs --refresh` 报告检查 36 个包、零违规。

## Consequences

- 提供 session-query 服务的 profile 行为与从前完全一致。不提供的 profile 现在能加载插件，只丢失扩展选择能力，并在 surface 展示原因处报告 `extension-session-query-unavailable`。
- 在该 profile 里扩展选择 surface 是不可用，而不是"降级但能用"。没有读取器就无法重放会话的持久化选择，所以认领任何 agent 都会让每个回合停在那里等一个永远发布不出来的状态。拒绝该 surface 才是诚实的答案。
- `@deepseek-ai/dsh-tools` 不再在清单里可选。不含该包的 profile 现在会在安装时报未满足的 peer，这正是声明在履行职责。
- 门禁多了一条规则，现在能失败它从前放行的树。这正是重点：两个缺陷在本变更之前都是绿的。
- 发布 tarball 的清单与它的运行期依赖图现在一致，所以 `package.json` 回答"这个插件需要什么"时不必让读者去翻构建产物。
