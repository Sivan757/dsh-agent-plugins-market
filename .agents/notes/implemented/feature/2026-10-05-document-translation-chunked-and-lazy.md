# Agent Note: A detail page translates its whole document, in chunks, behind a disclosure row

Status: implemented

## Problem

The user asked for the Markdown preview on a detail page to show both languages while translation is on — the original line, the translation under it — translated lazily, with read-frog's interaction as the reference. The research that preceded this change measured what that costs, and the answer was not the one the request assumed.

The preview renders through the host's `MarkdownText` (`@deepseek-ai/dsh-client-ui-primitives@0.2.0-rc.2`, reached from `src/client/ui/MarkdownDocument.tsx`), which takes a whole document and returns one tree. Its block granularity is real but internal: the published tarball ships only `lib/`, so the `./src/*` subpath its `package.json` declares resolves to nothing and `markdown/parse.ts` and `markdown/render.tsx` cannot be imported. Splitting the source ourselves and giving each block its own `MarkdownText` renders byte-identically — measured on six real documents and sixteen of eighteen edge cases — but it needs a second markdown parser in the client bundle (+85,565 B minified, +24,527 B gzip, measured with the repository's own esbuild), a permanent coupling to the host's private grammar extensions (`cjkFriendlyStrong`, `mathCompatibility`, which the published package does not export), and it breaks the host's own spacing contract: `MarkdownText.module.css` zeroes the margin of a first and last child, so one block per container needs the whole document's vertical rhythm rebuilt locally. Two cases stayed wrong even after a mitigation: a link reference definition and a footnote live in their own top-level block, so a split document renders them literally.

The user chose the cheaper shape once the numbers were on the table: one translated body in a folded section, not per-block insertion. That shape has one hard constraint of its own, which the user named: a document is far longer than any single provider request may carry.

## Decision

A document is translated whole, and travels in chunks.

`chunkDocument` (`src/application/translation/document.ts`) splits the body at blank lines, packs paragraphs up to a budget without cutting through one, splits only a paragraph that is longer than the budget, and keeps every fenced code block as one verbatim chunk. Each chunk carries the text that followed it in the source — its line ending, its blank lines, the whitespace before the next block — and `Catalog.translateDocument` re-emits that text instead of synthesizing a separator, so a body nothing was translated for reassembles byte for byte. Rejoining with `'\n\n'` looked equivalent and was not: a fence indented inside a list item is a chunk boundary with one authored newline before it, and the synthesized blank line made the item loose and moved its code block out of the `<li>`.

### The chunk size is derived, not chosen

The tightest hop in the chain is the model, not the public endpoints: `runtime/host/llm-translator.ts` sizes one call's output from the source that call carries (`outputTokenBudget`, at an estimated 0.6 tokens per source character, floored at 512 and capped at 4,096), and a generation that reaches its ceiling fails the batch _and_ trips the provider out of the chain.

The expansion is measured rather than assumed: across the 90 English/Chinese pairs this repository ships, the Chinese side runs at 0.461 of the English character count at the median and 0.617 in the worst case (0.621 counting a 36-character stub pair). What that costs in _tokens_ is an estimate and is labelled as one — nothing in this tree tokenizes — and the estimate (roughly 0.7 tokens per Chinese character) puts the worst case near 0.43 tokens per source character. The budget constant is 0.6 tokens per source character, which leaves ~40% headroom over that estimate and keeps a call carrying a full `MAX_BATCH_CHARS` batch (6,400 source characters) inside the 4,096 ceiling.

The binding constraint is the model hop's output budget rather than a vendor request limit: the two public endpoints the chain calls are the consumer endpoints the vendors' own translation widgets call, not the Cloud APIs whose documented per-request limits get quoted for these products, and no request-size number is claimed here. Moving a hop onto an officially documented API would have to re-derive `MAX_BATCH_CHARS` against that API's own limit.

### The batch is bounded by characters as well as by count

`MAX_BATCH_SIZE` alone bounded how many texts a call carried, not how much text, so twenty document chunks would have asked the model hop for several times the output it is allowed to produce. `MAX_BATCH_CHARS` (6,400) is the input half of the same number the translator budgets its output from: `TranslationLocalizer.pump` stops filling a batch when the next text would push it past the ceiling, and `schedulePump` starts a batch that has reached it. A text larger than the whole budget is never dropped — it opens a batch and runs alone, which is only sound because no text that reaches the queue is that long.

