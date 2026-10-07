# Agent Note: Suite documents read on expand, never inside the detail payload

Status: implemented

## Problem

The market detail modal renders one row per document on each of its three document surfaces — a skill's `SKILL.md`, a command, an agent persona. The three rows looked alike and were served by two different mechanisms: a skill's body was read on demand by the skill route, while a command's and an agent's body travelled inline in the `suiteDetail` payload, sliced at `64 * 1024` characters (`markdownPreviews`, the pre-change `packages/market-bundle/src/application/details.ts:122-127`) with nothing on screen saying so.

The slice had a real reason: the modal fetches the payload whole, so a suite with many large documents would put megabytes on one response. What it cost was a reader's trust — a long command expanded to a document that stopped mid-sentence, with no marker, count, or state to say it had been cut. The same module already knew the difference: `readPreview` appends `… (truncated)` to the LSP definition files it still inlines, so one codebase carried two behaviours for one idea.

## Decision

The `suiteDetail` payload carries a document's identity and never its bytes. `commands` and `agents` project `SuiteDocumentMeta` — the name the row renders and the frontmatter `description` beside it (`documentMetas`, `packages/market-bundle/src/application/details.ts:141-152`) — and the 64 KiB slice is gone along with the bodies it capped. The directory-style LSP definition files keep `readPreview` and its visible cap (`:130-133`); they are a separate surface, still inlined, and were not part of this defect.

All three document surfaces read their text through one route and one reader: `GET /api/agent-plugins/suite/document?sourceId=…&suiteId=…&kind=…&name=…` (`MARKET_ROUTES.suiteDocument`, `packages/market-contracts/src/contracts/market.ts:29`; handled at `packages/market-bundle/src/routes.ts:186-200`), answered by `Catalog.suiteDocument` (`packages/market-bundle/src/application/catalog.ts:447`) through `readSuiteDocument` (`packages/market-bundle/src/application/details.ts:116`). That reader already served all three kinds — the command and agent half existed for the translation route — so no reader was written for this change; what was missing was the read route and the client call, and the skill-only route it replaced (`MARKET_ROUTES.skill`, `SkillContent`) is deleted with it.

### The client has one document row, not three

`SuiteDetailModal` builds every document row through one `documentRow(kind, id, name, description)` helper (`packages/market-ui/src/features/market/SuiteDetail.tsx:108-118`): one lazy trigger (the read starts when the row is opened), one loading slot (`documentText`/`documentLoading`, `:54-56`), one failure path (the `⚠ …` text written by `toggleRow`, `:95`), and the same collapsed translation section under the body. The three surfaces now differ only in the `kind` they pass.

The translation region was already server-side and its contract is untouched: `POST …/suite/document/translation` re-reads the file through the same `readSuiteDocument` (`packages/market-bundle/src/application/catalog.ts:483`), never the page, and the section reads nothing until a reader opens it.

## Alternatives considered

**Keep the inline bodies and make the cut visible.** Rejected: a truncation marker makes the defect honest, not fixed, and the payload still grows with the suite's documents — the bloat class the user panel already removed by taking its documents off the list wire.

**Raise the cap instead of removing it.** Rejected: any cap is a silent cut for some suite, and the constant is not the reader's to discover. The bytes have to leave the payload rather than shrink inside it.

**Give commands and agents a second read route beside the skills one.** Rejected: three surfaces of one document kind, differing only in `kind`; a second route would keep the skill route's extra wire fields (`description`, `path`) alive for no consumer, and would leave the client with two fetch functions whose loading and error paths could drift apart again — the very asymmetry this change removes.

## Consequences

The regression fixture's payload drops from 656,671 bytes to 1,151 bytes — six 120 KiB commands and four 90 KiB agents, 1,105,920 authored bytes in all (`tests/suite-detail-document-payload.test.ts`). A reader who expands a command or an agent now sees the whole file, however long, and pays one read for it; that read is the same one the skills row already made. The visible cost is that a command or agent row shows a loading line for the duration of its read where it used to render instantly, and one more request per expanded row reaches the host.

## Testing

`tests/suite-detail-document-payload.test.ts` holds the wire contract: no entry carries a body, the payload stays small for a suite whose documents exceed a megabyte, and the on-demand read is the whole file including a tail past 64 KiB. `tests/market-detail-document-lazy.test.ts` mounts the modal: nothing is read on mount, each of the three surfaces reads its own document by kind and name when expanded, a command longer than the old cap renders its tail, and a failed read writes the same failure into the row. `tests/market-detail-document-translation.test.ts` keeps the translation region's lazy contract on all three surfaces, and `tests/routes.test.ts` exercises the read route, its kind validation, and its 404.

## Related

- [The market document-translation note](2026-10-05-market-document-translation-route-and-identity.md) is **partially superseded**: its statements that commands and agents travel inline in the `suiteDetail` payload (`:31`, `:37`, `:43`) describe the payload this change removes, so its "the payload is what the page shows" framing now reads "the document route is what the page shows". Its identity, cache-key, and route decisions stand, and both notes stay active.
- [The document-translation note](../feature/2026-10-05-document-translation-chunked-and-lazy.md) owns the chunker, the poll, and the user-panel route; this change adds no translation behaviour.
- [The read-path note](2026-10-05-read-path-cost-bounds-and-locale-freshness.md) owns the locale read cost that every document read pays.
