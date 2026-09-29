# Agent Note: A credential reference reads as a credential

Status: implemented

## Problem

One header secret had two surfaces and they disagreed. The detail dialog showed the **credential block**: one write-only `SettingsSecretField` per reference, with a configured badge, its save and remove controls, and a hint naming the seat that spends it. The service editor showed the document text instead — `Authorization` beside `${CONTEXT7_API_KEY:-}` in a plain input — so the dialog where a service is edited offered no way to set the secret it needs, and the reference syntax read as the value.

The two differ because they are two different things: the document literally holds the reference, and the secret lives in the host credential store. The presentation was what made them look like rival ways of doing one job.

## Decision

**The credential block is shared UI, and the editor mounts it too.** `McpCredentialFields` moves to `src/client/ui/` and carries the two helpers the block needs — `credentialUsage` (which seat spends which reference) and `credentialRefOf` (whether a value _is_ one reference). The detail dialog and the service editor render the same block, so a secret is configured the same way in both. The editor takes the credential wire as a prop and renders the block in the form view, for an MCP document that spends references: the LSP launch path has no credential resolver, so it gets no block, and the JSON view shows the whole document instead.

**A value that is one reference renders as the credential it names.** `${NAME}` and `${NAME:-}` in a header or environment value become a chip — the shield glyph and the name, with the raw text as its tooltip — and activating the chip hands that row back to the text field, so nothing about the document becomes unreachable. A value with anything else in it (a URL query, a non-empty fallback, a literal token) stays text, as does any seat the chip does not cover.

## Alternatives considered

**Keep the block in the detail dialog and leave the editor's references as text.** The smallest diff, and the state that produced this report. Rejected: the editor is where the service is edited; sending the user to another dialog to set the secret that service needs is the inconsistency itself.

**Style the reference inside the input.** An `<input>` renders one string: it cannot carry a glyph, a status, or a second target, so "prettier" would have meant a different font colour and nothing else.

**Chip every seat the mount resolves.** A reference can also sit in `args`, `cwd` or a URL. Those are single-value fields whose values are usually mixed text, so a chip there would either hide the surrounding text or fire on a value that is not purely a reference. The two map seats — headers and environment — are where references actually live, and they are the ones that chip.

**Hide the reference syntax from the form entirely.** Cleaner-looking, but the document is the authority: removing the way back to the raw text would make the form lie about what it is editing.

**Offer to store a literal value as a credential while we are here.** Turning `Bearer eyJ…` into `${NAME}` means naming the reference, writing the secret, rewriting the document, and keeping the seat's meaning; that is a feature of its own, and the reported problem is how an existing reference reads.

## Consequences

- An MCP service whose document spends references shows the credential block and the chipped values wherever it is opened, detail or editor; its secrets are written once, through the host control.
- The editor's chips are buttons: a keyboard user reaches the raw text by activating one.
- A reference in a seat the form does not chip — a URL query, `cwd`, an argument — still reads as text, and literal secrets stay literal.
- The LSP editor never shows the block: its mount resolves plugin paths, not credentials.

## Testing

- `tests/client-detail-editors.test.ts` — a header reference renders as a chip carrying the reference name and the raw text as its title, with no value input until the chip is activated; the credential block appears for the references a document spends in the form view and stands aside in the JSON view.
- The detail dialog's block and the write-once path are unchanged: `tests/client-credentials.test.ts` keeps covering the wire adapter, and the editor tests cover the form's own behaviour.