Description traffic is bounded the same way rather than exempted: `Catalog.translateFields` chunks a description through the same splitter, so a field longer than one chunk travels as chunks and is reassembled with its own authored separators. The longest description measured in real catalogs is 1,428 characters and 59 of 9,969 exceed one chunk, so this is rare — but the old per-text output budget (~1,113 characters of source) made every one of them a way to cut a generation off and retire the provider.

### The role slot keeps the existing cache

A document chunk and the entity's description share a surface and an id, so they needed to be told apart in the cache key. `TranslationUnit.role` (`description` | `document`) is that slot, and it defaults to `description` — the only role the layer had when every entry on disk was written. `translationKey` therefore produces the identical digest for a unit that names no role, so no existing entry moves and nothing is re-paid on upgrade.

### The server re-reads the entry; the page only names it

`PanelResourceStore.translateDocument(id)` reads the entry itself and strips the frontmatter before chunking: frontmatter is metadata the overview block already shows, and a provider asked to translate YAML answers with YAML that no longer parses. The route (`POST <user-panel>/<kind>/entry/translation`) carries `{ name }` and nothing else, so a script on the page cannot spend the operator's translation quota on text of its own choosing.

### The translation is read when the reader asks for it

`src/client/ui/DocumentTranslation.tsx` renders one disclosure row under the document. The first read happens on open, never on mount, and the shared `pollUntilTranslated` then re-reads until `pending` reaches zero — so the text fills in, a chunk already in the cache appears at once, and a chunk still in flight shows its authored paragraph with the row's own note saying so. The section exists only where it can say something: with translation off, or under an interface language the documents are already authored in, it renders nothing and reads nothing.

## Alternatives considered

**Insert the translation under each block, read-frog's shape and the user's original request.** Rejected by the user on the measured cost: a second markdown parser in the client bundle, a permanent coupling to grammar extensions the published package does not export, the host's spacing contract rebuilt locally, and two cross-block cases that stay wrong. The interaction read-frog actually contributes — stack the translation under its source, gate the work by what is on screen — survives in this shape.

**Inject the translated nodes into the rendered DOM, the way read-frog does.** Rejected: read-frog is a browser extension on pages it does not own, so DOM injection is its only option. Here React owns the tree, and `MarkdownText` is a memoized component whose children are an element array from `useMemo`; nodes inserted from outside are not in React's child order and the next render of that container conflicts with them.

**Split on blank lines without parsing markdown.** Rejected: measured against the whole-document render, a fence-aware blank-line splitter silently changes real content — it turns a loose list into three tight ones and lifts a list item's second paragraph out of its `<li>`. The authored document is the one the reader compares against, so the translated view must not restructure it.

**Translate the whole document as one unit and let the provider reject it.** Rejected: the user named this as the risk, and the model hop's output ceiling would truncate rather than refuse — a partial translation presented as a complete one.

**Keep a fixed output budget per text and bound only the batch.** Rejected: what a call has to answer is the expansion of the source it was handed, so a constant per text cannot be right for both twenty short descriptions and one long one. Measured, 512 tokens covers about 1,113 source characters, and real catalogs ship descriptions past that; the overshoot is cut off mid-generation rather than refused, which fails the batch and retires the provider.

**Render the translated body as plain text rather than markdown.** Rejected: a machine translator damages markdown structure (`#` and list markers drop, URLs move), and plain text would turn every document into one wall of prose. Rendering it through `MarkdownText` degrades formatting instead of safety: raw HTML is dropped and link protocols are restricted exactly as for the authored document, so whatever the provider returns is rendered safely.

**Translate fenced code as well.** Rejected: a provider asked to translate an example translates the code in it, and a translated `SKILL.md` whose examples no longer run is worse than an untranslated one. Code chunks are never sent and never billed for.

**Key a chunk by its index instead of its text.** Rejected: the key is a digest of the text, so an edited paragraph misses and is re-translated while its untouched neighbours are served from the cache; an index would have re-paid for the whole document on any edit.

## Consequences

