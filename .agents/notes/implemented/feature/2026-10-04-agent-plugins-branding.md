# Agent Note: Localized Agent Plugins branding and bundle settings

Status: implemented

## Problem

The package needs a user-facing name and icon distinct from its technical npm identity. Registering its settings as plugins.item places a third-party bundle beside official plugins and creates a second configuration entry.

## Decision

The npm identity stays dsh-agent-plugins-market. The brand name stays on our own surfaces — the workspace tabs, the settings section label, and the READMEs. The exported locale resources now also carry meta.title, so the Installed card reads as the product; [the Installed card note](../bug-fix/2026-10-09-installed-card-brand-title.md) owns that reversal, which drops the description-only rule this note originally recorded. package.json points icon to the bundled 256px PNG, a transparent, scaled copy of the supplied artwork below the host's 256 KiB limit. The package files list includes both locale resources and the image.

The existing SettingsForm binding registers at plugins.bundle.config, keyed by the npm package name, rather than plugins.item. Configuration appears inside the installed bundle page. The settings workspace remains accessible under its localized brand name; label thunks and the host locale renderer update it without re-registration. Namespace, persistence keys, save/discard behavior, and technical identifiers remain unchanged.

This partially supersedes the placement described in [settings and card reuse](../architecture/2026-09-13-settings-and-card-ride-the-host.md). [The host form model](../architecture/2026-09-27-plugin-card-controller-onto-host-form.md) still owns form state and persistence behavior; its official-card summary is not used by the bundle configuration slot.

## Alternatives considered

**Put translated names in dsh.meta or module exports.** The published rc.2 host reads exported locale JSON resources without evaluating plugin code. Invented manifest fields would silently leave the technical package name on screen.

**Keep a standalone plugins.item card.** The published slot contract reserves that list for official settings entries. The keyed bundle slot provides the same form inside the installed package's own page.

**Embed the full-resolution image.** The supplied PNG exceeds the host icon limit. Resizing the same artwork preserves transparency and keeps the asset below that limit without changing the design.

## Consequences

No new runtime dependency or settings store is introduced. Metadata remains available when the plugin is disabled because the host reads packaged resources. The card shows the localized title; see [the Installed card note](../bug-fix/2026-10-09-installed-card-brand-title.md) for that reversal and for the duplicate id line it costs on the bundle's own row. Tests pin the exported descriptions, the localized titles, image dimensions and size, technical identity, slot ownership, and binding disposal. An isolated DSH profile verified the installed category, image loading, embedded settings, and live Chinese-to-English settings changes.
