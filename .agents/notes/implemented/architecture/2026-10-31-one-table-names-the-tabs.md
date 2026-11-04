# Agent Note: one table names the tabs

Status: implemented

## Problem

The owner asked twice whether the preset manager and the settings page share components and logic. They share the rail, the list, the toolbar and the card already, but one piece of logic was duplicated four times over.

The workspace row, the preset manager and the install confirmation each held their own map from a tab to its label. The preset manager held four: the face list, the label keys, the count nouns and the tab-key translation, because its face `agents` is the workspace's `personas` tab and its hooks row used its own label key (`epHooksTab`) rather than the workspace's. Adding a tab, renaming a noun, or renaming a tab label meant editing three files and noticing whether all four maps still agreed.

## Decision

- **`workspace/tab-meta.ts` owns the answer.** One entry per `WorkspaceTabKey` with the tab's label, the noun for one collection where a sentence needs it, and the preset manager's face name where the two differ. `PRESET_FACES` is the literal tuple of faces a preset switches, and `workspaceKeyOfFace` / `faceOfWorkspaceKey` translate between the two vocabularies.
- **The four maps become one lookup each.** The preset manager derives its labels and counts from the metadata, the workspace row builds its label record from it, and the install confirmation derives its count tags from it. `epHooksTab` is deleted: it said the same word as `workspaceTabHooks`, and two keys for one label is how the drift started.
- **The prompt layer stays out of the preset row by data, not by omission.** `instructions` and `outputStyles` have no `presetFace`, so the face tuple cannot grow to include them by accident.

## Alternatives considered

- **Move the preset manager into the settings page so both render one component.** Rejected for now: it is session-scoped and opens over the composer, and the owner has not asked for that entry to change. The shareable parts are shared; the frame differs on purpose.
- **Keep four maps and add a test that they agree.** Rejected: a test that compares four copies of the same data is a slower way of not having four copies.
- **Derive `PRESET_FACES` by filtering the metadata.** Rejected: a filter yields `string`, which pushes a cast into every call site; the literal tuple keeps each face a literal type.

## Consequences

- Adding a tab is one entry in the contract and one in the metadata.
- Renaming a collection's noun reaches the workspace row, the preset counts and the install confirmation together.
- The preset manager's label for hooks is the workspace's own, so the two rows cannot disagree.

## Verification

- `packages/market-ui/test/workspace-tab-meta.test.ts` pins one entry per contract key, a bilingual label and noun for every entry, a bijection between `PRESET_FACES` and workspace keys, and the absence of a face for the prompt layer.
- `packages/market-ui/test/tab-layout-sharing.test.ts` finds the preset row by "shows the market tab and not the prompt tab" now that both rows share one hooks label.
- `packages/market-bundle/test/integration/client-extension-preset-v5.test.ts` clicks the hooks face by the workspace's label.
- The four typechecks, `check:refactor` and the full suite pass.
