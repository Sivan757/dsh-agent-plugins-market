# Agent Note: The plugin settings card controller retires onto the host settings-form model

Status: proposed

## Problem

The `plugins.item` settings card is driven by a hand-built controller (`src/client/features/settings-card/plugin-card-controller.ts`, 348 lines): per-field staging with an explicit save, a revision fence that guards writes when the server snapshot moved under the editor, draft retention across a failed save, and unset-as-field-removal. It was built on 2026-09-13 because the published packages then shipped only the `ConfigForm` scope service and primitive atoms — no form model — so the card had to be rebuilt against the contract. The credential editor (`McpCredentialEditor.tsx`, write-only flow) repeats part of that modeling.

rc.2 removes the premise: `@deepseek-ai/dsh-client-ui-primitives` now publishes the settings-form group from the public index — `SettingsFormModel`, `SettingsFieldSpec`, the `settingsNumberField`/`settingsTextField` factories, `SettingsForm`/`SettingsFormShell`/`SettingsFormActions`, and `SettingsSecretField`/`SettingsValueField` — and the model covers the same semantics point for point: staged edits, revision-fenced saves, draft retention on failure, unset reset. Maintaining a private twin of a published model is the drift the reuse rule forbids.

## Proposal

Retire the controller onto the host model in four steps:

1. **Semantics spike on a scratch branch.** Drive `SettingsFormModel` through the card's exact scenarios — stage a numeric field, save against a bumped server revision, force a save failure, unset a field — and diff against the controller's behavior. This step gates everything else; the visual fit against the card-form rules in the local style standard is part of the spike.
2. **Swap the page view.** Render the card's page view through `SettingsForm`/`SettingsFormShell`/`SettingsFormActions`, field specs built with the `settings*Field` factories; keep the summary view and the `plugins.item` inject seat (SnapshotStore projection) unchanged.
3. **Fold the credential editor.** `McpCredentialEditor` becomes a `SettingsSecretField` bound to the model, with the write-only guarantee expressed through `SettingsSecretSpec.write` — value crosses the wire once, never renders back.
4. **Delete the controller** and its bespoke tests; the wire-projection tests stay.

The reuse-manifest rows for both files flip `self-built` → `use-host` in the landing change.

## Alternatives considered

- Adopt only `SettingsSecretField` and keep the controller. Rejected: the secret field binds the `SettingsFormModel` lifecycle and is not usable standalone, so this is the all-or-nothing half of the same migration.
- Wait for `ConfigField` to enter the public index. Rejected: the model group is importable today and covers the card's fields; `ConfigField` is a primitive-level piece worth one re-evaluation only if the spike fails.

## Acceptance criteria

- `pnpm run check:reuse` shows both rows as `use-host`, citing `SettingsFormModel` and `SettingsSecretField`.
- Card behavior is preserved: staged edits with explicit save, revision-fenced save, draft retained after a failed save, unset removes the field, the credential value crosses the wire exactly once.
- Bilingual UI strings keep flowing through `locales.ts`; no English-only surface appears.
- `plugin-card-controller.ts` is deleted; typecheck, lint, prettier, the reuse gate, and the client build are green.

## Risks

- **Visual divergence.** The host form's spacing and control shapes may not match the card-form standard; the spike decides before any swap lands, and a mismatch is a reason to keep the controller with a refreshed note, not to fork host styling.
- **The inject seat.** `plugins.item` hands the renderer a SnapshotStore hook; the host form must bind through that seat without standing up a second state instance. If it cannot, the migration stops at step 1 with findings.
- **rc-line churn.** The group is one baseline old; the standing dependency-alignment flow already prices that in, and the reuse gate's R2 rule turns upstream renames into a same-day signal.
