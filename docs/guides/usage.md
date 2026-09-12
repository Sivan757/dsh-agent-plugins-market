# Usage guide

English | [简体中文](usage.zh.md) | [README](../../README.md)

## Host requirements

The plugin settings card includes **Scan project Agent layouts** (`scanProjectLayouts`, default on). Changes immediately invalidate native project discovery. The [project layout section](../../README.md#project-layout-switch) lists current directories and execution boundaries; configured source installation is independent of this switch.

Codex project MCP is read from `.codex/config.toml`. Its enabled flags, environment references, tool allow/deny lists and timeouts are preserved; unsupported fields are diagnosed. Project LSP is not mounted because the host registry is global; this plugin does not modify host APIs.

- Node.js 22 or later, a DSH Web profile and the host skill service (`ctx.skills`). Git sources require Git.
- The current package declares the DSH host packages it needs in the `^0.1.5-rc.2` range. This is a dependency declaration, not a verified minimum version for every feature or historical Web shell.
- Slash commands require the host command service. `subagent_run` role delegation requires agents, tools, LLM, subagent and session-persistence services; it starts a durable background child, applies the saved persona and any exact route the role declares, and returns the child id without waiting.
- MCP uses the built-in bridge by default. Host-client compatibility mode additionally needs `@deepseek-ai/dsh-mcp-client`; hooks need `@deepseek-ai/dsh-hooks-claude-code`.
- LSP support installs and mounts its own `@deepseek-ai/dsh-lsp`, `dsh-lsp-stdio` and `dsh-tool-lsp` packages as soon as an enabled suite declares language servers, so no profile step is needed. The language-server executables themselves must be available on the machine.
- Host credentials are optional. Without that service, environment references resolve from the launch environment, and changes require a restart.

## Installation options

The recommended CLI command is in the [quick start](../../README.md#quick-start). Alternatively, install inside the profile:

```sh
pnpm add dsh-agent-plugins-market
```

For a GitHub installation:

```sh
dsh plugin --profile <name> add github:Sivan757/dsh-agent-plugins-market
```

npm packages contain built `lib/` and `client/` artifacts. GitHub installs build them through `prepare` and require Node.js and pnpm on the installing machine.

If managing the profile manually, install the package and include `dsh-agent-plugins-market` in the profile's `dsh.profile.bundles` array, alongside its existing bundles. The package's `cordis.patch.yml` supplies the plugin row. Keep the dependency version written by your package manager.

## Configure marketplace sources

The published bundle does not preconfigure sources. The following is an optional example for your own profile.

Sources persist in `~/.dsh/agent-plugins/state.json`; cordis config seeds them (and re-adds missing ids on every boot):

```yaml
- id: dsh-agent-plugins-market
  config:
    sources:
      - { id: agent-plugins, url: 'https://github.com/Sivan757/agent-plugins.git' }
      - { id: claude-plugins-official, url: 'https://github.com/anthropics/claude-plugins-official' }
      - { id: knowledge-work-plugins, url: 'https://github.com/anthropics/knowledge-work-plugins' }
```

A `local: true` source reads the directory in place (live working tree; never deleted on removal). Discovery results are cached for up to 30 seconds and reused across install/enable/panel actions, so working-tree edits of local sources appear on the next cache refresh (any source mutation, the refresh button, or the 30 s TTL). Startup mounts and user skill listing scan only sources containing enabled installs; browsing the market still discovers all configured sources. Concurrent reads share discovery work. Startup does not fetch Git updates; source refresh is explicit. An `archive` source downloads an HTTPS `.zip` / `.tar.gz` / `.tgz` / `.tar` payload (256 MiB cap, optional `sha256` integrity pin) and extracts it as the checkout.

### Manual clones, adoption, and network tuning

Cloning from the UI times out on a restricted network? Clone the repository yourself into the checkout root (`~/.dsh/agent-plugins/.sources/<id>/`) — the market page lists it under **unregistered local checkouts** with a one-click **adopt** action that registers it in place, no re-clone and no rename. The directory itself is removed only if you later delete the source and tick the delete-files option. Adding a URL whose checkout already exists with a matching `origin` remote adopts it automatically instead of cloning a second copy. Adopted sources are ordinary sources in the UI — they carry no extra badge.

The source strip at the top of the market page is an equal-width grid of pills: it folds to two rows with a bottom fade and expands as an overlay on hover or keyboard focus, so the card grid never moves; picking a source folds it again right away. The picked source moves next to `全部` so it stays visible while folded, and the rest keep their id order.

Git/archive acquisition is tunable through the host config:

```yaml
- id: dsh-agent-plugins-market
  config:
    git:
      proxy: 'http://127.0.0.1:7890' # injected as git http/https proxy
      insteadOf: { 'https://github.com/': 'https://mirror.example/https://github.com/' }
      timeoutMs: 300000 # per git invocation (default 120000)
      cloneRetry: true # one automatic retry (default)
      fallbackTarball: false # retry a failed github.com clone as a codeload tarball download
      allowHttpArchives: false # permit plain-http archive URLs (intranet mirrors)
```

## Storage and discovery

The default root is `~/.dsh/agent-plugins/`; setting `DSH_HOME` changes it to `$DSH_HOME/agent-plugins/`.

| Path under the root    | Contents                                     |
| ---------------------- | -------------------------------------------- |
| `state.json`           | Configured sources and install state         |
| `.sources/<sourceId>/` | Source checkouts                             |
| `user/skills/`         | User-authored skill Markdown files           |
| `user/commands/`       | User-authored command Markdown files         |
| `user/agents/`         | User-authored persona Markdown files         |
| `data/`                | Runtime data, overrides and feedback records |

User entries support `disabled: true` frontmatter to stop registration without deleting the file. Commands forward their body to the model, replacing `$ARGUMENTS` with the invocation text. User personas appear in the dynamic [subagent catalog](agent-roles.md), not the skill or slash-command menus.

Project-dimension state and checkouts live under `<project>/.dsh/agent-plugins/`. Native layouts listed in the [project layout section](../../README.md#project-layout-switch) are read in place without install state. Commands, supported MCP and hooks mount under each agent. Hook normalization uses private temporary runtime files and never rewrites project settings. Project skills win same-name conflicts with installed user suites; user-panel skills have lower precedence than suite skills. Rename an entry if it is shadowed.

Unmanaged user checkouts do not become runtime installations just because they exist on disk. Adopt and install them explicitly. There is no file watcher; project discovery snapshots are cached for five seconds.

## Runtime and security

MCP details offer retry only for failed managed services or residual mounts, and OAuth reset only when the active backend supports it. Retrying checks all managed services without clearing credentials. Reauthorization explicitly confirms grant removal and possible interruption. Unsaved configuration disables connection actions. Results are based on refreshed status, not HTTP success; missing credentials must be configured first.

### MCP configuration

Open **MCP services** for service configuration, credentials, overrides, authorization and retry actions. Suite details are read-only previews.

The **MCP enhancement** setting (`mcpEnhanced`, default `true`) selects the built-in bridge with stdio, Streamable HTTP / OAuth and legacy SSE. Turning it off selects the host client compatibility backend, which does not provide OAuth or SSE through this integration. Changing the setting remounts services.

Use references such as `"env": { "FOO_TOKEN": "${FOO_TOKEN}" }`. Missing references block startup with `needs-credentials`. Host credential writes are write-only and do not put literal tokens into suite state or override JSON. Read-only launch-environment values must be changed before restarting DSH.

`mcp.json` uses strict schema validation. `.mcp.json` supports common compatibility forms: top-level server maps, `http` / `local` transport aliases, omitted type inferred from `command`, and `${CLAUDE_PLUGIN_ROOT}`, `${CLAUDE_PLUGIN_DATA}` and `${NAME:-default}` placeholders. Invalid servers are diagnosed and skipped rather than started with partial configuration.

### Hooks and LSP

Hooks use the bridge's mapped command-hook subset at SessionStart, UserPromptSubmit, PreToolUse, PostToolUse, Stop, SubagentStart and SubagentStop. This is not full Claude Code runtime compatibility.

LSP supports enabled suite declarations and directly configured servers through the same mount lifecycle. The plugin carries its own LSP packages, so the only thing a user supplies is the language-server executable; a missing executable, an invalid declaration, or an installation whose LSP packages fail to load each appear as a diagnostic. Previewing a declaration alone does not prove the server is running.

### Validation and execution

Source acquisition and manifest scanning do not establish that third-party code is trustworthy. Installing an enabled suite can start services or register executable hooks; review its contents first.

Git acquisition uses `execFile` without a shell; refresh uses shallow fetch/reset. A local-directory source pointing outside `.sources/` is never deleted; a checkout under `.sources/<id>` — adopted or self-acquired — is removed only when you delete the source and tick the delete-files option. Archives default to HTTPS, a 256 MiB limit and guarded extraction, with optional SHA-256 verification. Portable paths must stay inside the suite root, including after symlink resolution. Invalid manifests and mount failures are exposed as diagnostics.

For vulnerability reports, follow the [security policy](../../SECURITY.md).

### Experience feedback

The `feedbackEnabled` setting defaults to `true`. When the host provides tools and settings, it enables the model-facing `report_market_issue` tool. With `GITHUB_TOKEN` or `GH_TOKEN`, submissions create issues in this plugin's GitHub repository; otherwise they are saved under `data/feedback/`. Submissions have a 60-second cooldown. Disable the setting in the plugin configuration card to unregister the tool.

The workspace tabs share a saved grid/list preference; search and filters remain resource-specific. Add and refresh are header actions. MCP Add validates a JSON server declaration and persists it under `~/.dsh/agent-plugins/data/mcp-servers.json`, then mounts it through the plugin bridge. Invalid declarations and duplicate names are rejected. Existing host-owned MCP services remain observation-only.

### Resource detail editing

Details use a shared 1120px maximum-width dialog, constrained to the viewport. Markdown preview separates YAML frontmatter from the rendered body; raw editing preserves unknown keys and comments. MCP forms cover transport, command, arguments, working directory, environment, URL, headers and OAuth; LSP forms cover command, arguments, environment, extension mapping, initialization options and configuration. Invalid JSON and incomplete map rows remain editable but cannot be saved.

`GET /api/agent-plugins/server-config?kind=mcp|lsp&id=...` returns the full editable configuration; `POST /api/agent-plugins/server-config/save` replaces that service config. Plugin MCP replacements persist in its existing override file; plugin LSP replacements persist in `data/lsp-overrides.json`. Checkouts stay untouched. Unchanged `[redacted]` fields preserve original secrets. Modified config remounts through the plugin runtime. Host-observed MCP remains read-only. `POST /api/agent-plugins/lsp-servers/add` creates one named direct service without replacing others.

## Format details and development

### Operation overlay

Visual feedback waits 200 ms, then stays visible for at least 400 ms. A 100 ms settling window bridges consecutive requests. Interaction locks immediately, including during the invisible delay; short operations therefore finish without a flash.

Workspace requests and credential/settings writes share `withBusyOperation` (`src/client/ui/busy-operation.ts`). Wrap a complete workflow when it also refreshes data afterward; nested leases keep the mask until every operation settles. A single body-level `BusyOverlay` tracks the active dialog rectangle, marks it inert, blocks backdrop/keyboard interaction and restores focus afterward. Tips rotate every 3.2 seconds; reduced-motion preferences disable the scrolling transition. Source-progress, model-catalog background loading and automatic LSP polling remain silent. The mask never occupies a row in the resource list and does not fabricate percentage progress.

A source may contain multiple layout dialects. Suite manifests and Marketplace catalogs follow the [same layout priority](../../README.md#layout-detection-precedence). Manifest selection uses the first existing file; invalid manifests produce diagnostics without trying a lower-priority manifest. Catalog scanning uses the first catalog that produces suites, with supported supplemental discovery; invalid or empty catalogs allow later candidates. Root `marketplace.json` is the final shared fallback. Remote-reference cards are not directly installable: add their repository as a source first.

The schemas in `schemas/1.0.0/` are vendored from [agent-plugins-spec](https://github.com/agentplugins/agent-plugins-spec), so validation does not download schemas at load time. See the [domain glossary](../../CONTEXT.md) and [contribution guide](../../CONTRIBUTING.md) for vocabulary and development checks.
