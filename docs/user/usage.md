# Usage guide

English | [简体中文](usage.zh.md) | [README](../../README.md)

## Host requirements

The plugin configuration card carries this plugin's switches: **Scan project Agent layouts** (`scanProjectLayouts`, default off; see [project layouts](#project-layouts)), **MCP enhancement**, **Download region**, **Background source updates** (`autoUpdateSources`, default off; refreshes every configured source every 6 hours), and the **experience feedback tool**. The card stages what you pick and applies it when you press Save, so what is on screen is what saving writes; a setting marked **customized** also offers **Use default**, which hands that one setting back to the plugin. **Download region** starts on **Follow interface language**, and choosing it again clears your explicit choice.

Codex project MCP is read from `.codex/config.toml`. Its enabled flags, environment references, tool allow/deny lists and timeouts are preserved; unsupported fields are diagnosed. Project LSP is not mounted because the host registry is global; this plugin does not modify host APIs.

- Node.js 22 or later, a DSH Web profile and the host skill service (`ctx.skills`). Git sources require Git.
- The current package declares the DSH host packages it needs in the `^0.2.0-rc.1` range. This is a dependency declaration, not a verified minimum version for every feature or historical Web shell.
- Slash commands require the host command service. Role delegation requires agents, tools, LLM, subagents and persistence. Without Agent Teams, `subagent_role` returns a durable child by default (omitted/true); false waits for a foreground report. With Agent Teams, `spawn_teammate_role` and a compact role catalog replace that entry and guidance. It creates a fresh Team member using role instructions and model settings; native Team tools own messaging and tasks. Team mode additionally needs session query and system-prompt services and explicit user intent to use Teams.
- MCP uses the built-in bridge by default. Host-client compatibility mode additionally needs `@deepseek-ai/dsh-mcp-client`; hooks need `@deepseek-ai/dsh-hooks-claude-code`.
- LSP support installs and mounts its own `@deepseek-ai/dsh-lsp`, `dsh-lsp-stdio` and `dsh-tool-lsp` packages as soon as an enabled suite declares language servers, so no profile step is needed. The language-server executables themselves must be available on the machine.
- Host credentials are optional. Without that service, environment references resolve from the launch environment, and changes require a restart.

## Installation options

