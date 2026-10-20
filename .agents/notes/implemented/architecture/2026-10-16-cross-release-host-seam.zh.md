# Agent Note: 用一个宿主接缝同时驱动两条宿主发布线

Status: implemented

## Problem

插件把宿主契约声明在 `next` 候选线上，`scripts/check-host-alignment.mjs` 让这份声明保持最新。宿主自己的兼容判定按含 prerelease 的规则读这些范围，因此像 `^0.2.0-rc.2` 这样的范围曾声称兼容 `0.2.1-alpha.4`。代码没有兑现这个声明：以 0.2.1-alpha.4 的包实测，插件有两个源文件编译失败，2052 个测试中有 130 个失败。修复落地前这条线又推进了一次：`next` 已移到 `0.2.1-rc.2`，声明的基线随之跟进。

宿主改名或删除了这次失败背后的每一个成员：

| 消费的能力         | 0.2.0-rc.2                                        | 0.2.1-alpha.4                                             |
| ------------------ | ------------------------------------------------- | --------------------------------------------------------- |
| 启动一个可续子代理 | `subagents.startContinuable(spec)`                | `subagents.startActivation(spec)`，且必须给 `delivery`    |
| 启动一个前台子代理 | `subagents.start(provider, request)`              | `subagents.startActivation(spec)` 且 `delivery: 'caller'` |
| 释放常驻子代理     | `subagents.drainContinuableChildren(parent, ids)` | `subagents.drainChildren(parent, ids)`                    |
| 提供方能力记录     | `toolFilter`、`persona`                           | 删除；新增 `agentPreset`                                  |
| Team 消息结果      | `{ messageId, status }`                           | `{ messageId }`                                           |
| JSONL 持久化插件   | default 导出                                      | 具名 `apply`、`name`、`Config`                            |
| zod                | 宿主范围 `^4.4.3`                                 | 宿主精确 pin `4.4.3`                                      |

前两项改名见宿主升级指南 [`subagent-activations`](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/upgrade-guide/v0.2.1-alpha.1/subagent-activations/guide.zh.md) 与 [`subagent-preset-composition`](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/upgrade-guide/v0.2.1-alpha.1/subagent-preset-composition/guide.zh.md)。

zod 一行是副本问题，不是版本偏好。插件 schema 会跨进宿主的 `ProjectionDefinition.stateSchema`，那里的 `ZodType` 来自宿主自己的 zod。宿主用 caret 范围时双方解析到同一份；现在宿主精确 pin，于是出现第二份副本，宿主的 `ZodType` 变成名义类型，插件的 `z.object({...})` 不再匹配。

## Decision

声明的基线留在 `next` 候选线(2026-10-17 起为 `0.2.1-rc.2`)，代码同时兼容该线与它的前一条线 `0.2.0-rc.2`。

`packages/market-runtime/src/runtime/agents/subagent-seam.ts` 拥有这张改名表。每个成员都是可选的，每次调用都用 `typeof` 守卫，两个名字都不存在的宿主会被拒绝，错误信息同时点名两个成员。路由的两条启动通道与角色运行时的释放调用都改调接缝，不再直接调宿主成员。前台路径也是接缝成员：`startOneShotChild` 把旧线的 `start` 与新线带 caller 投递的 `startActivation` 归一为一个阻塞式运行形状。

提供方能力记录是一个同时带两种写法的变量。宿主只读它认识的标志，因此一份记录服务两条线；对象字面量会触发新线的多余属性检查。

`zod` 声明为 `^4.4.3`，并由 `pnpm-workspace.yaml` 的 `overrides` 钉到 `4.4.3`，让插件与宿主解析到同一份物理副本。该 override 是开发树去重，与既有的 `source-map-js` 条目同类。

## Alternatives considered

- **把基线移到 `alpha` tag 并重钉每一个宿主条目。** 否决：它推翻了[从 prerelease 候选线解析对齐基线](../process/2026-09-23-next-channel-baseline.md)的决定，该决定否决实验通道，理由是它领先于消费方实际安装的宿主；而且 `^0.2.1-alpha.4` 排除 `0.2.0-rc.2`，也就是本机 `dsh` 仍在运行的宿主。
- **改名而不加守卫。** 否决：它只在一条线上编译通过，在另一条线上坏掉，正是对齐门禁要拦下的漂移。
- **用类型转换代替守卫。** 否决：接缝遵循插件标准中「声明类型不携带的宿主能力」规则；转换会把下一次改名藏起来，而不是报告它。
- **不动 zod，转换投影 schema。** 否决：重复副本才是缺陷；转换只压住症状，第二份副本仍在。

## Consequences

- 改名表集中在一个模块。下一次宿主改名只需在那里加一个受守卫的成员，而不是把条件分支散进运行时。
- 两个名字都不存在的宿主会得到具名错误，而不是对 `undefined` 的属性访问。前台通道同样如此：两个一次性启动成员都不存在时，调用在任何子代理出现前就按名字被拒绝。
- zod pin 跟随宿主家族的精确 pin。宿主移动 zod 时这里必须同步移动，否则两份副本的类型失败会回来。
- 插件在已钉住的 `0.2.1-rc.2` 基线上编译通过、整套测试通过；接缝让 `0.2.0-rc.2` 继续可用，因为开发机上仍安装着该宿主。
- 0.2.1 还把子代理服务挂在 `workingDirectory` 之后，要求带 Agent 的 `run_code` 调用依赖它，因此每个挂载真实子代理服务的测试都改为向测试工具索取目录夹具。

## Related decisions

在通道问题上继续执行[从 prerelease 候选线解析对齐基线](../process/2026-09-23-next-channel-baseline.md)，并补上该决定隐含留白的代码侧容忍。
