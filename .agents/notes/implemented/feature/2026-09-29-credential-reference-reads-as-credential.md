# Agent Note: A secret reads as a secret

Status: implemented

## Problem

One header secret had two surfaces and they disagreed. The detail dialog showed the **credential block**: one write-only `SettingsSecretField` per reference, with a configured badge, its save and remove controls, and a hint naming the seat that spends it. The service editor showed the document text instead — `Authorization` beside `${CONTEXT7_API_KEY:-}` in a plain input — so the dialog where a service is edited offered no way to set the secret it needs, and the reference syntax read as the value. The two differ because they are two different things: the document holds the reference, and the secret lives in the host credential store, so only the presentation made them look like rival ways of doing one job.

**A literal secret read worse.** A secret the document holds itself never reaches the browser: the wire redacts it, and the editor showed the `[redacted]` placeholder as an editable string — a value the user cannot read, cannot recognise as a secret, and can save back over the stored one.

**And the block was one full field per secret.** Two references meant two stacked label/input/hint groups and four buttons between the form and the advanced settings.

## Decision

**The block is shared UI, and it carries both kinds of secret.** `McpCredentialFields` lives in `src/client/ui/` with three helpers: `credentialUsage` (which seat spends which reference), `literalSeats` (the seats whose value the wire redacted), and `credentialRefOf` (whether a value _is_ one reference). It takes entries — a reference the credential store answers, or a literal the document holds — and renders one collapsed `DetailRow` per secret, so a service with several secrets costs one line each and opening a row reveals the control that writes it. The block lives in the service editor alone: the detail dialog reports the service and leaves credentials to the editor, which is the split every other surface follows. The group is folded to a band stating how many secrets are configured, so a service with several costs one line until the reader asks for them; a row inside it opens onto its control. The LSP editor gets no block — its launch path resolves plugin paths rather than credentials — and the JSON view shows the whole document instead. The group's name is a row of that frame — the same band, chevron and soft-grey open state a disclosure row takes — because a label floating above the border reads as the heading of the next bordered group, and a band of its own shape makes two adjacent groups look like different kinds of thing.

**A value that is one reference renders as the credential it names.** `${NAME}` and `${NAME:-}` in a header or environment value become a chip — the shield glyph and the name, with the raw text as its tooltip — and activating the chip hands that row back to the text field, so nothing about the document becomes unreachable.

**A redacted value renders as a hidden secret.** The placeholder in a value cell becomes a static chip reading configured and hidden; the value itself is written only through the block's row, which in the editor replaces it in the document — an unchanged placeholder keeps the stored secret, because the save path restores exactly the masked leaves.

**Only the surface that owns the document writes a literal.** The editor's literal row carries replace and remove controls that write the seat; the detail dialog's row names the seat and says where the value is replaced.

## Alternatives considered

**Keep the block in the detail dialog and leave the editor's references as text.** The smallest diff, and the state that produced this report. Rejected: the editor is where the service is edited; sending the user to another dialog to set the secret that service needs is the inconsistency itself.

**Style the reference inside the input.** An `<input>` renders one string: it cannot carry a glyph, a status, or a second target, so "prettier" would have meant a different font colour and nothing else.

**Chip every seat the mount resolves.** A reference can also sit in `args`, `cwd` or a URL. Those are single-value fields whose values are usually mixed text, so a chip there would either hide the surrounding text or fire on a value that is not purely a reference. The two map seats — headers and environment — are where references actually live, and they are the ones that chip.

**Hide the reference syntax from the form entirely.** Cleaner-looking, but the document is the authority: removing the way back to the raw text would make the form lie about what it is editing.

**Keep the placeholder as an editable value.** Honest to the wire and useless to the reader: the string names no value, and a save that echoes it back is indistinguishable from one that means it.

**One full field per secret, as the host settings form composes them.** That shape belongs to a settings page; repeated per secret inside a dialog that already carries a form, it pushes the rest of the dialog off screen. The disclosure keeps the host field one line down.

**Let the report dialog write literals too.** It would have to own the service document, which is the split this plugin keeps everywhere else: the detail reports, the editor edits.

**Keep the name above the frame.** That is the detail dialog's other blocks' shape, and it costs no new row. Rejected: the blocks are stacked frames, so a name on the outside is read as the heading of whichever frame comes next — the reported confusion, with the advanced disclosure looking like part of the credentials.

**Offer to store a literal value as a credential while we are here.** Turning a literal token into `${NAME}` means naming the reference, writing the secret, rewriting the document and keeping the seat's meaning; that is a feature of its own, still deferred.

## Consequences

- A service's secrets — referenced or literal — read as one line each wherever the service is on screen, and the editor writes both: a reference through the credential store, a literal through the document.
- The editor's chips are buttons: a keyboard user reaches the raw text of a reference, and the replacement field of a literal, by activating one.
- A reference in a seat the form does not chip — a URL query, `cwd`, an argument — still reads as text, and an argument the wire redacted still reads as text inside the argument itself.
- The LSP editor never shows the block: its mount resolves plugin paths, not credentials.
- A disclosure paints exactly one surface: the header of the row it opened, on the platform's own soft grey. The coloured band it used to take read as a status rather than as "this row is open", and a hover fill plus a filled body gave the same surface to three different states.

## Testing

- `tests/client-detail-editors.test.ts` — a header reference renders as a chip carrying the reference name and the raw text as its title, with no value input until the chip is activated; a redacted value renders as the hidden chip and no input; the block lists a literal seat beside a reference and its replace control writes the new value into the document; the block appears for the references a document spends in the form view and stands aside in the JSON view.
- `tests/mcp-status-render.test.ts` — the detail dialog states the reference and its write-only control appears when the row is opened, not before.
- The write-once path is unchanged: `tests/client-credentials.test.ts` keeps covering the wire adapter.
