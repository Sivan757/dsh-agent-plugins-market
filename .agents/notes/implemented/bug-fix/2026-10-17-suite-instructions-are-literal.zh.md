# Agent Note: 套件指令文本按字面渲染

Status: implemented

## Problem

已安装的套件通过两个名为 `agent-plugins:instructions` 的提示词段落贡献 Markdown 指令文件 (`packages/market-runtime/src/runtime/host/scoped-contributors.ts` 与 `packages/market-runtime/src/runtime/surfaces/project-runtime.ts`)。两处注册都没有设置宿主的 `interpolate` 标志，而宿主默认为 `true`：`renderPrompt` 会把每个 `{{name}}` 替换成已注册变量，遇到未知名称即抛错(harness `packages/core/system-prompt/src/index.ts`)。

循环只注册 `provider` 与 `model` 两个变量。因此套件里引用任何其他花括号写法——已被移除的 `{{cwd}}` 子句是最常见的一种——会在模型请求之前就让提示词组装失败，而错误指向插件拥有的段落，却是一个插件从未打算解释的表达式。

## Decision

两处注册都传 `interpolate: false`。套件编写的 Markdown 是第三方字面文本，不是模板：插件把它原样放进提示词，不做解释。

## Alternatives considered

- **补注册缺失的变量。** 否决：套件可以引用任何名字，插件无法穷举；插件自造的变量会凭空产生套件从未要求的提示词内容。
- **注册前转义 `{{`。** 否决：它改写第三方文本，与套件文件里的内容不一致。
- **保留默认值并写入限制说明。** 否决：失败发生在用户已安装文本的请求时刻，读者没有可执行的补救。

## Consequences

- 套件文件逐字节进入提示词，包括任何花括号写法。
- 该段落不做任何变量渲染，因此无法通过插值观察 `provider` 或 `model`；将来若真需要变量，须在此重新决策。

## Related decisions

与[跨发布线宿主接缝](../architecture/2026-10-16-cross-release-host-seam.md)互补：那条决策让宿主成员名保持容忍，而不是把名字包起来。
