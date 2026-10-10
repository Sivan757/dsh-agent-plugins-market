# Agent Note: 钩子试运行与卡片上的阶段

Status: implemented

## Problem

Hooks 两个界面只说声明写了什么，从不说它能不能跑。用户能看到命令、匹配条件、超时与支持情况，但路径写错或解释器缺失要等到会话里那个事件真的触发才暴露。同一批界面还把除一个以外的所有事件藏在页签后面：两个事件各有一条声明时，用户必须切换页签才知道第二个阶段存在。

## Decision

每条声明一次试运行，阶段写在卡片上。

`EXTENSION_ROUTES.hookRun`（`/api/agent-plugins/extension-presets/hook-run`）接收 `ExtensionHookRunInput`：sourceId、suiteId、event、hookIndex，以及资源地址上可选的 sessionId。请求体只带身份，命令由服务端从概览同一个目录读取结果里解析，调用方永远不能自带命令。没有 sessionId 时只查用户与已安装行；有 sessionId 时扩展到该会话的项目钩子。工作目录固定为用户根目录，不接受客户端指定的路径。

命令只跑一次，stdin 是合成事件载荷（`hook_event_name`、`dry-run` 会话 id、`cwd`、`permission_mode`、`dry_run`），超时取声明自己的值并封顶 60 秒，环境变量与真实钩子进程一样来自 `pluginPathEnvironment`。两路输出各封顶 32768 字符，结果里带 `timedOut` 与 `truncated`。详情显示退出码、耗时、运行说明与命令写出的两路输出。未知声明、没有可用钩子的声明、缺少 shell seam 都在结果里返回稳定错误码，不会让请求失败。

两个 hooks 界面都去掉按事件的 `ResourceTabs` 行。所有声明列在一起，`HookResourceCard` 把 `detail.event` 作为页脚标签，与匹配条件、支持情况同排。`packages/market-ui/src/ui/hook-event-grouping.ts` 随页签一起删除。

## Alternatives considered

- **让客户端提交命令串。** 否决：那条路由会变成任意命令入口，同源校验只是防跨站，不是授权边界。
- **跑在一次性临时目录。** 先给出；用户选了用户根目录，因为带状态的钩子会读取自己在家目录下的位置。
- **跑在会话工作区。** 给出过；未采纳，因为命令可能写入它所在的目录。
- **只做静态校验，不执行。** 给出过；未采纳，因为它回答不了命令能否运行。
- **保留事件页签，另外加阶段标签。** 否决：标签已经逐行写明阶段，页签只是重复它，同时藏起其余行。
- **把全部路径别名导出给运行进程。** 否决：方言别名在套件脚本里是运行时探测位，其中一个会选中另一个运行时的分支。

## Consequences

- 会话还没走到那个事件，用户就能看到声明是坏的，包含解释器报错与退出码。
- 命令在用户根目录运行，带副作用的钩子可以改动那里的文件。动作是显式的、逐条声明的。
- Hooks 面板一次列出全部事件；搜索与状态过滤、卡片解剖都不变。
- 没有 sessionId 时解析用户与已安装行；管理窗的行带会话 id，因此其项目钩子也能解析。

## Testing

客户端覆盖在 `tests/client-hooks-status-panel.test.ts`：无页签列表、页脚阶段标签、试运行请求体与渲染结果。服务端覆盖在 `tests/extension-hook-run.test.ts`：按声明位置解析、未知地址、被拒绝声明没有命令、用假 shell 跑运行路径（目录、stdin、超时、截断、信号、执行器拒绝），以及路由（仅 POST、跨源拒绝、服务不可用、地址非法，且命令与目录都不经线路传输）。
