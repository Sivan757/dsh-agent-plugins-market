# Sources

English | [简体中文](sources.zh.md) | [README](../../README.md)

**Guide:** [Install](install.md) · [Sources](sources.md) · [Resources](resources.md) · [Services](services.md) · [Translation](translation.md) · [Settings](settings.md) · [Workspace](workspace.md)

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

## Manual clones, adoption, and network tuning

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

A source may contain multiple layout dialects. Suite manifests and Marketplace catalogs follow the [same layout priority](https://sivan757.github.io/dsh-agent-plugins-market/compatible-plugins/#shared-layout-precedence). Manifest selection tries the manifests in priority order; one that cannot be read or validated is diagnosed and the next one is tried, and a suite whose every candidate fails is rejected. Catalog scanning uses the first catalog that produces suites, with supported supplemental discovery; invalid or empty catalogs allow later candidates. Root `marketplace.json` is the final shared fallback. Remote-reference cards are not directly installable: add their repository as a source first.

The schemas in `packages/market-catalog/schemas/1.0.0/` are vendored from [agent-plugins-spec](https://github.com/agentplugins/agent-plugins-spec), so validation does not download schemas at load time. See the [domain glossary](../../CONTEXT.md) and [contribution guide](../../.github/CONTRIBUTING.md) for vocabulary and development checks.
