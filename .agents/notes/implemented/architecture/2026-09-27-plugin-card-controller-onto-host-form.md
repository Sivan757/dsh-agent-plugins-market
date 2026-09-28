# Agent Note: The plugin settings card controller retires onto the host settings-form model

Status: implemented

## Problem

The `plugins.item` settings card was driven by a hand-built controller (`src/client/features/settings-card/plugin-card-controller.ts`, 348 lines): per-field staging with an explicit save, a revision fence that guards writes when the server snapshot moved under the editor, draft retention across a failed save, and unset-as-field-removal. It was built on 2026-09-13 because the published packages then shipped only the `ConfigForm` scope service and primitive atoms — no form model — so the card had to be rebuilt against the contract. The credential editor (`McpCredentialEditor.tsx`, write-only flow) repeated part of that modeling.

rc.2 removed the premise: `@deepseek-ai/dsh-client-ui-primitives` now publishes the settings-form group from the public index — `SettingsFormModel`, `SettingsFieldSpec`, the `settingsNumberField`/`settingsTextField` factories, `SettingsForm`/`SettingsFormShell`/`SettingsFormActions`, and `SettingsSecretField`/`SettingsValueField` — and the model covers the same semantics point for point: staged edits, revision-fenced saves, draft retention on failure, unset reset. Maintaining a private twin of a published model is the drift the reuse rule forbids.

## Decision

The controller is retired onto the host model. `src/client/features/settings-card/market-card-form.ts` binds the market's `ConfigForm` scope to `SettingsFormModel` with one custom `SettingsFieldSpec` per field — the card edits four booleans and the `downloadRegion` enum, none of which is text, so each spec's draft text is the value's wire spelling (`true`/`false`, the region word) and an unparsable draft blocks the save. The page view renders inside the host's `SettingsForm` frame: the read-only notice, the save control, and the failure echo are the frame's; the market keeps only its own rows. Booleans ride the host `Switch` atom and the region rides the host `SegmentedControl` atom, both wired to the model's `edit`/`resetField`; the overridden badge with its reset is carried over. The live host-client probe stays browser-local knowledge riding the projection, and the compat-mode guard (`mcpEnhanced` off while the host client is missing, or while the probe read that would answer is still in flight — a read that failed leaves it permissive) folds into the projected `invalid`, so it disables the save in every window where the deployment's client is not known to exist. `McpCredentialEditor.tsx` is replaced by `McpCredentialFields.tsx`, whose controls are `SettingsSecretField` and whose write-once guarantee is `SettingsSecretSpec.write` — the literal crosses the wire once and never re-enters state. A staged edit staged mid-save is refused, so the save's success clearing the staged map cannot wipe a newer edit.

## Consequences

- **Leaving the page drops staged edits.** The host frame calls `onDiscard` on unmount and offers no discard control of its own; the card adopts that as the slot standard and renders its own discard affordance only while edits stand.
- **The summary view follows the shell.** A namespace that is not served now hides the one-liner too, matching the frame's unavailable line instead of the old unconditional render.
- The reuse-manifest rows for the controller and the credential editor are `use-host`, citing `SettingsFormModel` and `SettingsSecretField`.
- Custom specs for boolean/enum fields are the one deliberate deviation in shape: the published factories target text and number inputs, so the market binding carries its own two spec builders rather than forcing the controls into text boxes.
- The 2026-09-13 settings-and-card note remains the anchor for the slot seat and the scope service; this note covers only the controller retirement.

## Alternatives considered

- Adopt only `SettingsSecretField` and keep the controller. Rejected: the secret field binds the `SettingsFormModel` lifecycle and is not usable standalone, so this is the all-or-nothing half of the same migration.
- Wait for `ConfigField` to enter the public index. Rejected: the model group is importable today and covers the card's fields; `ConfigField` is a primitive-level piece worth one re-evaluation only if the spike fails.
