# Agent Note: The preset entry shows, and its suggestions are cards

Status: implemented

## Problem

Two defects met in the composer's Agent preset feature.

The entry hid itself whenever the host called the `conversation.input.left` seat without a `sessionId`, and warned once about it. That guard described an older host: the published slot contract types every session-scoped seat with `sessionId: SessionId`, and the 0.2.3-alpha.2 host passes it, which a DOM probe confirmed. The guard therefore outlived its reason and, on a host that ships the contract, a reader would still lose the entry the moment a probe reported no id.

The suggestion dialog also drew its candidate rows as a private label list. The form's text-field rule sets every `input` to `width: 100%`, so a row's checkbox took the whole line, the name span was squeezed to zero width, and a 12px name wrapped one character per line. The row carried only a title as well: the reader could not judge the row's version, owner, counts or source, and the card's own switch and detail had been replaced by a whole-card tick.

## Decision

- `PresetEntrySlot` renders whenever the preset setting is on and takes `sessionId` as the session-scoped seat's required prop. The missing-id guard, its one-shot warning flag, and the diagnostic probe are gone.
- The suggestion rows are the manager's own list: `ResourceSurface` over entries built by `buildFaceEntry` from the caller's `candidateFacts`, the same adapter (`presetRowFacts`) the manager's cards use. Each row carries the name, version, owner tag, description, counts and source; `on` means the row is kept; the card's switch keeps or drops it, and clicking the card opens the caller's detail dialog. The private list, its checkbox and its CSS are gone.
- `e2e/presets.spec.ts` pins both facts: the entry appears in the composer, opens the manager, and the stubbed answer renders one complete card (version, owner, description, counts, source) whose switch flips the card state, whose click opens the detail, and whose kept count enables the create action.

## Alternatives considered

- **Keep the missing-session guard and fall back to the host's current-session selector.** Rejected: the seat contract already carries the identity, and a second source would be a speculative path for a host shape that no longer exists.
- **Repair the private list instead: reset the input width and add the missing facts.** Rejected on direction: the row is a resource, the plugin already owns one card anatomy and one list adapter, and a second hand-built list is the duplication this repository's design rules forbid.
- **Keep the whole-card tick inside the shared card.** Rejected on direction: the switch is the plugin's one keep/drop control, the card click already opens the row, and a suggestion that behaved differently would be a second interaction for the same rows.

## Consequences

- The entry is visible in every session where the setting is on; a host that one day violates the session-scoped contract fails loudly instead of silently dropping the feature.
- Suggestion rows are the manager's cards: same facts, switch and detail, so a reader judges a proposal with the same facts they would see before enabling it. The dialog keeps a bounded height for long answers.
- The spec answers the one suggestion request with a fixed payload: the model call is the only part a browser test cannot make real, and the rows it returns are what the test judges.
- Two active feature notes keep their decisions and gain a cross-link: [the composer entry's shape](../feature/2026-11-18-the-composer-entry-names-its-preset.md) still owns the chip, and [the recommendation's ticked rows](../feature/2026-11-20-a-recommendation-you-can-judge.md) still own that a suggestion is editable. This note owns the entry's visibility and the rows' anatomy.
