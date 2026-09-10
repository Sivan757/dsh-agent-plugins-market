---
title: Vercel Plugin for AI Coding Agents
product: vercel
url: /docs/agent-resources/vercel-plugin
canonical_url: 'https://vercel.com/docs/agent-resources/vercel-plugin'
last_updated: 2026-07-29
type: reference
prerequisites:
  - /docs/agent-resources
related: []
summary: Install the Vercel plugin to give supported AI coding tools Vercel context, skills, specialist agents, slash commands, and lightweight session-start...
install_vercel_plugin: npx plugins add vercel/vercel-plugin
---

# Vercel Plugin for AI Coding Agents

The Vercel plugin gives [supported AI coding tools](#supported-tools) Vercel-specific context, skills, agents, and slash commands. The default installation keeps automation lightweight and activates session-start context only in empty directories and detected Vercel or Next.js projects.

<!-- docsgraph:related -->

## Related pages

> **For AI agents:** Follow these links to understand how this page connects to the rest of the Vercel ecosystem. For the full cross-link map (inbound, outbound, prerequisites, and semantic neighbors), see the .graph.md link below.

- [Vercel plugin is now available in Grok Build](https://vercel.com/changelog/vercel-plugin-is-now-available-in-grok-build?from=related&source_path=%2Fdocs%2Fagent-resources%2Fvercel-plugin&source_site=vercel-docs&relationship=related)
- [Vercel Plugin now available in Kimi Code CLI](https://vercel.com/changelog/vercel-plugin-now-available-in-kimi-code-cli?from=related&source_path=%2Fdocs%2Fagent-resources%2Fvercel-plugin&source_site=vercel-docs&relationship=related)
- [Vercel Plugin now available in VS Code and GitHub Copilot CLI](https://vercel.com/changelog/vercel-plugin-now-available-in-vs-code-and-github-copilot-cli?from=related&source_path=%2Fdocs%2Fagent-resources%2Fvercel-plugin&source_site=vercel-docs&relationship=related)
- [Vercel plugin now supported on OpenAI Codex and Codex CLI](https://vercel.com/changelog/vercel-plugin-openai-codex-and-codex-cli-support?from=related&source_path=%2Fdocs%2Fagent-resources%2Fvercel-plugin&source_site=vercel-docs&relationship=related)
- [How to build a browser agent that works behind a login](https://vercel.com/kb/guide/build-a-browser-agent?from=related&source_path=%2Fdocs%2Fagent-resources%2Fvercel-plugin&source_site=vercel-docs&relationship=related) — Build a browser agent with eve, Vercel Connect, and KERNEL managed auth that signs a user in through a human-in-the-loop
- [Build your own Slackbot with Vercel Connect](https://vercel.com/kb/guide/build-a-slack-bot-with-vercel-connect?from=related&source_path=%2Fdocs%2Fagent-resources%2Fvercel-plugin&source_site=vercel-docs&relationship=related) — Learn how to build your very own Slackbot with Chat SDK and AI SDK. Vercel Connect supplies runtime Slack tokens and for
- [Build a daily digest bot with Chat SDK and Workflow SDK](https://vercel.com/kb/guide/daily-digest-bot-with-chat-sdk-and-workflow-sdk?from=related&source_path=%2Fdocs%2Fagent-resources%2Fvercel-plugin&source_site=vercel-docs&relationship=related) — Build a daily digest bot that posts a daily digest of GitHub stats to Slack. Learn how to use Vercel Connect to set up S
- [Run recurring security reviews with deepsec on Vercel](https://vercel.com/kb/guide/deepsec-reviews-on-vercel?from=related&source_path=%2Fdocs%2Fagent-resources%2Fvercel-plugin&source_site=vercel-docs&relationship=related) — Learn how to run periodic security scans on your code with deepsec. Set up deepsec to review GitHub repositories and del
- [Build a web research agent with Workflow SDK](https://vercel.com/kb/guide/durable-web-research-agent-with-workflow-sdk?from=related&source_path=%2Fdocs%2Fagent-resources%2Fvercel-plugin&source_site=vercel-docs&relationship=related) — Build a web research agent that searches the web and returns a cited report. Powered by AI SDK and Workflow SDK, it jour
- [Introducing the Vercel plugin for coding agents](https://vercel.com/changelog/introducing-vercel-plugin-for-coding-agents?from=related&source_path=%2Fdocs%2Fagent-resources%2Fvercel-plugin&source_site=vercel-docs&relationship=related)
- [How to set up your Next.js project for AI coding agents](https://nextjs.org/docs/app/guides/ai-agents?from=related&source_path=%2Fdocs%2Fagent-resources%2Fvercel-plugin&source_site=vercel-docs&relationship=related) — Learn how to configure your Next.js project so AI coding agents use up-to-date documentation instead of outdated trainin
- [Getting started with Vercel](https://vercel.com/docs/getting-started-with-vercel?from=related&source_path=%2Fdocs%2Fagent-resources%2Fvercel-plugin&source_site=vercel-docs&relationship=related) — Install the Vercel CLI, add the Vercel Plugin or agent skills, and deploy your first project.

Full cross-link map for this page: [/docs/agent-resources/vercel-plugin.graph.md](/docs/agent-resources/vercel-plugin.graph.md?from=related&source_path=%2Fdocs%2Fagent-resources%2Fvercel-plugin&source_site=vercel-docs&relationship=graph)
<!-- /docsgraph:related -->

## Getting started

### Prerequisites

- [Claude Code](https://docs.anthropic.com/en/docs/claude-code), [OpenAI Codex](https://openai.com/codex), [Grok Build](https://x.ai/news/grok-build-cli), [Cursor](https://www.cursor.com), [GitHub Copilot](https://github.com/features/copilot), or [Kimi Code](https://kimi.com)
- Node.js 18 or later
- [Bun](https://bun.sh)

### Installation

```bash
npx plugins add vercel/vercel-plugin
```

The plugin installs Vercel context, skills, and a lightweight default hook profile.

### Usage

After installation, session context is injected automatically only for empty directories and detected Vercel or Next.js projects. You can invoke skills and commands directly when you want targeted guidance:

```text
/vercel-plugin:nextjs
/vercel-plugin:ai-sdk
/vercel-plugin:deploy prod
```

## What the plugin provides

| Component | Description |
| --- | --- |
| **Ecosystem graph** | A relational knowledge graph covering every Vercel product, library, CLI, API, and service, with decision matrices and cross-product workflows |
| **[28 skills](#available-skills)** | Deep-dive guidance for specific Vercel products, libraries, and workflows |
| **3 specialist agents** | Purpose-built agents for deployment, performance optimization, and AI architecture |
| **5 slash commands** | Quick actions for deploying, managing environment variables, bootstrapping projects, and more |

## Supported tools

| Tool                                                          | Status    |
| ------------------------------------------------------------- | --------- |
| [Claude Code](https://docs.anthropic.com/en/docs/claude-code) | Supported |
| [OpenAI Codex](https://openai.com/codex)                      | Supported |
| [Grok Build](https://x.ai/news/grok-build-cli)                | Supported |
| [Cursor](https://www.cursor.com)                              | Supported |
| [GitHub Copilot](https://github.com/features/copilot)         | Supported |
| [Kimi Code](https://kimi.com)                                 | Supported |

## How it works

After installation, the plugin keeps automatic behavior lightweight. Session-start activation runs only in empty directories and detected Vercel or Next.js projects, and Vercel skills are not auto-injected on every prompt or every tool call by default.

The skills remain available on demand, and the plugin includes the injection engine for targeted or future opt-in workflows.

### Default hooks

- **Session start context injection**: Injects a thin Vercel session context plus `knowledge-update` guidance for empty directories and detected Vercel or Next.js projects
- **Session start repo profiler**: Scans config files and dependencies to set likely-skill hints after the same activation check passes

## Available skills

The plugin includes 28 skills covering the Vercel ecosystem:

| Skill                   | Covers                                                                                                                                            |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ai-gateway`            | Unified model API, provider routing, failover, cost tracking, 100+ models                                                                         |
| `ai-sdk`                | AI SDK v6, including text and object generation, streaming, tool calling, agents, MCP, and embeddings                                             |
| `auth`                  | Authentication integrations for Clerk, Descope, and Auth0 with Marketplace provisioning                                                           |
| `bootstrap`             | Project bootstrapping, including linking, environment provisioning, database setup, and first-run tasks                                           |
| `chat-sdk`              | Multi-platform chat bots for Slack, Telegram, Teams, Discord, Google Chat, GitHub, and Linear                                                     |
| `deployments-cicd`      | Deployment and CI/CD workflows, including deploy, promote, rollback, `--prebuilt`, and CI files                                                   |
| `env-vars`              | Environment variable management, including `.env` files, `vercel env`, and OIDC tokens                                                            |
| `knowledge-update`      | Knowledge update guidance for the plugin                                                                                                          |
| `marketplace`           | Integration discovery and installation with `vercel install`, auto-provisioned environment variables, and unified billing                         |
| `microfrontends`        | Microfrontends on Vercel, including path routing, project composition, local development, and troubleshooting                                     |
| `next-cache-components` | Next.js 16 Cache Components, including PPR, `use cache`, cacheLife, cacheTag, and updateTag                                                       |
| `next-forge`            | The production SaaS monorepo starter with Turborepo, Clerk, Prisma or Neon, Stripe, and shadcn/ui                                                 |
| `next-upgrade`          | Next.js upgrades, codemods, migration guides, and dependency updates                                                                              |
| `nextjs`                | App Router, Server Components, Server Actions, Cache Components, routing, and rendering strategies                                                |
| `react-best-practices`  | React and Next.js performance guidance across component, data, and rendering patterns                                                             |
| `routing-middleware`    | Request interception before cache, rewrites, redirects, and personalization for Edge, Node.js, and Bun                                            |
| `runtime-cache`         | Ephemeral per-region key-value cache with tag-based invalidation across Vercel Functions, Routing Middleware, and Builds                          |
| `shadcn`                | shadcn/ui CLI usage, component installation, custom registries, theming, and Tailwind CSS integration                                             |
| `turbopack`             | The Next.js bundler, including configuration, HMR, and Turbopack versus Webpack guidance                                                          |
| `vercel-agent`          | AI-powered code review, incident investigation, SDK installation, and pull request analysis                                                       |
| `vercel-cli`            | Vercel CLI commands for deploy, env, dev, domains, cache management, MCP integration, and Marketplace provisioning with `vercel install`          |
| `vercel-connect`        | Vercel Connect guidance for scoped OAuth tokens, third-party services, MCP servers, Slack, GitHub, and Eve agent connections                      |
| `vercel-firewall`       | Vercel Firewall guidance for bot protection, WAF rules, attack challenge mode, and security configuration                                         |
| `vercel-functions`      | Vercel Functions, including Serverless, Edge, Fluid Compute, streaming, and Cron Jobs                                                             |
| `vercel-sandbox`        | Ephemeral Firecracker microVMs for running untrusted or AI-generated code safely                                                                  |
| `vercel-storage`        | Blob, Global Config, Neon Postgres, Upstash Redis, one-command Marketplace provisioning with `vercel install`, and migration from sunset packages |
| `verification`          | End-to-end verification across browser, API, data, and response flows                                                                             |
| `workflow`              | Workflow SDK, including durable execution, DurableAgent, steps, Worlds, and pause or resume flows                                                 |

## Specialist agents

The plugin includes three specialist agents:

| Agent                   | Expertise                                                                       |
| ----------------------- | ------------------------------------------------------------------------------- |
| `deployment-expert`     | CI/CD pipelines, deploy strategies, troubleshooting, environment variables      |
| `performance-optimizer` | Core Web Vitals, rendering strategies, caching, asset optimization              |
| `ai-architect`          | AI application design, model selection, streaming architecture, MCP integration |

## Slash commands

Use slash commands directly in your AI coding tool:

| Command                      | Purpose                                                           |
| ---------------------------- | ----------------------------------------------------------------- |
| `/vercel-plugin:bootstrap`   | Bootstrap a project with linking, env provisioning, and db setup  |
| `/vercel-plugin:deploy`      | Deploy to Vercel (preview or production)                          |
| `/vercel-plugin:env`         | Manage environment variables (list, pull, add, remove, diff)      |
| `/vercel-plugin:status`      | View project status, recent deployments, and environment overview |
| `/vercel-plugin:marketplace` | Discover and install Vercel Marketplace integrations              |

To deploy to production, pass `prod` as an argument:

```text
/vercel-plugin:deploy prod
```

## Telemetry

Prompt text and bash and tool-call telemetry are not collected.

Telemetry behavior:

- If `VERCEL_PLUGIN_TELEMETRY` is unset, the plugin sends a once-per-day `dau:active_today` event
- `VERCEL_PLUGIN_TELEMETRY=off` disables all telemetry, including the daily active event

To disable telemetry in shells that launch your AI coding tool:

```bash
export VERCEL_PLUGIN_TELEMETRY=off
```

```powershell
setx VERCEL_PLUGIN_TELEMETRY off
```

## Debugging

If the plugin is not behaving as expected, enable debug logging with `VERCEL_PLUGIN_LOG_LEVEL`:

```bash
export VERCEL_PLUGIN_LOG_LEVEL=debug
```

Available log levels:

| Level     | Description                                 |
| --------- | ------------------------------------------- |
| `off`     | No logging (default)                        |
| `summary` | High-level injection summaries              |
| `debug`   | Detailed matching and dedup information     |
| `trace`   | Full pipeline traces with timing breakdowns |

You can also run the built-in doctor command:

```bash
npx vercel-plugin doctor
```

The doctor command validates manifest parity, checks hook timeout risk, verifies dedup health, and reports skill map issues.

## Reporting issues

If a skill gives incorrect advice or injection does not fire when expected, file an issue on [GitHub](https://github.com/vercel/vercel-plugin/issues). Include:

- What you were building
- What the plugin injected, or did not inject. Enable debug logs with `VERCEL_PLUGIN_LOG_LEVEL=debug`
- What was wrong about it

---

[View full sitemap](/docs/sitemap)
