---
title: Install the agent workspace in DeepSeek Harness
description: Step-by-step guide to install dsh-agent-plugins-market in a DSH profile from the Web GUI or a terminal, add a Claude Code marketplace repo as a source, and install plugin suites.
layout: doc
---

# Install the agent workspace in DeepSeek Harness {#install-the-agent-workspace-in-deepseek-harness}

This guide shows how to bring Claude Code, Codex, Cursor and Kimi plugin marketplaces into DeepSeek Harness (DSH) in a few minutes.

## Prerequisites

- Node.js 22 or later, and a DSH Web profile with the skill service
- Git for Git sources
- A terminal only for the command-line install path; the Web GUI path needs none

## Step 1 — Install the plugin

Open the DSH Web GUI, then install the plugin from the sidebar:

1. Open **Plugins** in the sidebar.
2. Press **Add plugin**.
3. Type `dsh-agent-plugins-market`, then press **Install**.

The same dialog accepts a GitHub repository address or a local directory path. Installing this way needs no terminal, because the npm package already contains built artifacts.

With a terminal, either command works instead:

```sh
# inside a dsh profile
pnpm add dsh-agent-plugins-market

# or via the dsh CLI
dsh plugin --profile <name> add dsh-agent-plugins-market

# or straight from GitHub
dsh plugin --profile <name> add github:Sivan757/dsh-agent-plugins-market
```

A GitHub install builds through `prepare` and needs Node.js and pnpm. The npm package does not.

## Step 2 — Restart dsh and open the market

Restart dsh, open the Web GUI, then go to **Settings → Agent Plugins**. Older shells may expose a top-level page entry instead. The plugin also appears on the sidebar's **Plugins** page, where you can switch it off or remove it.

## Step 3 — Add or refresh a marketplace source

The market lists one first-party source on first run. Press **Refresh** to fetch the suites inside it.

To bring in another marketplace, add its repository URL as a source, for example a Claude Code marketplace repo with `.claude-plugin/marketplace.json`. Source ids are assigned automatically.

## Step 4 — Install suites

Browse the card grid, open a suite for a preview of its skills, MCP servers, hooks and commands, then install it and ensure it is enabled. Managed checkouts live under `~/.dsh/agent-plugins/.sources/<sourceId>/` in the user dimension, or `<project>/.dsh/agent-plugins/.sources/<sourceId>/` in the project dimension.

## Step 5 — Verify and use it

- For a suite with skills, check the Skills tab, then type `/` in chat to find its user-invocable skills.
- For MCP, open MCP services and resolve connection or credential notices. Credentials and overrides are edited here; suite previews are read-only.
- Commands become slash entries. Role delegation through `subagent_run` uses a dynamic role catalog and requires host agents, tools, LLM and subagent services.
- LSP ships with the plugin — the language-server executable must be on PATH. Check LSP servers for diagnostics.

See the [user guide](/docs/install) for host requirements and configuration.

## Troubleshooting

- An installed plugin is not listed on the sidebar's **Plugins** page: restart DSH, then refresh that page.
- The market shows no suites after a refresh: check the source's scan notes in its card, then refresh again.
- Project-dimension MCP servers are not mounted, because DSH has no per-session tool scope; the project dimension covers skills and context.
- There is no file watcher. Local-source discovery caches results for up to 30 seconds; refresh the source to invalidate them. Project discovery has a separate five-second cache.
- Remote URL marketplace entries show as "remote reference" cards; add the target repo as a source to install them.
