# Agent Note: the entry detail opens its document

Status: implemented

## Problem

A skill, shortcut, or expert detail dialog exists to show one document. That document sat behind a collapsed disclosure row, so every reader performed the same click before seeing anything, and the dialog's first screen held only metadata the list row had already shown. The hint beside the row said "Expand to read it", which named the extra step instead of the content.

## Decision

The user-panel entry detail opens with its document row expanded.

`packages/market-ui/src/ui/UserEntryDetail.tsx` starts its `open` state at true, so the dialog reads the document as it opens and renders the body immediately. Collapsing the row stays available, and the row's hint names the action the click performs: `detailDocCollapseHint` while the row is open, `detailDocHint` while it is closed.

Two facts stay as they were. The reading mode still starts at original, so opening the dialog starts no translation read. The Market suite detail's document rows still start collapsed, because that dialog lists many documents and expanding them all would start one read per row.

## Alternatives considered

- **Expand every document row in the Market suite detail too.** Rejected: a suite detail can hold dozens of skill, command, and expert rows. Expanding them all would start one file read per row the moment the dialog opens, and the reader usually wants one document.
- **Remember the last state per entry.** Rejected: the dialog holds one document, so a remembered state has one bit of value and adds a persisted preference that can surprise a reader who collapsed a different entry.
- **Keep the row collapsed and make the hint clearer.** Rejected: the problem is the click itself, not its wording. The dialog already fetched the entry, so the document is the reason the dialog exists.
- **Read the document only after the row is opened, and start the row open.** Rejected: an open row with an empty body reads as a broken dialog, and the reader waits for a read they did not ask for.

## Consequences

- Opening an entry detail always reads that document, whether or not the reader wants it. The read is one file read, the same one the collapsed row used to defer.
- The dialog's first screen now carries the document body, so the overview and description scroll above it rather than filling the view.
- Translation still waits for a mode change. The added read does not add a translation request.
- A reader who wants only the metadata collapses the row, and the dialog keeps that choice until it closes.

## Testing

`tests/client-user-entry-detail-translation.test.ts` mounts the dialog and asserts the row arrives expanded with its body read, that the hint flips with the state, and that collapsing and reopening the row restores the body. The same file keeps the reading-mode coverage, including that no translation read starts on open. `tests/client-locales.test.ts` holds the two dictionaries in lockstep, which covers the new hint key.
