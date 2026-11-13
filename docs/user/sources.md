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

A `local: true` source reads its directory in place. Removing its registration never deletes a directory outside the managed checkout root. An `archive` source downloads an HTTPS `.zip` / `.tar.gz` / `.tgz` / `.tar` payload (256 MiB cap, optional `sha256` integrity pin) and extracts it as the checkout.

## Discovery and refresh

Session startup and the resource panels read sources that contain installed suites. Globally disabled installs remain available for explicit session selection. Opening Market discovers all configured sources as needed. Concurrent readers share the work for each source.

| Source | When discovery runs | How to observe content changes |
| --- | --- | --- |
| Managed Git or archive | On the first read without a valid saved index. Later reads and restarts reuse the index. | Refresh that source. Git sources also check HEAD when their index first loads into the process. |
| Local or adopted | On demand, preferring installed suite directories for runtime reads. Discovery is cached for up to 30 seconds. | Read again after that window, or refresh the source immediately. |
| Project source or native Agent layout | On demand, using the project discovery freshness window. | Read again after that window; native layouts also require **Scan project Agent layouts**. |

Local and adopted sources save directory and manifest-entry locations as routing hints. Fresh discovery rereads the installed files and current inline configuration, rather than loading old declarations from those hints. Changes to the source routing manifests, a missing path or a suite identity that no longer matches fall back to full source discovery. Market browsing uses the full source layout.

Installing, enabling or switching a suite surface reuses source discovery. A source acquisition or refresh invalidates that source before its files change and rebuilds its index afterwards. Other source indexes remain reusable. Catalog reads schedule no background scans to keep discovery warm.

Startup does not fetch Git updates. Source refresh is explicit unless **Background source updates** is on. That setting updates configured sources every 6 hours; it is separate from checking local edits on a read. Use a local or adopted source for a working tree you edit yourself: refreshing a managed Git checkout fetches and resets it to the selected remote branch, while refreshing an adopted checkout leaves its files in place.

If an installed suite disappears from discovery, the source scan notes report it and its install record is retained. The runtime uses only suites it can still discover and validate.

Install, enable and surface switches answer as soon as their state is saved. The mounts that follow — MCP servers, hooks, commands, LSP servers — reconcile in the background and report through the status panels, so a switch is never held open by a service that is slow to start.

## Manual clones, adoption, and network tuning

Cloning from the UI times out on a restricted network? Clone the repository yourself into the checkout root (`~/.dsh/agent-plugins/.sources/<id>/`) — the market page lists it under **unregistered local checkouts** with a one-click **adopt** action that registers it in place, no re-clone and no rename. Deleting the source removes its registration and install records. If you also tick the delete-files option, the plugin can delete that source's `.sources/<id>/` directory, including an adopted checkout. External local directories are preserved. Adding a URL whose checkout already exists with a matching `origin` remote adopts it automatically instead of cloning a second copy. Adopted sources are ordinary sources in the UI — they carry no extra badge.

The source strip at the top of the market page is a row of pills that take the width of their labels, each capped so a long id ellipsizes instead of stretching the row: it folds to two rows with a bottom fade and expands as an overlay on hover or keyboard focus, so the card grid never moves; picking a source folds it again right away. The picked source moves next to `全部` so it stays visible while folded, and the rest keep their id order. The card grid pages itself: it renders the first 120 matches and appends the next page as you scroll to the end, or when you press **show more**, so a market of a thousand suites opens without mounting all of them.

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
