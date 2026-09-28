# Agent Note：schema 子集本地移植退役，改用宿主发布的校验器

状态：已实现

## 问题

自建 MCP 桥接经 `json-schema-subset.ts` 准入服务器宣告的 `outputSchema`——这是 harness 校验器的一个收窄本地移植。它的成文前提是**范围**而非**可得性**：上游校验器 656 行携带 realm 安全的 JSON 内建与完整诊断，而桥接只需要一个判定——这份宣告的 schema 能否作为结构化输出骑上工具注册。移植件保留了契约（闭合关键字表、单标量 type、嵌套结构、不支持的关键字拒绝）配一个保守的结构检查。

这个说法过时于依赖图，而非正确性。移植写于 2026-09-01，当时 `@deepseek-ai/dsh-tools` 还不是本包声明的依赖；该包在 rc.1 对齐时进入 `dependencies`。2026-09-26 的复用审计随后确认校验器自 rc.2 起从包根发布——`assertSupportedJsonSchema`、带 `violations` 列表的 `JsonSchemaError`、以及 `JsonSchema*` 类型族——且宿主自己的 `dsh-mcp-client` 就在调用它。对已发布宿主能力的本地移植正是复用规则禁止的漂移，前提必须重审而不是默认沿用。

## 决策

移植件删除，桥接直接 import 宿主包。

`tools.ts` 保留 `supportedOutputSchema` 与其回退契约（宣告的 schema 落在支持子集之外时退化为无约束 JSON——即上游的失败模式），改由 `@deepseek-ai/dsh-tools` 的 `assertSupportedJsonSchema` 承担；`host-contract.ts` 的 `JsonSchemaNode` 取自同一包。依赖声明零变化：`dsh-tools` 已按宿主基线在 `dependencies` 里，替换不给消费方 profile 增加任何东西。

行为差异可以接受，因为替换在桥接关心的每条轴上都是超集：宿主校验器以同一闭合关键字表走查嵌套 schema 并拒绝移植件会拒绝的输入，累积全部违规而不是停在第一个，并覆盖移植件多出的两条保证——递归图报 `circular` 而不是无限递归，非对象根拒绝。以上是对实装 rc.2 实测的结果，不是假设。旧移植件特有的报错文案从来不是契约：没有任何调用方匹配它，钉子测试改为断言错误的类型与 `violations` 载荷。

## 已考虑的替代

- 在消息兼容 shim 后保留移植件。否决：那些文案没有消费者，为内部诊断写兼容代码是有成本无契约。
- 经桥接本地 re-export 模块再暴露宿主名字。否决（import 工效）：直接 import 在使用处陈述依赖，无论哪种方式复用账目行都会记录决策。

## 后果

门禁现在拥有这条规则，宿主侧收紧会经普通的依赖对齐流程到达桥接，而不是留下一份陈旧副本；214 行代码及其递归走查用例从本仓库移除。代价是移植件没有的一层耦合：钉子测试骑在宿主的错误词汇（`JsonSchemaError`、`violations`）上，上游重构该契约会在这里以测试失败的形式浮现、需要跟进而不是静默延续——而这正是复用规则希望失败指向的方向。

## 取代审计

移植件的理由活在 [MCP OAuth 整改方案](../../../../docs/developer/upstream-proposal/mcp-oauth-relocation-plan.md)的完成记录里，不在活动 note 中；该记录现已写明本决策，没有活动 note 被取代。方案里余下的缝清单（`scrubbedParentEnv`、credential key 语法）保持有意 port：宿主要么没有从可消费 subpath 导出，要么那条缝是词汇而非函数。[复用账目](../../../../docs/reference/reuse-manifest.md)行在同一次变更里从 `self-built` 翻为 `use-host`，退役行的 note 记录了这次替换。

## 测试

钉子测试（tests/mcp-schema-subset.test.ts）在实装包上钉住上游准入语义与 `JsonSchemaError`/`violations` 错误契约；桥接套件经 `syncTools` 端到端演练不支持 schema 的回退（33 例全绿），另有 typecheck、lint、prettier、复用门禁与完整 `check:refactor` 链。