The recommended CLI command is in the [quick start](../../README.md#quick-start). Alternatively, install inside the profile:

```sh
pnpm add dsh-agent-plugins-market
```

On current DSH shells the market is a section of the settings page (**Settings → Agent Plugins Market**); an older shell that does not expose the plugin-settings seat shows it as a top-level page entry instead.

For a GitHub installation:

```sh
dsh plugin --profile <name> add github:Sivan757/dsh-agent-plugins-market
```

npm packages contain built `lib/` and `client/` artifacts. GitHub installs build them through `prepare` and require Node.js and pnpm on the installing machine.

If managing the profile manually, install the package and include `dsh-agent-plugins-market` in the profile's `dsh.profile.bundles` array, alongside its existing bundles. The package's `cordis.patch.yml` supplies the plugin row. Keep the dependency version written by your package manager.

## Configure marketplace sources

One source needs no configuration: the plugin presets a record for the first-party collection repository under the id `dsh-agent-plugins`. It is a Git source like any other — press **Refresh** to clone it and list its suites, then install, disable or remove it in the market page. Registration performs no network access, so a freshly registered source shows as not cloned until the first refresh; and like a source seeded through configuration, removing it is undone by the next activation.

Everything else you add yourself. Sources persist in `~/.dsh/agent-plugins/state.json`; cordis config seeds them (and re-adds missing ids on every boot):

```yaml
- id: dsh-agent-plugins-market
  config:
    sources:
      - { id: agent-plugins, url: 'https://github.com/Sivan757/agent-plugins.git' }
      - { id: claude-plugins-official, url: 'https://github.com/anthropics/claude-plugins-official' }
      - { id: knowledge-work-plugins, url: 'https://github.com/anthropics/knowledge-work-plugins' }
```

A `local: true` source reads the directory in place (live working tree; never deleted on removal). Discovery results are cached for up to 30 seconds and reused across install/enable/panel actions, so working-tree edits of local sources appear on the next cache refresh (any source mutation, the refresh button, or the 30 s TTL). Startup mounts and user skill listing scan only sources containing enabled installs; browsing the market still discovers all configured sources. Concurrent reads share discovery work. Startup does not fetch Git updates; source refresh is explicit unless **Background source updates** is on. An `archive` source downloads an HTTPS `.zip` / `.tar.gz` / `.tgz` / `.tar` payload (256 MiB cap, optional `sha256` integrity pin) and extracts it as the checkout.

Install, enable and surface switches answer as soon as their state is saved. The mounts that follow — MCP servers, hooks, commands, LSP servers — reconcile in the background and report through the status panels, so a switch is never held open by a service that is slow to start.

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

Plugin state lives under `~/.dsh/agent-plugins/`; setting `DSH_HOME` changes it to `$DSH_HOME/agent-plugins/`.

| Path under the root    | Contents                                                                 |
| ---------------------- | ------------------------------------------------------------------------ |
| `state.json`           | Configured sources and install state                                     |
| `.sources/<sourceId>/` | Source checkouts                                                         |
| `data/`                | Overrides, suite `${PLUGIN_DATA}` directories, feedback rate-limit stamp |

Content you author yourself lives in the shared Agent layout root, `~/.agents/` (`$DSH_AGENTS_HOME` overrides it) — the same directory shape this plugin reads from a project's `.agents/`:

| Path                   | Contents                                                         |
| ---------------------- | ---------------------------------------------------------------- |
| `skills/`              | Your skills: `<name>.md`, or the tool-authored `<name>/SKILL.md` |
| `commands/`            | Your command Markdown files, flat or nested in subdirectories    |
| `agents/`              | Your persona Markdown files, flat or nested in subdirectories    |
| `hooks.json`, `hooks/` | Command hooks, in `hooks.json` or `hooks/hooks.json`             |
| `mcp.json`             | MCP services added in the workspace (`mcpServers`)               |
| `lsp.json`             | LSP servers added in the workspace (`lspServers`)                |

User entries support `disabled: true` frontmatter to stop registration without deleting the file. The skills panel switches a skill by writing the harness's own `disable-model-invocation: true` with `user-invocable: false` — the one off state every reader of that file honors — and drops the older `disabled` key on the first switch. A skill in the `<name>/SKILL.md` spelling keeps whatever sits beside that document; deleting it from the panel removes the document only, never the `references/` or `scripts/` files another tool put there. A skill registers under the `name` its frontmatter declares — the name the panel shows — and one the harness reader would reject is listed under its file name, disabled, with the reason instead of joining the catalog. Commands forward their body to the model, replacing `$ARGUMENTS` with the invocation text. A command or persona in a subdirectory is named by its path (`git/commit`), or by the `name` its frontmatter declares, and a command registers under that name with each `/` flattened to `-`, so `/git-commit` invokes it. User personas appear in the dynamic [subagent catalog](agent-roles.md), not the skill or slash-command menus. `mcp.json` and `lsp.json` are read as local declaration files: `mcp.json` needs no `$schema`, so a service another tool wrote there is read as it stands. A service declared there mounts under its own key — `mcp__<server>__<tool>`, with no suite namespace in between — the same name that declaration carries in every other MCP client.

Project-dimension state and checkouts live under `<project>/.dsh/agent-plugins/`. Native layouts listed under [project layouts](#project-layouts) are read in place without install state. Project skills win same-name conflicts with installed user suites, and a skill you author under the Agent layout root wins over a suite skill of the same name. Rename an entry if it is shadowed.

### Project layouts

**Scan project Agent layouts** is off by default. With it on, the project a session runs in contributes its own resources; saving with it off removes every candidate below on the next discovery pass. Configured sources and installed suites are unaffected. Files are read in place and are never installed, rewritten or deleted.

Skill directories are read under `.claude`, `.agents`, `.codex`, `.cursor`, `.kimi`, `.zcode`, `.qoder` and `.github`. Portable Markdown agents are enabled for all of them except `.codex` and `.kimi`, whose TOML/YAML formats need separate adapters. Role execution resolves the calling session's project. Project commands, supported MCP servers and mapped command hooks register in each agent's scoped context and refresh on session startup or catalog changes.

MCP reads root `.mcp.json`, the `.agents` layout's `.agents/mcp.json`, `.cursor/mcp.json`, and the `mcpServers` tables in `.qoder/settings.json` and `.qoder/settings.local.json` (local keys override project keys). ZCode reads `mcp.servers` from `zcode.json` and `.zcode/config.json`. Codex reads `[mcp_servers.*]` from `.codex/config.toml` through `smol-toml`, preserving stdio/HTTP configuration, environment and header references, enabled flags, tool filters and timeouts; unsupported server options are diagnosed. Relative executables resolve from the project root.

Claude/Qoder settings hooks, the Agent layout's `.agents/hooks/hooks.json` or `.agents/hooks.json` (either a bare event table or a `hooks` key), and enabled ZCode configuration hooks use the bridge's supported command-event subset. The user Agent layout root is read through the same two file names, with no project directory: a user-level hook sees the calling session's workspace as `${CLAUDE_PROJECT_DIR}`. Validated hooks become private temporary runtime files that are removed on teardown; project files stay unchanged. Project LSP is diagnosed and not mounted: the host LSP registry does not isolate projects.

Unmanaged user checkouts do not become runtime installations just because they exist on disk. Adopt and install them explicitly. There is no file watcher; project discovery snapshots are cached for five seconds.

## Runtime and security

MCP details offer retry only for failed managed services or residual mounts, and OAuth reset only when the active backend supports it and the server does not supply its own Authorization header — a header-authenticated server has no browser authorization to restart. Retrying checks all managed services without clearing credentials, and rebuilds every live bridge so a service that stopped answering after being reported connected is re-verified. Reauthorization explicitly confirms grant removal and possible interruption. Unsaved configuration disables connection actions. Results are based on refreshed status, not HTTP success; missing credentials must be configured first.

### MCP configuration

Open **MCP services** for service configuration, credentials, overrides, authorization and retry actions. Suite details are read-only previews.

Remote services authorize on demand: a declaration that says nothing about `auth` still runs OAuth, and only when the server challenges the connection. Service details mark those rows **OAuth on by default**.

The **MCP enhancement** setting (`mcpEnhanced`, default `true`) selects the built-in bridge with stdio, Streamable HTTP / OAuth and legacy SSE. Turning it off selects the host client compatibility backend, which does not provide OAuth or SSE through this integration. Changing the setting remounts services.

Use references such as `"env": { "FOO_TOKEN": "${FOO_TOKEN}" }`. The service editor's **Credential configuration** group lists every secret the service carries — a reference the credential store answers, or a literal the document holds, which reads as configured and hidden rather than as an editable `[redacted]` string. The group is folded to one line stating how many are configured; opening it shows each secret — its name, where it is spent, and the control that writes the value, with a literal replaced in the document. One fold per secret, not two. The detail dialog reports the service and leaves credentials to the editor. Missing references block startup with `needs-credentials`. Host credential writes are write-only and do not put literal tokens into suite state or override JSON. Read-only launch-environment values must be changed before restarting DSH.

`mcp.json` uses strict schema validation and follows the agent-plugins specification's failure boundaries: a server entry that violates the schema is skipped while the rest of the file keeps working, and a file-level problem (an unrecognized or mismatched `$schema`) disables MCP for that suite with a diagnostic. Both published releases validate: `$schema` may name 1.0.0 or 1.1.0, and the two files of one suite must name the same release. Per-server client policy — OAuth authorization, tool allow/deny lists, timeout policies — is declared in the suite's [`com.deepseek.harness`](../../schemas/com.deepseek.harness/spec.md) namespace, not in `mcp.json`. Portable `mcp.json` values keep placeholder-like text literal: only `${PLUGIN_ROOT}` and `${PLUGIN_DATA}` expand, so a credential reference belongs in the MCP services panel or an override, where it resolves at mount time. `.mcp.json` (other layouts) supports common compatibility forms: top-level server maps, `http` / `local` transport aliases, omitted type inferred from `command`, and `${CLAUDE_PLUGIN_ROOT}`, `${CLAUDE_PLUGIN_DATA}` and `${NAME:-default}` placeholders. Invalid servers are diagnosed and skipped rather than started with partial configuration.

Path variables written in suite files resolve to real values at injection time: `${CLAUDE_PLUGIN_ROOT}` (and the Codex, ZCode and Qoder spellings) points at the suite checkout, `${CLAUDE_PLUGIN_DATA}` at that suite's data directory, `${CLAUDE_SKILL_DIR}` at the skill's own directory, and `${CLAUDE_PROJECT_DIR}` at the calling session's project directory. Skill bodies, slash commands, agent personas, LSP declarations and startup instructions all resolve them; the host bridge resolves the plugin root and project directory in hook commands, so a hook command never receives `${CLAUDE_PLUGIN_DATA}`. A project's own `.claude/` and similar native directories are not plugins, and the plugin variables in them stay as written.

`` !`command` `` in a skill body or slash command is dynamic context: the command runs in the session directory and its output replaces the placeholder, and a multi-line command goes in a ` ```! ` code block. A command that fails, times out or is cancelled aborts the whole invocation with the command's output instead of injecting half of it. A skill or command from an enabled suite therefore runs the shell commands it ships when you invoke it, so review a suite's contents before installing it.

### Hooks and LSP

Hooks use the bridge's mapped command-hook subset at SessionStart, UserPromptSubmit, PreToolUse, PostToolUse, Stop, SubagentStart and SubagentStop. This is not full Claude Code runtime compatibility.

LSP supports enabled suite declarations and directly configured servers through the same mount lifecycle. The plugin carries its own LSP packages, so the only thing a user supplies is the language-server executable; a missing executable, an invalid declaration, or an installation whose LSP packages fail to load each appear as a diagnostic. Previewing a declaration alone does not prove the server is running.

### Validation and execution

Source acquisition and manifest scanning do not establish that third-party code is trustworthy. Installing an enabled suite can start services or register executable hooks; review its contents first.

Git acquisition uses `execFile` without a shell; refresh uses shallow fetch/reset. A local-directory source pointing outside `.sources/` is never deleted; a checkout under `.sources/<id>` — adopted or self-acquired — is removed only when you delete the source and tick the delete-files option. Archives default to HTTPS, a 256 MiB limit and guarded extraction, with optional SHA-256 verification. Portable paths must stay inside the suite root, including after symlink resolution. Invalid manifests and mount failures are exposed as diagnostics. A stdio service or language server declares a command; when that command is a bare name the running Host cannot find — `npx` under a Finder-launched desktop app, whose `PATH` holds only the system directories — the plugin asks your login shell which directories it exports, appends the ones the current `PATH` lacks, and resolves again. The declared command is never rewritten, an explicit `env.PATH` is left exactly as declared, and every extension or failed lookup is reported in the diagnostic.

For vulnerability reports, follow the [security policy](../../SECURITY.md).

### Experience feedback

The `feedbackEnabled` setting defaults to `true`. When the host provides tools and settings, it enables the model-facing `report_market_issue` tool, which files an issue in this plugin's GitHub repository — through the `gh` CLI when it is installed and authenticated, otherwise through `GITHUB_TOKEN` / `GH_TOKEN`. With none of those available nothing is filed: the tool opens a prefilled "new issue" page in the browser and returns the complete issue text and link to the model, which hands them to you. Accepted submissions have a 60-second cooldown. Disable the setting in the plugin configuration card to unregister the tool.

The workspace tabs share a saved grid/list preference; search and filters remain resource-specific. Add and refresh are header actions. Every card carries its enable switch, MCP and LSP services included, so a service can be stopped without opening its detail. The market filters by install state; the other five surfaces filter by owner — user, plugin — and by switched-off entries, whose count is the number of rows that filter shows. MCP Add validates a JSON server declaration and persists it under `~/.agents/mcp.json`, then mounts it through the plugin bridge; LSP Add does the same into `~/.agents/lsp.json`. Invalid declarations and duplicate names are rejected. Existing host-owned MCP services remain observation-only.

### Resource detail editing

Details and editors share one dialog in three widths — 460px for a confirmation, 640px for a short form, 880px for a detail or an editor — constrained to the viewport. An editor opens at 80% of the window's height, so switching between its form and JSON views never resizes the window and a long document scrolls inside it; a detail dialog stays as tall as its content. A resource's card carries its identity line (name and owning tag) with its state as a colour rail on the leading edge, a two-line description or endpoint, and a source row naming the owning suite, with its actions on the identity row and revealed on hover or keyboard focus; opening it shows the overview, the description, and its contents grouped by surface, each row expanding in place. Markdown preview shows the frontmatter as authored above the rendered body; raw editing preserves unknown keys and comments, and the editor offers the source with line numbers and syntax highlighting, with a switch to the rendered draft beside its title. What saving does is stated beside the buttons, and a command's `argument-hint` has its own field beside the name. MCP forms choose the transport from a segmented control that states what each option configures, keep command, arguments, environment, URL and headers in the main body, and open from the card's edit action into a dialog of their own: the detail dialog reports the state, the capabilities and the credentials, and the editor changes the configuration. The editor shows one document — the portable definition under `mcpServers` plus this client's policy under `com.deepseek.harness` — so the form can cover the common fields while every other setting stays writable as JSON. A service you declared yourself keeps keys this client does not know exactly as written; a suite's packaged `mcp.json` stays closed to them. Creating a service opens that same form with the name as its one extra field, so a service reads the same before and after it exists, and anything the form has no field for stays writable in the JSON view, which shows the whole document; an **Advanced settings** disclosure — form view only, since the JSON view already holds everything it sets — carries the optional connection inputs — the working directory for a stdio server, a line stating that a remote server negotiates OAuth itself on the server's 401 challenge, and the tool-call and startup timeouts in milliseconds, with the value in force as the field's placeholder and a line naming it as your own setting, the suite's declaration or the built-in default. Leaving a timeout empty inherits it again, and only the fields you changed are written back. The host compatibility backend cannot enforce a startup timeout, so it fixes that field and offers a clear control when a value was stored earlier. A rejected save places each reason beside the field the API named. Environment variables and headers accept a pasted block of `KEY=VALUE` or `Key: Value` lines. LSP forms cover command, arguments, environment, extension mapping, initialization options and configuration, and follow the same split: its detail dialog reports, and its card carries the edit action. Invalid JSON, incomplete map rows and an out-of-range timeout remain editable but cannot be saved. Uninstalling a suite asks you to acknowledge what leaves the profile before the action is available.

The MCP service detail lists every tool with a checkbox. A checked tool is allowed; unchecking it stores a denial, which keeps the tool listed after the live registry drops it, so you can check it again. A tool the suite's own declaration limits is unchecked and fixed, and names the suite as the reason. A tool that advertises an input schema opens its parameter list from its name. The list shows the first eight rows with a count of the rest, offers a name filter once a server publishes more than eight, and expands on demand. It is read-only for a host-observed server and for one another MCP client mounts. A service detail opens on one status band that carries the whole state: the state dot and tags with the one recovery action the state offers (retry, re-authorize), the last operation's result, one sentence for the failure shape the plugin recognized (missing credential, refused connection, command not found, a taken seam, and so on), the recorded diagnostic with the messages under it behind a **Diagnostic details** disclosure, and the endpoint or command. The band's leading edge takes the same state colour as the card, and the title is the readable service name — a plugin service's key, a direct service's name — with the mount name shown beside the service key in the overview only when the runtime registers a different one. A reason the plugin cannot place is shown as recorded; the retry result says only whether the operation reconnected, and a failed service that registered no tools says the list needs a live connection.

`GET /api/agent-plugins/server-config?kind=mcp|lsp&id=...` returns the full editable configuration plus, for MCP, the policy view and the mount backend; `POST /api/agent-plugins/server-config/save` replaces that service config and takes an optional `policy: { toolCallTimeoutMs, startupTimeoutMs }` where a number sets a timeout and `null` clears it back to inheritance. `POST /api/agent-plugins/set-mcp-server-tool` takes `{ suiteId, serverKey, tool, enabled }` and stores the tool denial in the override record. Plugin MCP replacements persist in its existing override file; plugin LSP replacements persist in `data/lsp-overrides.json`. Checkouts stay untouched. Unchanged `[redacted]` fields preserve original secrets. Modified config remounts through the plugin runtime. Host-observed MCP remains read-only. `POST /api/agent-plugins/lsp-servers/add` creates one named direct service without replacing others.

## Format details and development

### Operation overlay

Visual feedback waits 200 ms and disappears when the last operation finishes, without a minimum visible duration. Reads stay interactive and use a nonblocking status card for longer waits. Mutations block repeated input immediately; only visible mutation feedback moves focus and sets inert state.

Workspace requests and credential/settings writes share `withBusyOperation` (`src/client/ui/busy-operation.ts`). Wrap a complete workflow when it also refreshes data afterward; nested leases keep the mask until every operation settles. A single body-level `BusyOverlay` tracks the active dialog rectangle, marks it inert, blocks backdrop/keyboard interaction and restores focus afterward. Tips rotate every 3.2 seconds; reduced-motion preferences disable the scrolling transition. Source-progress, model-catalog background loading and automatic LSP polling remain silent. The mask never occupies a row in the resource list and does not fabricate percentage progress.

Waiting never ends in silence: a mask that outlives 20 seconds says a local service may not be answering, reads stop waiting after 15 seconds, and mutations after a 10-minute backstop — a request that ran out of time is reported as such instead of holding the page.

A source may contain multiple layout dialects. Suite manifests and Marketplace catalogs follow the [same layout priority](../../README.md#layout-detection-precedence). Manifest selection tries the manifests in priority order; one that cannot be read or validated is diagnosed and the next one is tried, and a suite whose every candidate fails is rejected. Catalog scanning uses the first catalog that produces suites, with supported supplemental discovery; invalid or empty catalogs allow later candidates. Root `marketplace.json` is the final shared fallback. Remote-reference cards are not directly installable: add their repository as a source first.

The schemas in `schemas/1.0.0/` are vendored from [agent-plugins-spec](https://github.com/agentplugins/agent-plugins-spec), so validation does not download schemas at load time. See the [domain glossary](../../CONTEXT.md) and [contribution guide](../../CONTRIBUTING.md) for vocabulary and development checks.
