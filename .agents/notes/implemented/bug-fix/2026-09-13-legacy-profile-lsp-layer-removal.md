# Agent Note: Upgrading past the hand-written profile LSP layer

Status: implemented

## Problem

LSP became self-provisioned after 0.6.2 shipped ([self-provisioned LSP capability](../../architecture/2026-09-11-self-provisioned-lsp-capability.md)), and that change has a migration cliff that no amount of code inside the plugin can remove.

Before it, the README said the profile had to expose the LSP tool, so a user who wanted language servers added the layer by hand: profile dependencies on `@deepseek-ai/dsh-lsp` and `@deepseek-ai/dsh-tool-lsp` plus two `insert` rows in the profile's own `cordis.patch.yml`. `LspMountRegistry` now mounts both seams from this package's own copies, so on upgrade that leftover layer registers `service "lsp"` first and every mount fails with `seam-conflict` — the feature the user already had stops working.

The plugin cannot clear the obstruction itself. A profile's patch file is applied _after_ every bundle layer, so this package's own `cordis.patch.yml` can never disable or replace the row; only the user's file can. And the failure message was one line of prose naming "the profile", with no way to tell which of several profiles it meant or what to delete.

## Decision

A seam conflict is reported as a repairable upgrade step, not a dead end.

`findLegacyLspSeams()` reads `$DSH_HOME/profiles/*`, parses each `cordis.patch.yml` with the `yaml` document model, and reports the profiles whose `insert` rows name `@deepseek-ai/dsh-lsp` or `@deepseek-ai/dsh-tool-lsp`. A profile that merely _depends_ on the packages is not reported: a dependency registers nothing, so it cannot be the cause. `dsh.profile.bundles` entries naming one of the packages are reported, because a bundle layer can insert rows.

The conflict text now names the profile, the rows, and the absolute path of the file (`LspMountRegistry` takes the locator as an injectable dependency, defaulting to the real scan, so a test never inherits the machine's own profile). The LSP panel shows the same facts as a banner with one action, offered only while a conflict is actually on screen.

`migrateLegacyLspSeam()` performs the edit on the file the user wrote:

- The removal is driven by the YAML document model, not by re-serializing parsed data, so the user's comments and unknown keys survive. The document is re-emitted in the library's canonical indentation, so a hand-written file with mixed sequence indentation also comes back normalized — that is the one visible change beyond the removal, and the backup covers it. A patch entry emptied by the removal leaves the document; the `- id: <group>` form, which also carries configuration, keeps its other keys and loses only its `insert` list.
- The rewrite is verified before it is written: the result is reparsed, must contain no seam row, and must deep-equal the same removal computed independently from plain parsed data. Any mismatch aborts with the file untouched.
- The pre-edit content is written to `<patch>.bak-lsp-seam-<timestamp>` first, and both writes go through the harness `writeFileAtomic`. The timestamp carries no colons, and every path comes from `node:path`, so macOS, Linux and Windows behave identically.
- Profile dependencies are deliberately left alone. Dropping one means running pnpm, and a plugin must not spawn a package manager against a profile it is loaded into. They are reported instead.

The panel's action is per-profile even when several profiles carry the layer: it migrates the one it named, and lists the others rather than sweeping them. The confirmation carries the backup path, so the edit stays reversible, and the panel says whether a restart is needed — a profile whose `patchReload` is `live` unloads the layer itself, otherwise the host must restart.

## Alternatives considered

- **Adopt whatever seam the profile already registered.** Rejected: the profile's pin is whatever the old documentation said at the time — 0.1.2-rc.1 in the case that surfaced this — so adopting it runs an older service beside this package's stdio providers while the manifest claims the current baseline. Version-gating the adoption needs the registered service's version, which cordis does not expose, and the gate would help almost nobody: users who followed the old instructions are exactly the ones on the old pin.
- **Ship a two-release deprecation instead** (warn this release, fail next). Rejected: it leaves the broken state in place for a release with no repair path, then makes it worse. The conflict is being introduced by this change, so this change carries the fix.
- **Rewrite the profile's `cordis.patch.yml` automatically at startup.** Rejected: silently editing a file in the user's Harness home, on a profile the plugin cannot even name for certain, is exactly the kind of side effect that should need a click. The banner is the click.
- **Remove the stale profile dependencies too.** Rejected: it needs pnpm, and the plugin cannot know the profile's lockfile state. Removing the rows is sufficient — a dependency with no row registers nothing.
- **Drop the layer through the plugin's own bundle patch.** Rejected: impossible by construction, as the [self-provisioned LSP capability](../../architecture/2026-09-11-self-provisioned-lsp-capability.md) note already records. A bundle patch is applied first, so a `disabled:` row it writes is overwritten by the profile's later layer.

## Consequences

- Upgrading users get their language servers back in one click, with a backup and a verification step before any write, instead of hand-editing YAML in the Harness home.
- The plugin now reads files outside its own storage (`$DSH_HOME/profiles`), which it previously only did for `settings.yaml`. It reads them best-effort and writes exactly one file, only when asked.
- The scan runs only while a conflict is reported, not on every status poll, so a healthy profile pays nothing for it.
- A profile whose patch file does not parse is skipped rather than reported, so a user with a broken profile gets the generic conflict text rather than a migration offer.
- `dsh-lsp-stdio` is deliberately outside the removal set: it publishes no service, so a row for it cannot conflict and stays where the user put it.
