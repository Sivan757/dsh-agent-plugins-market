# Agent Note：`schemas/` 下的规范库，运行时不消费

Status: implemented

## 问题

[README.md](../../../../README.md) 的兼容性表格列出了十种插件布局，但仓库只为其中一种钉住了字段级契约：`schemas/1.0.0/` 下内置的 agent-plugins.org v1.0.0 schema。其余全部——Claude Code、Codex、Cursor、Kimi、`.plugin/` 通用约定，以及新调研的 ZCode、Qoder CLI、GitHub Copilot CLI——都只以 README 表格中的散文和 `docs/research/` 里零散事实的形式存在。这不足以回答方言变更真正会提出的问题：同时存在多个 manifest 时哪个优先、客户端读哪个 MCP 文件名、`source` 对象是否接受 `github`、以及任何一条事实的上游出处是什么。一次新增三种方言让缺口变得尖锐：其中两种（ZCode、Qoder）根本不发布 schema，第三种（GitHub Copilot）发布的 schema 属于另一个相邻格式。

## 决策

- **`schemas/` 下放两类文件，且这个区分必须显式。** `schemas/1.0.0/*.schema.json` 是唯一的**内置（vendored）** schema：由 `src/catalog/validate.ts` 在运行时加载，并从上游整体替换。其他每个目录放的都是扫描器**不读取**的**自撰参考契约**。`schemas/README.md` 在第一段和出处政策一节都写明这一点，避免维护者把参考 schema 误当成门禁。
- **每个方言一个目录，形态固定。** `<dialect>/plugin.schema.json`、`<dialect>/marketplace.schema.json`、`<dialect>/spec.md`。`agent-plugins/spec.md` 与 `skill-collection/spec.md` 不带 schema，前者复用 `1.0.0/`，后者没有 manifest 可校验。`tests/schemas.test.ts` 强制这一配对，避免将来新增方言时只落一半文档。
- **出处写在产物里，而不只写在散文里。** 每个自撰 schema 都带 `$comment`，写明来源与核对日期；每份 `spec.md` 开头列出核对日期、证据清单、上游 schema 状态，结尾列证据缺口。缺口是刻意保留的：ZCode 与 Qoder 的实机运行时与已发布文档在若干点上互相矛盾，掩盖这一点的契约比没有契约更糟。
- **自撰 schema 默认开放。** 客户端会忽略或剥离未知 manifest 字段，因此除上游封闭的 agent-plugins.org schema 之外，一律 `additionalProperties: true`。必填项与 `pattern` 只镜像已有文档或实现验证过的规则。
- **自撰 schema 不接入运行时校验。** 让扫描器按这些文件校验 Claude Code 或 Qoder manifest，会改变所有既有源的 fail-closed 行为，那是另一个决定，有自己的兼容面。这些 schema 描述客户端接受什么，扫描器保持原有的策略链规则。
- **Agent Plugins 标准在树里只保留一份。** `agent-plugins/spec.md` 记录已发布的跨厂商格式并指向 `1.0.0/`，不把 schema 复制进第二个方言目录。
- **替代性检查（supersession check）。** 没有活跃 Agent Note 拥有这份规范库。[README 信息结构](2026-09-08-readme-information-structure.zh.md)只拥有 README 的组织方式，保持活跃；它的兼容性表格继续作为面向用户的摘要，`schemas/` 则成为其背后的字段级契约。

## 考虑过的替代方案

- **写成一篇长的 `docs/standards/` 文档。** 写起来更省事，但既不能编译，也不能按方言引用，还要重述 schema 已经机械表达的字段表。仓库里 `docs/standards/dsh-plugin-development-standard.md` 面向的是另一类读者。
- **只写 markdown，不做 JSON Schema。** 被否决：仓库自身对「钉住的契约」的惯例就是 schema 文件；而且写 schema 的过程暴露了散文曾抹平的真实矛盾（ZCode 的顶层 `pluginRoot` 与 `metadata.pluginRoot`；Qoder 文档中的三种作用域与 CLI 的四种）。
- **内置 SchemaStore 的 Claude Code schema。** 它们由社区维护且相对文档已过期（生成于 2026-04-23，缺 `displayName`、`metadata`、`defaultEnabled`、`experimental`、`workflows`、`renames`）。内置它们等于把错误契约贴上上游标签。
- **把上游校验器（`scripts/validate.py`、Qoder 的 Zod bundle）搬进 schema。** 这样 schema 能按厂商自己的规则执行，但等于把实现复制进文档目录，且每次客户端发版都会过期。改为在 `$comment` 里记录观测到的版本。
- **为对称把 `1.0.0/` 移进 `agent-plugins/1.0.0/`。** 需要改 `src/catalog/validate.ts` 里的运行时路径常量与测试，且没有任何功能收益；内置目录保留原名与运行时角色。

## 后果

- 维护者改一个方言，现在要同步改三处：schema、`spec.md`、`$comment` 出处行。守卫测试只能发现缺文件，不能发现事实过期——时效性仍由评审负责，与兼容性表格的现状一致。
- `schemas/` 在 package 的 `files` 列表里，因此自撰契约会作为文档随包发布。它们是体积很小的 JSON 与 Markdown，代价是打包噪音，而非运行时行为。
- 上游什么都没发布的方言，现在有一份明确标注「自撰、非内置」的契约——对任何想把它当作厂商权威的人来说，这正是正确的信号。
- 证据缺口一节让 ZCode、Qoder、Kimi 与通用布局中未验证的部分，在使用点就能被看到，而不再埋在调研文档里。

## 验证

- `pnpm exec vitest run tests/schemas.test.ts`——5 个用例：schema 数量、每个 schema 都按 Ajv 2020-12 编译、`$id` 唯一且为绝对 URL、内置 id 与 `PLUGIN_SCHEMA_ID` / `MCP_SCHEMA_ID` 钉死、以及 spec 与成对 schema 的不变量。
- 每个自撰 schema 都先编译，再跑过取自所引仓库的真实 manifest（ZCode 的 `example-plugin` 与官方目录、Qoder 一方插件 `security-scan` 与 Apify 目录、Copilot 的 LSP 示例、Claude Code 文档示例与官方目录条目、Codex marketplace 夹具、Cursor 模板与 `vercel/vercel-plugin`、Kimi 文档示例、`vercel/vercel-plugin/.plugin/plugin.json`）。
- `pnpm run typecheck`、`pnpm exec eslint tests/schemas.test.ts`、`pnpm run test`（353 个用例）全部通过。
