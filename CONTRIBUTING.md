# Contributing / 贡献指南

Thank you for helping improve `dsh-agent-plugins-market`.

感谢你帮助改进 `dsh-agent-plugins-market`。

This project brings Claude Code, Codex, Cursor, Kimi, and agent-plugins.org marketplace suites into DeepSeek Harness (DSH). Contributions are welcome across the host runtime, Web UI, documentation, tests, and plugin-layout fixtures.

本项目把 Claude Code、Codex、Cursor、Kimi 与 agent-plugins.org 的市场套件带入 DeepSeek Harness（DSH）。欢迎为宿主运行时、Web 界面、文档、测试和插件布局 fixture 提交改进。

## Before you start / 开始前

- Search existing issues and pull requests before opening a new one.
- For a reproducible defect, use the [bug report form](https://github.com/Sivan757/dsh-agent-plugins-market/issues/new?template=bug_report.yml).
- For a proposal, use the [feature request form](https://github.com/Sivan757/dsh-agent-plugins-market/issues/new?template=feature_request.yml).
- Never publish credentials, private marketplace URLs, session data, or unredacted logs. Read [SECURITY.md](SECURITY.md) before reporting a vulnerability.
- Keep one user-visible goal per pull request. Small, focused pull requests are easier to review and safer to merge.

- 提交新 issue 或 PR 前，请先搜索已有的 issue 和 PR。
- 可复现的问题请使用[问题报告表单](https://github.com/Sivan757/dsh-agent-plugins-market/issues/new?template=bug_report.yml)。
- 功能建议请使用[功能请求表单](https://github.com/Sivan757/dsh-agent-plugins-market/issues/new?template=feature_request.yml)。
- 不要发布凭据、私有市场 URL、会话数据或未脱敏日志；报告漏洞前请先阅读 [SECURITY.md](SECURITY.md)。
- 每个 PR 聚焦一个用户可感知的目标；小而集中的 PR 更容易审查，也更安全。

## Language / 语言

English and Simplified Chinese are both welcome in issues, pull requests, and documentation. For the clearest review, include a short English or Chinese summary when the rest of the discussion uses the other language. Source identifiers and API names should remain in their original form.

Issue、PR 和文档均可使用英文或简体中文。为了方便审查，如果讨论主体使用另一种语言，请补充一段简短的中英文摘要。源码标识符和 API 名称应保留原文。

## Local development / 本地开发

### Requirements / 环境要求

- Node.js 22 or later
- pnpm (the repository uses a pnpm workspace)
- Git
- DeepSeek Harness dependencies are installed from the checked-in lockfile

- Node.js 22 或更高版本
- pnpm（仓库使用 pnpm workspace）
- Git
- DeepSeek Harness 依赖通过仓库锁文件安装

### Setup / 安装

```sh
corepack enable
pnpm install
```

For a CI-equivalent install, use the frozen lockfile:

如需复现 CI 的严格安装环境，请使用 frozen lockfile：

```sh
pnpm install --frozen-lockfile
```

`pnpm install` also points git at the checked-in `.githooks/` directory, so the host dependency alignment gate runs on every commit and a stale `@deepseek-ai/dsh-*` pin cannot reach the branch release-please cuts a tarball from. When the host release line has moved, `pnpm run fix:host-alignment` rewrites `package.json` and `pnpm-workspace.yaml` to the new baseline; run `pnpm install` afterwards to refresh the lockfile.

`pnpm install` 还会把 git 指向仓库内的 `.githooks/`，使宿主依赖对齐门禁在每次提交时执行，陈旧的 `@deepseek-ai/dsh-*` 版本钉不会进入 release-please 用来产出 tarball 的分支。宿主发布线推进后，用 `pnpm run fix:host-alignment` 按新基线重写 `package.json` 与 `pnpm-workspace.yaml`，随后再跑一次 `pnpm install` 刷新锁文件。

### Repository map / 目录结构

- `src/` — TypeScript host modules and React client modules / TypeScript 宿主模块与 React 客户端模块
- `tests/` — Vitest tests and discovery fixtures / Vitest 测试与发现 fixture
- `docs/` — architecture decisions, design notes, and research / 架构决策、设计笔记与研究记录
- `docs-site/` — Astro documentation website / Astro 文档网站
- `.github/` — issue forms, pull request templates, ownership, and automation / issue 表单、PR 模板、代码所有者与自动化

The domain glossary in [CONTEXT.md](CONTEXT.md) and the staged architecture plan in [`docs/design/engineering-refactor-plan.md`](docs/design/engineering-refactor-plan.md) describe the project vocabulary and module boundaries.

[CONTEXT.md](CONTEXT.md) 中的领域词汇表，以及 [`docs/design/engineering-refactor-plan.md`](docs/design/engineering-refactor-plan.md) 中的分阶段架构计划，说明了项目术语和模块边界。

## Quality gates / 质量门禁

Run the focused checks that match your change, then run the full gate before opening a PR:

请先运行与改动相关的专项检查，再在创建 PR 前运行完整门禁：

| Command                         | Purpose / 用途                                                                                  |
| ------------------------------- | ----------------------------------------------------------------------------------------------- |
| `pnpm run typecheck`            | TypeScript host and client type checks / TypeScript 宿主与客户端类型检查                        |
| `pnpm run lint`                 | ESLint checks / ESLint 检查                                                                     |
| `pnpm run format:check`         | Prettier formatting check / Prettier 格式检查                                                   |
| `pnpm run check:architecture`   | Dependency-boundary check / 依赖边界检查                                                        |
| `pnpm run check:host-alignment` | Host dependency baseline check against the registry / 对照 registry 的宿主依赖基线检查          |
| `pnpm run fix:host-alignment`   | Rewrite pins and exclusions into alignment / 按基线重写版本钉与逃生舱条目                       |
| `pnpm run test:contract`        | Fast host/client contract tests / 快速宿主/客户端契约测试                                       |
| `pnpm run test`                 | Full Vitest suite / 完整 Vitest 测试                                                            |
| `pnpm run build`                | Published host and client artifacts / 发布用宿主与客户端构建产物                                |
| `pnpm run check:refactor`       | Typecheck, lint, format, contract, and architecture gate / 类型、Lint、格式、契约与架构综合门禁 |

The pull-request workflow runs the refactor gate, the full test suite, and the build automatically. A PR should not be considered ready while a required check is failing.

PR 工作流会自动运行重构门禁、完整测试和构建。任何必需检查失败时，PR 都不应标记为可合并。

## Change guidelines / 改动规范

### Host, catalog, and runtime / 宿主、目录与运行时

- A new plugin-layout dialect belongs in discovery/scanner code and fixtures; do not make the client or runtime parse source formats.
- Keep catalog discovery, install state, and enabled-suite derivation centralized. Avoid introducing a second source of truth.
- Keep MCP, command, and hook mounts separate because their host APIs and failure semantics differ.
- Preserve the stable package entry points, persisted `state.json` compatibility, and `/api/agent-plugins/*` routes unless a migration is explicitly designed and tested.

- 新插件布局方言应放在 discovery/scanner 代码和 fixture 中；不要让客户端或运行时解析源格式。
- 保持目录发现、安装状态和启用套件派生逻辑集中，避免引入第二个事实来源。
- MCP、命令和 hook 挂载应保持分离，因为它们的宿主 API 和失败语义不同。
- 除非明确设计并测试了迁移方案，否则请保持包入口、持久化 `state.json` 兼容性和 `/api/agent-plugins/*` 路由稳定。

### Client and contracts / 客户端与契约

- Browser-safe records belong in `src/contracts/`; client code must not import Node, Cordis, filesystem, or host implementation modules.
- Reuse shared view models and controls when market and MCP surfaces have the same mechanics.
- For UI changes, include a screenshot or a short recording in the PR when it helps reviewers understand the result.

- 浏览器安全的记录应放在 `src/contracts/`；客户端不得导入 Node、Cordis、文件系统或宿主实现模块。
- 市场页和 MCP 页存在相同交互机制时，请复用共享 view model 和控件。
- UI 改动如有助于审查，请在 PR 中附截图或简短录屏。

### Tests and fixtures / 测试与 fixture

- Add or update a regression test for every behavior change or bug fix.
- Keep third-party marketplace fixtures minimal and deterministic; do not add real credentials or network-dependent tests.
- Cover user and project dimensions separately when a change affects discovery or installation state.

- 每个行为改动或 bug 修复都应新增或更新回归测试。
- 第三方市场 fixture 应保持最小且确定，不要加入真实凭据或依赖网络的测试。
- 如果改动影响发现逻辑或安装状态，请分别覆盖用户维度和项目维度。

## Commit types / 提交类型

Conventional commit types drive automated versioning and the CHANGELOG through [release-please](https://github.com/googleapis/release-please). The full policy is [ADR-0002](docs/adr/0002-versioning-and-release-policy.md); the short version:

- **`feat:` / `fix:`** — user-visible behavior changes only. These bump the version and appear in the CHANGELOG, so they open a release PR.
- **`refactor:` / `test:` / `ci:` / `docs:` / `chore:` / `build:`** — everything else. Never write `fix(ci):` or `feat(ci):`: a scoped `fix` still bumps patch.
- CI, docs, and tooling changes never need a bumping type; the release workflow also ignores those paths.

If a commit message would look wrong in the CHANGELOG, it has the wrong type.

Conventional Commit 类型决定自动化版本号和 CHANGELOG（由 [release-please](https://github.com/googleapis/release-please) 驱动）。完整规则见 [ADR-0002](docs/adr/0002-versioning-and-release-policy.md)，简版：

- **`feat:` / `fix:`** — 仅限用户可见的行为变化。会升级版本并出现在 CHANGELOG 中，因此会打开 release PR。
- **`refactor:` / `test:` / `ci:` / `docs:` / `chore:` / `build:`** — 其余一切变更。不要写 `fix(ci):` 或 `feat(ci):`：带 scope 的 `fix` 仍会 bump patch。
- CI、文档、工具链变更不需要 bump 类型；发布工作流也忽略这些路径。

如果一条提交信息放在 CHANGELOG 里显得奇怪，那说明类型选错了。

## Pull request process / PR 流程

- Create a branch from `main` and keep the branch focused.
- Implement the change with tests and documentation where needed.
- Run the local quality gates listed above.
- Fill in [`.github/PULL_REQUEST_TEMPLATE.md`](.github/PULL_REQUEST_TEMPLATE.md), including the motivation, validation commands, and any compatibility or security impact.
- Open the PR and respond to automated checks and reviewer feedback.
- Squash or otherwise tidy fix-up commits when requested by the maintainer; do not rewrite a branch that someone else is actively reviewing without coordination.

- 从 `main` 创建分支并保持分支目标单一。
- 实现改动，并在需要时补充测试和文档。
- 在本地运行上面的质量门禁。
- 填写 [`.github/PULL_REQUEST_TEMPLATE.md`](.github/PULL_REQUEST_TEMPLATE.md)，说明动机、验证命令以及兼容性或安全影响。
- 创建 PR，并处理自动检查与审查意见。
- 维护者要求时再整理修复提交；未经沟通不要重写他人正在审查的分支。

## Generated artifacts / 构建产物

The published package ships built host and client artifacts under `lib/` and `client/`, generated by the `prepare` and `prepack` scripts. They are not committed. Do not hand-edit generated JavaScript or declaration files; after changing source code, run `pnpm run build` and confirm it succeeds.

发布包中 `lib/` 和 `client/` 下的宿主与客户端构建产物由 `prepare`、`prepack` 脚本生成，不纳入版本管理。不要手工编辑生成的 JavaScript 或声明文件；修改源码后请运行 `pnpm run build` 并确认构建通过。

## Security and responsible disclosure / 安全与负责任披露

Do not report vulnerabilities in a public issue. Use [SECURITY.md](SECURITY.md) and the private GitHub security-advisory channel instead. Review third-party plugin code before enabling it, and redact secrets from all examples and logs.

不要在公开 issue 中报告漏洞。请按照 [SECURITY.md](SECURITY.md) 使用 GitHub 私密安全公告渠道。启用第三方插件前请先审阅其代码，并对所有示例和日志中的秘密信息进行脱敏。

## Questions / 问题

For a usage question, first check the [README](README.md), [Chinese README](README.zh.md), and the [documentation site](https://sivan757.github.io/dsh-agent-plugins-market/). If the answer is not covered, open the appropriate issue form with a minimal reproducible example.

使用问题请先查看 [README](README.md)、[中文 README](README.zh.md) 和[文档站](https://sivan757.github.io/dsh-agent-plugins-market/)。如果仍未解决，请使用对应 issue 表单，并提供最小可复现示例。
