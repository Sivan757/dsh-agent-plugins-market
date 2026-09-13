# GitHub repository governance research

> 研究范围 / Scope: GitHub 官方文档与 GitHub 官方 Actions 仓库 README；结论用于本仓库 `Sivan757/dsh-agent-plugins-market` 的治理设计。检索日期：2026-08-20。
>
> 本仓库现有 `docs/` 采用短标题、分节、可复现/范围说明的 Markdown 风格；当前没有 `docs/research/` 目录，因此本文件是该目录下的首份研究记录。除本文件外未修改其他文件。本记录写于目录重组之前，其中的路径按当时的工作树状态保留。

## Executive conclusions / 核心结论

1. **社区健康文件集中放在 `.github/`，也可放仓库根目录。** GitHub 支持 `CONTRIBUTING.md`、`CODE_OF_CONDUCT.md`、`SECURITY.md` 等社区健康文件；组织级默认文件可为多个仓库提供 fallback，但仓库自身同名文件优先。推荐本仓库将贡献、行为准则、安全政策放在根目录或 `.github/`，并保持单一权威版本。[Creating a default community health file](https://docs.github.com/en/communities/setting-up-your-project-for-healthy-contributions/creating-a-default-community-health-file)
2. **Issue/PR 模板与配置是 `.github/ISSUE_TEMPLATE/` 和 `.github/PULL_REQUEST_TEMPLATE.md`。** Issue 模板支持 Markdown 模板（`.md`）和 Issue Form（`.yml`）；`config.yml` 控制模板选择页行为（例如空白 issue、外部链接）。PR 模板可以是根目录、`docs/` 或 `.github/` 下的 `PULL_REQUEST_TEMPLATE.md`，也可使用分目录模板；GitHub 在创建 PR 时预填内容，而不是强制字段验证。[About issue and pull request templates](https://docs.github.com/en/communities/using-templates-to-encourage-useful-issues-and-pull-requests/about-issue-and-pull-request-templates) · [Configuring issue templates](https://docs.github.com/en/communities/using-templates-to-encourage-useful-issues-and-pull-requests/configuring-issue-templates)
3. **Issue Forms 是结构化 YAML，不是普通 Markdown。** Form 顶层通常包含 `name`、`description`、`title`、`labels`、`assignees` 和 `body`；`body` 可用 markdown、textarea、input、dropdown、checkboxes 等元素。字段的 `validations.required` 可在提交前校验；因此 bug/feature 表单应只要求真正必要的信息，避免阻碍贡献。[Syntax for issue forms](https://docs.github.com/en/communities/using-templates-to-encourage-useful-issues-and-pull-requests/syntax-for-issue-forms)
4. **CODEOWNERS 决定自动 reviewer 请求，但不是合并权限本身。** 文件可放在 `.github/CODEOWNERS`、仓库根目录或 `docs/CODEOWNERS`；GitHub 按优先级使用其中一个，推荐 `.github/CODEOWNERS`。规则从上到下匹配，最后匹配规则生效；要让 code-owner review 成为合并要求，还需在 branch protection/ruleset 中启用 required review。[About code owners](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-code-owners)
5. **PR workflow 的 `pull_request` 与权限必须显式审视。** `pull_request` 默认响应 PR 活动（可用 `types`、分支过滤进一步收窄）；来自 fork 的 PR 通常以只读 `GITHUB_TOKEN` 且不提供 secrets，不能把不可信 PR 代码与写权限混在一起。推荐在 workflow 或 job 级写最小权限，例如 `permissions: contents: read`，需要评论/标签等写操作时仅给对应 scope；不要把 `pull_request_target` 用来 checkout 并执行不可信 PR 代码。[Workflow syntax](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax) · [Automatic token authentication](https://docs.github.com/en/actions/security-for-github-actions/security-guides/automatic-token-authentication) · [Events that trigger workflows](https://docs.github.com/en/actions/using-workflows/events-that-trigger-workflows)
6. **Dependabot 与 CodeQL 是可选但有价值的自动检查。** Dependabot 配置文件是 `.github/dependabot.yml`，可针对 `npm`、`github-actions` 等 ecosystem 配置 `directory`、`schedule`、`open-pull-requests-limit` 等；Actions 依赖更新尤其适合本仓库已有的 `actions/checkout`、`actions/setup-node`。CodeQL workflow 通常使用官方 `github/codeql-action`，应先按支持语言配置 build/init/analyze，再把结果纳入 code-scanning；两者应在项目实际风险和维护成本可接受时启用。[Dependabot options reference](https://docs.github.com/en/code-security/dependabot/dependabot-version-updates/configuration-options-for-the-dependabot.yml-file) · [Keeping your actions up to date with Dependabot](https://docs.github.com/en/code-security/dependabot/working-with-dependabot/keeping-your-actions-up-to-date-with-dependabot) · [github/codeql-action](https://github.com/github/codeql-action)

## Community health files / 社区健康文件

### `CONTRIBUTING.md`

GitHub 会在贡献者查看仓库贡献入口时发现该文件；它可位于仓库根目录、`.github/` 或 `docs/`。文件内容由项目维护者定义，适合写本地安装、测试命令、分支/PR 流程、提交规范和 review 期望。对本仓库而言，建议明确 `pnpm install --frozen-lockfile`、`pnpm run check:refactor`、`pnpm run test`、`pnpm run build`，并说明未经维护者批准不得 commit/push（这是项目协作约定，不是 GitHub 强制行为）。[Setting guidelines for repository contributors](https://docs.github.com/en/communities/setting-up-your-project-for-healthy-contributions/setting-guidelines-for-repository-contributors)

### `CODE_OF_CONDUCT.md`

行为准则文件可置于根目录或 `.github/`；GitHub 的 community profile 会识别它。可采用 Contributor Covenant 或自定义规则，但应给出适用范围、不可接受行为、报告渠道和执行流程。不要只添加模板而不填可用的 contact/报告方式。[Adding a code of conduct to your project](https://docs.github.com/en/communities/setting-up-your-project-for-healthy-contributions/adding-a-code-of-conduct-to-your-project)

### `SECURITY.md`

安全政策通常放在根目录或 `.github/SECURITY.md`。它应说明支持的版本、如何私下报告漏洞、响应时间/流程，以及是否有安全公告或披露策略；不要要求报告者把未修复漏洞公开发 issue。GitHub 会在仓库的 Security 入口展示该政策。[Adding a security policy to your repository](https://docs.github.com/en/code-security/getting-started/adding-a-security-policy-to-your-repository)

### `config.yml`

位置：`.github/ISSUE_TEMPLATE/config.yml`。它不是 Issue Form schema；它配置模板选择器，例如：

```yaml
blank_issues_enabled: false
contact_links:
  - name: Usage question
    url: https://github.com/Sivan757/dsh-agent-plugins-market/discussions
    about: Ask usage questions in Discussions.
```

`contact_links` 应链接到确实存在且受维护的入口；若仓库没有 Discussions，应不要照抄该示例。[Configuring issue templates](https://docs.github.com/en/communities/using-templates-to-encourage-useful-issues-and-pull-requests/configuring-issue-templates)

## Issue Forms and Markdown templates / Issue 模板

- Markdown 模板路径：`.github/ISSUE_TEMPLATE/<name>.md`；前置 matter 可设置 `name`、`about`、`title`、`labels`、`assignees`。[Syntax for issue templates](https://docs.github.com/en/communities/using-templates-to-encourage-useful-issues-and-pull-requests/syntax-for-issue-templates)
- Issue Form 路径：`.github/ISSUE_TEMPLATE/<name>.yml` 或 `.yaml`；应提供明确的 `description`，并以 `body` 结构化收集复现步骤、环境、日志和期望行为。[Syntax for issue forms](https://docs.github.com/en/communities/using-templates-to-encourage-useful-issues-and-pull-requests/syntax-for-issue-forms)
- `PULL_REQUEST_TEMPLATE.md` 可在 `.github/`、根目录或 `docs/`；多个模板可放 `.github/PULL_REQUEST_TEMPLATE/`，创建 PR 时通过 `?template=<file>` 选择。[About issue and pull request templates](https://docs.github.com/en/communities/using-templates-to-encourage-useful-issues-and-pull-requests/about-issue-and-pull-request-templates)

**Repo-specific recommendation / 本仓库建议：** 当前仓库没有 `.github/ISSUE_TEMPLATE/`、`config.yml` 或 PR template；只有 `.github/workflows/docs-pages.yml` 和 `quality.yml`。可先添加 bug report、feature request 两个模板和一个简短 PR checklist；但这是后续实现建议，本研究不代为创建。

## CODEOWNERS / 代码所有者

推荐路径：`.github/CODEOWNERS`。示例策略：

```text
* @Sivan757
/.github/ @Sivan757
/docs/ @Sivan757
```

CODEOWNERS 中的 owner 必须具有仓库访问权限；规则支持用户、团队和邮件地址等形式。注意 CODEOWNERS 本身包含潜在敏感的 reviewer ownership 信息，GitHub 建议将它放在受保护分支可审查的位置。仅添加文件不会自动阻止 merge；需要 branch protection/ruleset 的 required code-owner review。[About code owners](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-code-owners) · [Managing a branch protection rule](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches)

## PR workflow triggers and permissions / PR 工作流

当前 `.github/workflows/quality.yml` 使用：

```yaml
on:
  push:
  pull_request:
```

这意味着 push 与 PR 都触发 quality job，且没有分支/活动类型过滤。它执行 checkout、setup-node、pnpm install、质量检查、测试和 build。建议治理改进：

```yaml
permissions:
  contents: read

on:
  pull_request:
    types: [opened, synchronize, reopened]
  push:
    branches: [main]
```

若以后 workflow 需要写 PR comment、label 或 artifact，应只增加精确所需权限；`permissions` 一旦指定，未列出的权限为 `none`。对 fork PR，保持 `pull_request` 进行不需要 secrets 的 CI；避免把 fork 提交 checkout 后在 `pull_request_target` 上运行。官方 action 建议固定到受信任版本/sha，并使用最小 token 权限。[Workflow syntax](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax) · [Security hardening for GitHub Actions](https://docs.github.com/en/actions/security-for-github-actions/security-guides/security-hardening-for-github-actions) · [Using pull requests in workflows](https://docs.github.com/en/actions/using-workflows/events-that-trigger-workflows#pull_request)

## Optional Dependabot / CodeQL checks

### Dependabot

文件：`.github/dependabot.yml`。适合本仓库的起点：

```yaml
version: 2
updates:
  - package-ecosystem: npm
    directory: '/'
    schedule:
      interval: weekly
  - package-ecosystem: github-actions
    directory: '/'
    schedule:
      interval: weekly
```

这是建议配置，不代表已启用。`npm` 更新 lockfile/package dependencies；`github-actions` 更新 workflow 中 action 引用。启用前确认依赖 PR 有 CI、审查者和合理的 PR limit。[Configuration options for the dependabot.yml file](https://docs.github.com/en/code-security/dependabot/dependabot-version-updates/configuration-options-for-the-dependabot.yml-file) · [About Dependabot security updates](https://docs.github.com/en/code-security/dependabot/dependabot-security-updates/about-dependabot-security-updates)

### CodeQL

CodeQL 是 GitHub code scanning 的语义分析工具，官方 starter workflow 会按语言生成配置；JavaScript/TypeScript 等语言通常可纳入分析。启用时应选择与仓库语言匹配的官方 `github/codeql-action`，并让 `init`、（需要时）build、`analyze` 在同一 job 中运行。CodeQL 结果是否阻断 PR 取决于仓库 branch protection/ruleset，而非 workflow 文件单独决定。[About code scanning with CodeQL](https://docs.github.com/en/code-security/code-scanning/introduction-to-code-scanning/about-code-scanning-with-codeql) · [Configuring CodeQL workflow](https://docs.github.com/en/code-security/code-scanning/automatically-scanning-your-code-for-vulnerabilities-and-errors/configuring-codeql-workflow-for-compiled-languages) · [github/codeql-action README](https://github.com/github/codeql-action/blob/main/README.md)

## Repo-specific assessment / 本仓库现状

- **已有：** `.github/workflows/quality.yml` 的 PR CI 覆盖安装、refactor checks、测试和 build；使用 `actions/checkout@v4` 与 `actions/setup-node@v4`，Node 22，pnpm cache。
- **已有：** `.github/workflows/docs-pages.yml`（仅记录存在，不在本次研究中修改）。
- **缺少：** `CONTRIBUTING.md`、`CODE_OF_CONDUCT.md`、`SECURITY.md`、`.github/ISSUE_TEMPLATE/config.yml`、Issue Forms/Markdown templates、PR template、CODEOWNERS、`.github/dependabot.yml`、CodeQL workflow（基于本地文件扫描）。
- **优先级建议：** 先补 `CONTRIBUTING.md`、`SECURITY.md`、Issue/PR 模板和 `.github/CODEOWNERS`；随后在确认分支保护策略后收紧 workflow `permissions`/push 分支；Dependabot Actions 更新低成本，CodeQL 则在确认语言覆盖和告警处理责任后启用。
- **边界：** GitHub 文档描述平台行为；是否启用 branch protection、required reviews、security features、Dependabot 或 CodeQL 仍是仓库设置/维护流程决策，不能仅凭文件存在推断已生效。

## Source coverage and repo evidence / 来源覆盖与仓库证据

本笔记将平台行为与本地观察分开：平台行为均链接到直接的 GitHub 官方文档或 GitHub 官方 Action 仓库；本地仓库事实则链接到对应文件，避免把推断写成 GitHub 平台保证。

- **Existing PR CI / 现有 PR CI：** [`quality.yml`](../../../.github/workflows/quality.yml) 的实际配置是无过滤的 `push` 与 `pull_request`，并依次执行 `actions/checkout@v4`、`actions/setup-node@v4`（Node 22、pnpm cache）、Corepack、冻结依赖安装、`check:refactor`、测试和构建。关于这些 trigger 与权限语义，直接参见 [Workflow syntax](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax)、[Events that trigger workflows](https://docs.github.com/en/actions/using-workflows/events-that-trigger-workflows) 和 [Automatic token authentication](https://docs.github.com/en/actions/security-for-github-actions/security-guides/automatic-token-authentication)；关于 action 本身，参见官方 [`actions/checkout`](https://github.com/actions/checkout) 与 [`actions/setup-node`](https://github.com/actions/setup-node) 仓库。
- **Existing docs convention / 现有文档约定：** [`docs/developer/decisions/0001-catalog-centered-modular-refactor.md`](../decisions/0001-catalog-centered-modular-refactor.md) 与 [`docs/developer/design/engineering-refactor-plan.md`](../design/engineering-refactor-plan.md) 使用短标题、分节、范围/背景、可执行建议；[`docs/developer/design/rendering-baseline.md`](../design/rendering-baseline.md) 记录可复现的测量口径。该约定是本仓库本地事实，不是 GitHub 行为，因此不以 GitHub URL 冒充来源。
- **Current governance inventory / 当前治理清单：** 基于仓库当前工作树扫描，已有 [`docs-pages.yml`](../../../.github/workflows/docs-pages.yml) 与 [`quality.yml`](../../../.github/workflows/quality.yml)；其他治理文件缺失情况见上文。GitHub 对这些文件的标准路径和行为分别以各节所列官方 URL 为准。

## Official source index / 官方来源索引

- [GitHub Docs — community health files](https://docs.github.com/en/communities/setting-up-your-project-for-healthy-contributions/creating-a-default-community-health-file)
- [GitHub Docs — issue and pull request templates](https://docs.github.com/en/communities/using-templates-to-encourage-useful-issues-and-pull-requests/about-issue-and-pull-request-templates)
- [GitHub Docs — issue form syntax](https://docs.github.com/en/communities/using-templates-to-encourage-useful-issues-and-pull-requests/syntax-for-issue-forms)
- [GitHub Docs — code owners](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-code-owners)
- [GitHub Docs — Actions workflow syntax](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax)
- [GitHub Docs — automatic token authentication](https://docs.github.com/en/actions/security-for-github-actions/security-guides/automatic-token-authentication)
- [GitHub Docs — Dependabot configuration](https://docs.github.com/en/code-security/dependabot/dependabot-version-updates/configuration-options-for-the-dependabot.yml-file)
- [GitHub CodeQL Action repository](https://github.com/github/codeql-action)
