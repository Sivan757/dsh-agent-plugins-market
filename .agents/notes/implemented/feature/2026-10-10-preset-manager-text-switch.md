# Agent Note: the preset manager carries the panel text switch

Status: implemented

## Problem

Every settings panel puts a text-view switch at its toolbar's trailing edge: one click flips the descriptions between the translation and the authored text. The preset manager rendered the same toolbar, the same cards, and the same detail dialogs, and carried no such switch. A reader who wanted the authored text had to leave the manager for the settings page, and the manager's cards showed the translated description with no way back to the source text.

The manager could not simply add the control. `ExtensionResource` carried one `description`, and the inventory resolved it before the wire: a market row took the overview's already-localized text and a panel row took `entry.translatedDescription ?? entry.description`. One field cannot be flipped, because the authored text was gone by the time the client saw the row.

## Decision

The manager renders the shared switch, and the wire carries both texts.

`ExtensionResource` gains an optional `translatedDescription` beside `description`, and `description` now holds the authored text. The inventory passes both through: a market row takes the overview's `description` and `translatedDescription`, and a panel row takes `entry.description` and `entry.translatedDescription`. A row with no translation carries no second field, so an untranslated row renders its authored text exactly as before.

`ResourceList` renders `BilingualToggle` in the toolbar's `beforeView` slot, the same slot and the same component the settings panels use, and resolves each card's text through `displayText(row.translatedDescription, row.description, t, { original: !enabled || showOriginal })`. That is the one render-time rule every other surface resolves through, so the manager cannot drift from them.

`ExtensionPresetEntry` owns the view, the way `MarketSection`, `UserPanelSurface`, and `McpStatusPanel` each own theirs, and passes it to the detail dialog through `ExtensionDetailProps.showOriginal`. A suite opened from the manager therefore renders the text the card behind it shows. The switch is display-only state: it never reaches the wire, the selection, or the URL, and a click starts no translation read.

Search reads both texts, so a reader who saw a translation can still find the row after flipping, and the reverse.

## Alternatives considered

- **Flip the text client-side by translating on demand.** Rejected: the switch is a view over text the server already resolved, and asking a provider to translate what is already cached would spend quota to reproduce a string the panel already holds.
- **Keep one field and store whichever text is showing.** Rejected: the field would carry a display preference, so two readers of the same row would disagree, and a saved preset would inherit whichever text happened to be on screen.
- **Let each card own its own switch.** Rejected: the settings panels established one view per panel, and a per-card switch would make the same click mean different things on two cards of one list.
- **Reuse `beforeView` for a second view control.** Rejected: `beforeView` is the text view's seat by construction, and the settings panels already put the identical control there.
- **Send only the translated text and keep the authored text in the detail read.** Rejected: the card needs the authored text to flip, and a second read per click would make a display flip cost a request.

## Consequences

- The manager now reads like the settings page: one toolbar, one switch, the same trailing position.
- Every manager row carries one more optional string. A translated row's payload grows by the length of its translated description, which the overview and the panel list already held.
- `description` changed meaning on this wire: it was the resolved display text and is now the authored text. Every consumer resolves through `displayText`, so a consumer that read `description` directly would now show the authored text. `ResourceList` was the only such consumer.
- A reader who flips the view keeps it until the dialog closes. The state is deliberately not persisted, matching the settings panels.

## Testing

`tests/extension-suite-inventory.test.ts` pins both texts on a market row and on a panel row, and pins the absent second field for an untranslated card. `tests/bilingual-toggle.test.ts` asserts the manager's switch flips the card text while the name stays, and that the click reports up instead of flipping local state. `tests/client-extension-preset-v5.test.ts` opens the real manager dialog, asserts the switch sits in the trailing cluster beside the grid/list button, and flips a card through it.
