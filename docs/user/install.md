# Install and requirements

English | [简体中文](install.zh.md) | [README](../../README.md)

**Guide:** [Install](install.md) · [Sources](sources.md) · [Resources](resources.md) · [Services](services.md) · [Translation](translation.md) · [Settings](settings.md) · [Workspace](workspace.md)

## Host requirements

- Node.js 22 or later, a DSH Web profile and the host skill service (`ctx.skills`). Git sources require Git.
- The current package declares the DSH host packages it needs in the `^0.2.0-rc.2` range. This is a dependency declaration, not a verified minimum version for every feature or historical Web shell.
- Slash commands require the host command service. Role delegation requires agents, tools, LLM, subagents and persistence. Without Agent Teams, `subagent_role` returns a durable child by default (omitted/true); false waits for a foreground report. With Agent Teams, `spawn_teammate_role` and a compact role catalog replace that entry and guidance. It creates a fresh Team member using role instructions and model settings; native Team tools own messaging and tasks. Team mode additionally needs session query and system-prompt services and explicit user intent to use Teams.
- MCP uses the built-in bridge by default. Host-client compatibility mode additionally needs `@deepseek-ai/dsh-mcp-client`. Session-scoped hooks use the published hook protocol and require the host shell and session-projection services.
- LSP support installs and mounts its own `@deepseek-ai/dsh-lsp`, `dsh-lsp-stdio` and `dsh-tool-lsp` packages as soon as an enabled suite declares language servers, so no profile step is needed. The language-server executables themselves must be available on the machine.
- Host credentials are optional. Without that service, environment references resolve from the launch environment, and changes require a restart.

## Installation options

In the DSH Web GUI, open **Plugins** in the sidebar, press **Add plugin**, enter `dsh-agent-plugins-market`, then restart DSH. The same dialog accepts a repository address or a local directory. To install from a terminal instead, install inside the profile:

```sh
pnpm add dsh-agent-plugins-market
```

On current DSH shells the market is a section of the settings page (**Settings → Agent Plugins**); an older shell that does not expose the plugin-settings seat shows it as a top-level page entry instead.

For a GitHub installation:

```sh
dsh plugin --profile <name> add github:Sivan757/dsh-agent-plugins-market
```

npm packages contain built `lib/` and `client/` artifacts. GitHub installs build them through `prepare` and require Node.js and pnpm on the installing machine.

If managing the profile manually, install the package and include `dsh-agent-plugins-market` in the profile's `dsh.profile.bundles` array, alongside its existing bundles. The package's `cordis.patch.yml` supplies the plugin row. Keep the dependency version written by your package manager.
