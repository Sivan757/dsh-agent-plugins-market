---
title: FAQ
description: Frequently asked questions about using Claude Code, Codex, Cursor and Kimi plugins inside DeepSeek Harness with dsh-agent-plugins-market.
layout: doc
---

# FAQ {#faq}

## Why is an installed skill or tool missing?

Check that the suite and its capability are enabled. Skills may restrict manual invocation. MCP and LSP panels report missing credentials, dependencies and mount failures. Project-scoped MCP is not mounted.

## Why does the market list a source before I add one?

The plugin presets one source record pointing at its own suite collection, so the market lists that repository on first run. Press **Refresh** to fetch its suites. It behaves like any other source from there on, including removal, which the next activation undoes.

## Where do I configure MCP credentials?

Open the service in **MCP services**. Suite details are read-only previews. Missing references show `needs-credentials`; launch-environment credentials require an environment change and a DSH restart.

## How do I add a service that no suite declares?

Use **Add** in **MCP services** or **LSP servers**. The declaration is validated, stored in `~/.agents/mcp.json` or `~/.agents/lsp.json`, and mounted through the same lifecycle as suite services. Host-observed services stay read-only.

## Which MCP transports are supported?

The built-in bridge supports stdio, Streamable HTTP with OAuth, and legacy SSE. Turning off MCP enhancement selects the optional host-client compatibility backend, without OAuth or SSE through this integration.

## What if a source download fails?

Use a local directory, adopt a manual checkout, or configure a proxy or mirror. See the [source configuration guide](/docs/sources#configure-marketplace-sources).

## Do sources refresh automatically?

Only when **Background source updates** is on. Every configured source is then refreshed every 6 hours, starting one interval after you enable the switch. The switch is off by default, and the refresh button always works.

## When do local edits become visible?

There is no file watcher. Local-source discovery caches results for up to 30 seconds; refresh the source to invalidate them. Project discovery has a separate five-second cache. An already-open page does not automatically refresh.

## Does removing a source delete files?

Only when you tick **also delete the managed market directory** in the confirmation. That removes the checkout under `.sources/<id>` — including one you cloned yourself and adopted. A local-directory source pointing outside `.sources/` is never deleted.
