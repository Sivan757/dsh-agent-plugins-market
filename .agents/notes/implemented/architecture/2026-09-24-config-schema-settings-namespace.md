# Agent Note: Project plugin settings through the entry Config schema

Status: implemented

## Problem

The plugin registered its settings namespace at runtime: `apply` injected the host `settings` service and called `settings.register(ns, schema)`. On dsh 0.1.7 that call no longer exists — the settings service (`SettingsForms`) projects every loaded entry's `Config` schema into a namespace keyed by the profile entry id, and an entry without a `Config` export simply has no namespace. The market therefore vanished from `settings/describe`: the Plugins panel's `configForms.whileServed` watch never fired, the configuration entry never appeared, and the "项目布局 / 下载区域 / MCP 增强" controls were unreachable from the new UI.

## Decision

The entry exports a schemastery `Config` schema: the five market settings are declared volatile (the host updates their references in place on every change, emitting `loader/volatile-update`), and the startup fields stay plain. `MarketSettingsNamespace` no longer injects anything — it reads the volatile references and re-syncs its runtime reactions (MCP backend, project layouts, feedback tool, source updater) from a `loader/volatile-update` listener. The legacy `setBackend` HTTP route remains as an accepted no-op: the value now lives in the host settings document, edited from the Plugins panel.

The namespace id stays `dsh-agent-plugins-market` because the settings service keys namespaces by the profile entry id, which the bundle patch inserts under that name.

## Alternatives considered

- **Keep the runtime registration against the old host.** Rejected: `settings.register` is gone on 0.1.7, so the namespace could never appear on the running line.
- **Declare the five settings as non-volatile config.** Rejected: every switch flip would tear down and reload the whole plugin fiber, dropping live MCP mounts and session state for a toggle the host can apply in place.
- **Serve the card from a hand-rolled describe endpoint.** Rejected: it would fork the host's settings document, revision fencing, and redaction, all of which the host settings service already owns.

## Consequences

- The namespace follows the same lifecycle as every host-plane namespace: it appears in `settings/describe` only while the entry's fiber is active, and its revision fencing is the settings service's own.
- The host writes volatile values in place, so switches apply without an unload; the plugin's reactions re-read the references on `loader/volatile-update`.
- cordis moved to the host's ~4.0.4 line and schemastery to ^3.18.4 (the versions the profile actually runs); cosmokit is a direct dev dependency because the entry's exported Config type references it.

## Related decisions

The namespace id and the volatile-update reaction replace the runtime registration the 0.8.0 entry used, which the 0.1.7 settings service no longer exposes.
