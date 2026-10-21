# Agent Note: 宿主子代理成员名只由一个模块拥有

Status: implemented

对[用一条宿主接缝跨两条宿主发布线](2026-10-16-cross-release-host-seam.md)的部分取代：改名表、受守卫的成员与 zod pin 仍按该记录执行。本记录取代它的归属声明，以及它对"下一次改名如何不触达用户"的回答。

## Problem

宿主会在版本之间改名或删除 `ctx.subagents` 的成员。插件本来就有带守卫改名表的接缝模块，却仍在角色路由的前台分支里发出裸调用 `host.subagents.start(...)`，而宿主 0.2.1 已删除该成员。传入 `run_in_background: false` 的用户会拿到裸 `TypeError`。

两个缺口造成了这件事。改名表只覆盖插件驱动的四个成员中的两个，因此 `start` 与 `registerProvider` 留在表外、也留在所有守卫之外。并且构建过程没有任何一步把表与宿主做比对：角色路由的 `AgentRoleHost` 是经类型转换拿到的本地接口，编译器从未见过宿主包，而测试用手写夹具，夹具携带的成员正是插件自己接口声明的那些。

## Decision

`packages/market-runtime/src/runtime/agents/subagent-seam.ts` 成为仓库中唯一写出宿主子代理成员名的模块。

- 导出一张表 `SEAM_MEMBER_ALTERNATIVES`，为每个被驱动操作列出全部拼写，首选拼写在前：

  | 操作               | 拼写（按优先级）                            |
  | ------------------ | ------------------------------------------- |
  | `oneShotChild`     | `start`、`startActivation`                  |
  | `continuableChild` | `startContinuable`、`startActivation`       |
  | `drainChildren`    | `drainContinuableChildren`、`drainChildren` |
  | `registerProvider` | `registerProvider`                          |

- 每个守卫都通过该表解析成员，因此守卫与测试不会读到不同的清单。某个操作的所有拼写都不存在的宿主会被拒绝，错误信息点名全部拼写。
- 每个操作导出一个适配器 `SEAM_ADAPTERS`，因此仅加入表却没有适配器的操作会在测试失败，而不是在用户会话中失败。
- `teammate-role-runtime.ts` 不再直接读该服务：provider 注册与释放调用改走接缝辅助函数，字段类型改为接缝而非宿主类。
- 两个测试执行该规则。`packages/market-runtime/test/host-seam-contract.test.ts` 从已安装宿主包读取 `Object.getOwnPropertyNames(SubagentRuntime.prototype)`，断言表中每个操作至少有一种拼写存在。`packages/market-bundle/test/repo/subagent-seam-ownership.test.ts` 扫描 `packages/*/src`，当接缝模块之外的文件读取或调用宿主子代理成员时失败。

dependency-cruiser 无法承载这条源码规则：它分析模块边，而不是属性访问。

## Alternatives considered

- **把缺失的成员加进既有表就停。** 否决。表的形状本来就是对的；失败的是没有任何东西把它与宿主比对，也没有东西阻止新调用点绕开它。那两个测试才是把约定变成门禁的部分。
- **用 dependency-cruiser 规则表达源码规则。** 因能力不足否决。`check:architecture` 管的是模块边，看不到某个模块解引用了某个服务的某个属性。
- **用一份提交进仓库的宿主清单做比对。** 否决。全量宿主包清单会随每次发布漂移，还需要生成器、刷新步骤和自己的过期规则。直接读插件驱动的那一个服务的原型就能回答这个问题。
- **把接缝转换成已安装宿主类，让编译器检查调用。** 否决。插件支持两条成员集不同的发布线，没有任何单一类类型能描述两者，而类型转换正是上一次漏掉的成因。

## Consequences

- 宿主删除或改名子代理成员时，契约测试在构建期失败，早于任何用户会话触达。
- 新增的调用点如果写出宿主成员名，归属测试会失败，因此接缝不会被意外绕开。
- 表是记录未来改名的唯一位置。某个成员从它操作的全部拼写中消失就是一次失败测试，而不是对 `undefined` 的静默解引用。
- 归属测试是文本扫描，因此已安装包自身的代码天然不在范围内：它只扫描本仓库源码。
- `registerProvider` 获得了此前没有的受守卫适配器。角色成员路径行为不变；缺少 provider 注册表的宿主现在会按名字被报告，而不是在属性读取上失败。
