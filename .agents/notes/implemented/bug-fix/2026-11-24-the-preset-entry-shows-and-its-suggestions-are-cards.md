# Agent Note: The preset entry shows, and its suggestions are cards

Status: implemented

## Problem

Two defects met in the composer's Agent preset feature.

The entry hid itself whenever the host called the `conversation.input.left` seat without a `sessionId`, and warned once about it. That guard described an older host: the published slot contract types every session-scoped seat with `sessionId: SessionId`, and the 0.2.3-alpha.2 host passes it, which a DOM probe confirmed. The guard therefore outlived its reason and, on a host that ships the contract, a reader would still lose the entry the moment a probe reported no id.

The suggestion dialog rendered its candidate rows as plain `label` elements inside a form `.field`. The form's text-field rule sets every `input` to `width: 100%`, so each row's checkbox took the whole line, the name span was squeezed to zero width, and a 12px name wrapped one character per line. Three such rows became the tall empty boxes the reader saw.

## Decision

- `PresetEntrySlot` renders whenever the preset setting is on and takes `sessionId` as the session-scoped seat's required prop. The missing-id guard, its one-shot warning flag, and the diagnostic probe are gone.
- The suggestion dialog renders one `ResourceCard` per candidate inside a `ResourceCollection` with `view: 'list'`: the shared name row, the optional description row, and one control in the action cluster. The control is a checkbox because a suggestion is a selection, not an enable; the card's rail reports whether the row is kept, and the list scrolls inside its field so a long answer never stretches the dialog.
- `e2e/presets.spec.ts` pins both facts: the entry appears in the composer, opens the manager, and the stubbed answer renders one compact card whose tick flips the card state and enables the create action.

## Alternatives considered

- **Keep the missing-session guard and fall back to the host's current-session selector.** Rejected: the seat contract already carries the identity, and a second source would be a speculative path for a host shape that no longer exists.
- **Fix only the checkbox width in CSS.** Rejected on direction: the row is a resource, the plugin already owns one card anatomy for resources, and a second hand-built list is the duplication this repository's design rules forbid.
- **Render the candidates as switches.** Rejected: a switch says "this runs now", while the suggestion is a proposal the reader ticks before creating a preset.

## Consequences

- The entry is visible in every session where the setting is on; a host that one day violates the session-scoped contract fails loudly instead of silently dropping the feature.
- Suggestion rows share height, rail, and control placement with every other resource list, and the dialog keeps a bounded height for long answers.
- The spec answers the one suggestion request with a fixed payload: the model call is the only part a browser test cannot make real, and the rows it returns are what the test judges.
- Two active feature notes keep their decisions and gain a cross-link: [the composer entry's shape](../feature/2026-11-18-the-composer-entry-names-its-preset.md) still owns the chip, and [the recommendation's ticked rows](../feature/2026-11-20-a-recommendation-you-can-judge.md) still own that a suggestion is editable. This note owns the entry's visibility and the rows' anatomy.
