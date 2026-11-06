# Agent Note: a preset built from a suggestion stores the rows it named

Status: implemented

## Problem

The report was 「预设建议后，点保存无法存储实际的预设数据」 — after the preset suggestion, saving stored nothing they could see. The suggestion came back with a name, a reason and a list of rows; applying it created a preset whose file held ids, and the manager then showed none of them switched on.

Three defects sat behind that one report.

- The suggestion path stored the model's raw picks. The manager's own switches keep a closure: a row under a suite carries the suite that owns it (`resourceSelected` counts such a row as selected only when both ids are present), and a suite carries the rows under it. A suggestion that named a skill stored the skill alone, so the manager read it as not selected and the runtime granted it nothing (`extensionResourceEnabled` requires the suite too). A suggestion that named a suite stored the suite alone, so the suite read as on with its contents off.
- The suggestion path did not make the name unique. The manual path runs every name through `uniquePresetName`; the suggestion path passed the model's name straight to `create`, so a name that already existed failed with `preset-name-conflict` — and the failure vanished, because the modal's apply promise had no catch. The suggestion was lost, and nothing said so.
- The rows on offer are bounded (`AI_PRESET_LIMITS.candidates`, 300), and the client sent them in inventory order, so an inventory larger than the bound lost its tail: the output styles, the instruction files and the later suites were never shown to the model at all.

## Decision

- **One canonicalization answers both paths.** `canonicalPresetSelection(rows, base, changes)` in `packages/market-ui/src/features/extension-presets/resource.ts` is the only place that knows the closure: a row under a suite carries the suite, a suite carries the rows under it, an output style is one choice, and a row the manager cannot switch is not carried. The manager's `patch()` and the suggestion path both call it, so the two cannot drift.
- **The suggestion path names rows through it.** The model's picks become changes on an empty base, and the result is the selection the manager's switches would have built for the same rows.
- **The name is made unique, and the new preset is found by what changed.** `uniquePresetName` runs before the create, and the created preset is located by the id that appeared in the library rather than by the name the model asked for: the name may have been changed to make room for it.
- **A refused save says so.** The suggestion path reports through a toast. The modal stays open with the answer on screen, and the failure is named instead of disappearing into an unhandled rejection.
- **The rows on offer are ordered by what they carry.** `presetSuggestionCandidates` offers the suites and the rows that stand on their own first, then the rows under them, and cuts the list at the contract's bound. The bound is the contract's; the order is the client's, and the order is what decides which rows the model ever sees.

## Alternatives considered

- **Canonicalize on the server, in `create()`.** Rejected: the server holds ids, not rows. It cannot know that a skill belongs to a suite, so it cannot close the selection; the closure needs the inventory the manager renders.
- **Store the raw picks and let the reader repair them.** Rejected: the manager counts a row as selected only when the closure holds, so those ids would keep reading back as nothing. The report was that saving stored nothing; storing what cannot be read back is the defect itself.
- **Leave the rows under a suite out of the rows on offer, so a suggestion names suites only.** Rejected: a person asking for one skill means that skill. The rows stay on offer and the closure carries the suite for them.
- **Raise the bound on the rows one suggestion may be offered.** Rejected: the bound keeps the request and the prompt small, and it belongs to the contract. Ordering the client's rows is what decides what survives it.
- **Ask the model to name the suite whenever it names a row under one.** Rejected: the model would have to learn a rule the manager already enforces, and it would still be wrong whenever it forgot.
- **Leave the failure of a refused create to the modal's own error slot.** Rejected: the modal shows the error of its own suggestion call only, and it is not ours to change here; the toast is the one surface that reports above the manager.

## Consequences

- A preset created from a suggestion reads back as the rows it named, in the manager and in the runtime.
- The two paths that name rows produce the same selection, and one function owns that rule.
- The name a suggestion gets may differ from the one the model wrote, when that name was already taken.
- The rows the model sees are the ones that carry a selection, even when the inventory is larger than the bound.
- The output style is one choice in both paths now, because the rule moved into the shared function; see [the preset row carries the prompt layer too](../feature/2026-11-01-the-preset-row-carries-the-prompt-layer.md), whose decision this note continues rather than rewrites.

## Verification

- `packages/market-ui/test/preset-selection-canonical.test.ts` pins the closure rules: a named row carries its suite, a named suite carries its rows, a standing row stands alone, one style at a time, a row the manager cannot switch is not carried.
- `packages/market-ui/test/preset-ai-suggestion.test.ts` drives the manager: the suggestion names a row under a suite and the create carries both ids; the manager's switch reads the row back as selected; the suggestion path and the switch path produce the same ids for the same row; a name that is taken becomes `Research (2)` and the editor opens the new preset; a refused save is reported instead of vanishing.
- `packages/market-bundle/test/integration/ai-preset-selection.test.ts` checks the runtime side: the store keeps the closure, `captureExtensionSelection` and `extensionResourceEnabled` grant the row the suggestion named and refuse a selection that names it without its suite, and the rows beyond the bound are the ones the model never sees.
