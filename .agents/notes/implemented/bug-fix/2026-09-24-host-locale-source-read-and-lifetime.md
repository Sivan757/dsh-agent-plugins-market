# Agent Note: the host locale source reads the settings projection and lives with its fiber

Status: implemented

## Problem

Enabling the market plugin in the desktop application ended the host process:

```
dsh: fatal load failure: Error: cannot get required service "settings" in inactive context
    at readHostLocalePreference (…/dsh-agent-plugins-market/lib/runtime/host-locale.js:85:34)
    at (…/lib/index.js:51:35)
    at readLocalePreference (…/lib/runtime/host-locale.js:60:38)
    at loadHostLocale (…/lib/runtime/host-locale.js:74:38)
    at refreshHostLocale (…/lib/index.js:40:14)
    at Object.apply [as callback] (…/lib/index.js:46:10)
    at async Fiber._reload (…/@deepseek-ai/cordis/lib/index.js:1356:5)
```

The desktop then offered its startup-recovery dialog, and the "disable third-party plugins" choice renamed `cordis.patch.yml` to a `.bak-<timestamp>` file and reset the bundle list in `package.json`, dropping six patch entries and three experimental bundles.

The entry wired its locale source from the injection callback's context, and kept that reader in module state:

```ts
ctx.inject(['settings'], settingsCtx => {
  setHostLocaleSource(() => readHostLocalePreference(settingsCtx))
  refreshHostLocale()
})
```

The module outlives every plugin fiber in the host process, and so did the reader. A profile reload — the loader re-activating the entry fiber after an install or an enable — unloads the fiber that callback's context belongs to and runs `apply` again. The new `apply` refreshed the locale before re-registering the injection, so the first read after the reload went through the **previous** fiber's context: a property read walks an unloaded fiber, finds `settings` in its `inject` map with no implementation behind it, and throws. `refreshHostLocale` attached only a fulfilment handler (`void loadHostLocale().then(…)`), so the rejection reached `process.on('unhandledRejection')` — the harness's `installFailLoud` — which wrote `fatal load failure` and exited 1.

Reviewing that read surfaced a second defect underneath it. `readHostLocalePreference` called `settings.get('locale')`, and the pinned host line has no such method: harness `601d6761e4` (2026-09-21, contained in `dsh-v0.1.7-rc.1` and later) replaced the namespace getter with the configuration-form projection, so `SettingsForms` exposes `configure`, `describe`, `update`, `replace`, `prepareDocument` and `schema`. The optional call `settings?.get?.(…)` answered `undefined` on every host this plugin targets, and the `$DSH_HOME/settings.yaml` fallback was empty as well: `SettingsForms.importLegacyDocument()` renames that file to `settings.yaml.imported` once the loader settles. Host-facing copy stayed zh for every preference, while the module doc, the development standard and this note described a working settings-service read.

The tests missed both defects the same way. `tests/host-service-seam.test.ts` mounted a real Cordis tree, but its settings service invented a `get(namespace)` method, and `tests/host-locale.test.ts` passed a hand-built object with the same invented method: the suite stayed green while production read nothing.

## Decision

**The locale preference is the settings service's projection of the `locale` entry, and the wiring lives exactly as long as the fiber that installs it.**

`readHostLocalePreference(settings)` takes the service and reads `settings.describe()`, the projection of every active profile entry's live configuration, then the descriptor with `ns === 'locale'` and its `value.preference`. That is the surface the harness's own desktop shell reads the preference through (`apps/desktop/src/welcome-backend.ts`, `localePreference`). `settings/document-updated` carries the same namespace key, so a write is the re-read trigger.

The service is resolved with `ctx.get('settings')` from the entry's own context. The store answers for as long as the provider is active, independently of the reading fiber's lifetime and topology, so the read survives the reload that killed the host. `undefined` covers every absence — no settings service, the entry not active, no preference written, a value that is not a string — and the dictionary resolves that to zh.

`setHostLocaleSource(read)` installs a reader and returns the disposer that clears it, and the clear is identity-guarded: a reload that installs the newer reader before the older fiber's disposer runs keeps the newer wiring. The entry registers both halves as one effect, so the wiring lives exactly as long as the fiber that installed it and a throw later in `apply` cannot leave it behind:

```ts
ctx.effect(() => setHostLocaleSource(() => readHostLocalePreference(ctx.get('settings') as LocaleSettingsSource | undefined)), 'dsh-agent-plugins-market: host locale source')
refreshHostLocale()
ctx.inject(['settings'], () => {
  refreshHostLocale()
})
ctx.effect(
  () =>
    ctx.on('settings/document-updated', ns => {
      if (ns === LOCALE_SETTINGS_ENTRY) refreshHostLocale()
    }),
  'dsh-agent-plugins-market: host locale refresh'
)
```

`readLocalePreference()` is synchronous. The `$DSH_HOME/settings.yaml` parse, the `node:fs` read and the async `loadHostLocale` wrapper are gone, because the single source answers the value directly; `refreshHostLocale` binds the dictionary from it and invalidates the two skill providers. The injection callback that once carried the service stays as the trigger for a service that mounts after this plugin.

`LocaleSettingsSource` in `src/runtime/host-locale.ts` declares the slice of the service this module calls, next to the note that harness `601d6761e4` removed the getter it replaces.

## Alternatives considered

**Keep the reader on the injection callback's context, cleared from an effect inside that callback.** Rejected: it fixes the ordering while leaving the module state holding a captured context, and the property read that context is read through is what threw. `ctx.get` answers from the same store without the captured context, so the crash class disappears instead of being scheduled around.

**Keep the `$DSH_HOME/settings.yaml` fallback.** Rejected: the file does not exist on any pinned host, the harness renames it to `settings.yaml.imported` at first boot, and the parse was a hand-written regex over a document format this repository forbids hand-writing parsers for. The projection is the only source that can return a value.

**Declare `@deepseek-ai/dsh-settings` as a peer with its exact dev mirror, and type the read as its `SettingsForms`.** Held for the pin alignment: this repository's host pins still sit on `^0.1.7-rc.1` while the registry's `next` line is `0.1.7-rc.2`, so `pnpm run check:host-alignment` is red before this change and adding one package at either version deepens that drift. The declaration is the stronger guard and belongs with `pnpm run fix:host-alignment`; the local interface names the same `describe()` surface and cites the commit that removed the getter.

**Move the preference onto `CatalogPorts`, as `downloadRegion` already is.** Held: it would delete the module state outright, at the cost of a port member, a default and two call sites in `src/application`. The identity-guarded effect closes the concrete cross-generation hazard for less surface, and a third reader is the signal to take the port.

**Give `refreshHostLocale` a rejection handler.** Rejected: with the read synchronous there is no promise left to reject, so a handler would only hide a failure the read no longer produces.

## Consequences

A reload re-wires the source before its first read, so nothing in the locale path belongs to a fiber a profile reload disposes; the crash cannot recur through this path. The read returns the preference the host actually holds, which the previous code never did on the pinned line, and a settings write re-binds the dictionary without a reload. A host without a settings service keeps the zh default.

The read calls `describe()` per refresh rather than per translated string: the projection walks every active entry, which is heavier than the getter it replaced, so the entry re-binds on the settings event and application reads (region resolution, MCP status) take the wired reader once per call. Removing the file parse also removed the last asynchronous step in this path, which is why an unexpected failure now surfaces as a plugin load error instead of an unhandled rejection the host turns into an exit.

Supersession: [optional host services are read through the service store](2026-09-15-optional-host-services-read-through-the-service-store.md) owns the service-read rule and stays authoritative. This note records the lifetime half of that rule and the projection the locale read needs; neither note supersedes the other.

## Testing

`tests/host-service-seam.test.ts` mounts a real Cordis tree whose `skills`, `commands` and `settings` services come from sibling fibers, with the settings service shaped as the pinned host's projection (`describe()` returning the `locale` descriptor). It pins three things: the entry re-reads its locale after unloading and applying again with no unhandled rejection; the wiring is cleared when the entry unloads; and a `settings/document-updated` for another entry does not re-read while the locale entry's own change does. Reverting `src/` to the revision this note replaces fails both test files and reports the production `cannot get required service "settings" in inactive context` from `apply` during `Fiber._reload`.

`tests/host-locale.test.ts` pins the projection parse (locale entry, absent entry, non-string value, no service), the unwired answer, and the identity guard: a late disposer from an older wiring leaves a newer reader installed.