A reader opens the translated body on demand, pays for the chunks they actually look at, and keeps every chunk that landed if they close it. The cost is one cache entry per chunk — a 55 KB changelog is dozens of small digests rather than one — and a first line of Chinese that appears only after the first batch returns.

Machine translation of markdown is best-effort. Headings and lists usually survive; a provider that drops a marker degrades that block's formatting and nothing else.

The translated body is the document's body without its frontmatter. The overview block above already shows those fields, so nothing is lost, but the folded section is not a byte-for-byte mirror of the file above it.

The batch budget is a layer-wide change: a deployment whose descriptions are unusually long now forms smaller batches than before. That is a request count, never a correctness loss, and it is the same ceiling the model hop always had.

The translated body is now the authored body with prose chunks replaced: the separators, line endings and blank lines around every chunk are the author's own. A document whose chunks are still queued renders exactly as the file does, which is what makes the folded section comparable against the preview above it.

## Testing

`tests/document-chunks.test.ts` pins the chunker: the budget holds, a paragraph that fits stays whole, an over-long paragraph splits at its own line breaks, a fence keeps its blank lines and never reaches a provider, an unclosed fence is code to the end, the output budget covers the worst measured expansion of a chunk, a whole batch fits the call ceiling, and every Markdown document this repository ships round-trips through `chunks.map(chunk => chunk.text + chunk.separator).join('')` byte for byte — over 300 real documents, so a separator rule that only works on the fixture would fail. The case that motivated it is pinned on its own: an authored single newline between list text and an indented fence comes back as one newline.

`tests/translation-document.test.ts` drives the real `Catalog` over the fixture suite: a read answers with the authored body and reports what it queued, a settled read assembles the translations in order, a second read is served from the cache, a fenced block is absent from every provider batch and verbatim in the output, an English interface translates nothing, a chainless deployment queues nothing, a body with no text is answered with itself, the authored trailing newline survives, a fence inside a list item keeps the single newline the author wrote, and the store read strips the frontmatter it was given.

`tests/translation-cache.test.ts` pins the role slot: a unit naming no role keeps the key it already had, and a document chunk of the same entity does not answer for its description. `tests/translation-localizer.test.ts` pins the batch budget: one call never exceeds it, and a text larger than the whole budget still runs, alone.

`tests/client-document-translation.test.ts` mounts the section: nothing renders and nothing is read while translation is off or under an English interface, the document is read only once the row is opened, the pending note stands until the last chunk lands, and a failed read is reported instead of a document.

`tests/routes.test.ts` asserts each panel's six route paths by name — through the same helper the client builds its URL with — and exercises the translation route: the response shape, that only the entry's name travels, and that a nameless body is refused before the store is asked.

Every one of these was re-run against a deliberately reverted fix and failed: disabling fence detection reddens five cases, changing either size constant reddens the ones that pin it, restoring the fixed role slot reddens the cache case, and removing the open gate reddens four.

The separator rule is pinned the same way, in a copy of the tree: restoring the previous chunker and its blank-line join reddens twelve cases, among them both round-trip tests and the list-item fence case, and lowering the translator's budget constant until it no longer covers the measured worst-case expansion reddens the derivation assertion in `tests/document-chunks.test.ts`. The cases added around it are revert-verified too: restoring the per-text output budget reddens the two translator cases that pin the source-sized one, reverting the description chunking reddens the description round-trip case, restoring the presence test for Han reddens the two `needsTranslation` cases and the document-path case that pins an English paragraph quoting Chinese, and returning the preference tag as the translation target reddens the gate-consistency cases for `zh-CN`, `zh-Hant`, `ja`, `en` and `en-US`.

## Related

[The universal translation layer note](2026-10-04-universal-translation-layer.md) owns the chain, the cache and the six surfaces. This note adds a second role and a batch ceiling to that layer; the layer note carries both roles now, and nothing else in it is superseded — the layer's own mechanisms are unchanged. [The translation-default note](2026-10-05-translation-default-follows-language.md) owns the gate that decides whether any read translates; `Catalog.translateDocument` is gated by that same predicate and this note changes none of it. [The shared-primitives note](../architecture/2026-09-12-shared-primitives-and-declared-seams.md) owns the preview's use of `MarkdownText`, which this change leaves in place.
