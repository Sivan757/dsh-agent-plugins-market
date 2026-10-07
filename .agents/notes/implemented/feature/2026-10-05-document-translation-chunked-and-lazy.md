# Agent Note: A detail page translates its whole document, in chunks, behind a disclosure row

Status: implemented

## Problem

Document bodies can exceed a provider request or the model's output budget. A failed or interrupted translation must not discard completed work, damage runnable examples, or make the original unreadable.

The initial reader put a translated body behind a second disclosure. That reading-mode decision is superseded by [three-mode reading and translation lifecycle](2026-10-06-translation-reading-and-lifecycle.md). This note remains the owner of bounded requests, the document role and identity-only reads; it does not prescribe the current reader layout.

## Decision

A document travels in bounded prose segments rather than one provider request. Completed segments are cached independently. The current AST segmenter and paragraph-pair rendering are owned by [the replacement decision](2026-10-06-translation-reading-and-lifecycle.md), not the initial blank-line packing strategy.

### Bound input and output together

The localizer bounds both text count and source characters per batch. The model adapter sizes its output budget from the source a call carries and rejects truncated output. These are application budgets, not claims about the undocumented limits of the vendors' consumer endpoints; a change of endpoint or supported target requires reviewing them together.

Descriptions also use bounded chunks. The splitter retains source separators, so unchanged chunks reconstruct the field. Invented blank lines can move a fenced example out of a list item or make a tight list loose. The splitter does not combine independent paragraphs to fill a chunk budget.

### Preserve the role slot

A document and its description share a surface and entity id. The persistent key includes role `description` or `document`; an omitted role means `description`, preserving existing description keys. Role distinguishes persisted entries, while the localizer's in-memory text index can reuse the same answer across roles.

### The server reads the file; the page names it

The panel translation route accepts the entry name and resolves the file through `PanelResourceStore`. The store strips frontmatter before translation: metadata belongs to the overview, and translating YAML would corrupt its syntax. The route never translates caller-submitted prose. The [market-route decision](../architecture/2026-10-05-market-document-translation-route-and-identity.md) extends this identity rule to previews before installation.

## Alternatives considered

**Render every source block with a separate host MarkdownText.** Not used: cross-block references and footnotes need document context, and per-container first/last-child spacing changes the document's rhythm. The current reader still renders one complete Markdown document; its server-side AST transform does not require a second client renderer.

**Insert nodes into React's rendered DOM, as a browser extension does.** Rejected: React owns this tree. Foreign nodes are not part of its child order and can conflict with later renders.

**Split rendered documents on blank lines without parsing Markdown.** Rejected: loose lists, nested paragraphs and fenced examples can change structure. Lossless description chunking is not a substitute for parsing the document that will be rendered.

**Send the whole document and let the provider reject it.** Rejected: the model can truncate a generation rather than refuse it; a partial answer must not be presented as a complete translation.

**Give every text a fixed output budget and bound only the number of texts.** Rejected: one long text and several short descriptions need different output budgets. Source length, batch limits and output limits must be considered together.

**Render translated Markdown as plain text, or translate code with prose.** Rejected: plain text discards readable document structure, and translated examples may stop running. The host Markdown renderer owns safe rendering; the AST transform keeps code out of provider input.

**Key segments by position.** Rejected: inserting a paragraph would invalidate unrelated neighbors. Stable entity identity plus segment text retains those entries; changing segmentation may still leave old, unused cache entries until a reset.

## Consequences

Opening a document requests its prose, not just the paragraphs currently visible in the viewport. Closing the reader stops its reads; already-submitted work may finish. Completed results remain reusable. The global disable and reset guarantees are owned by [the lifecycle decision](2026-10-06-translation-reading-and-lifecycle.md).

The translated view covers the body without frontmatter and can normalize Markdown syntax. The original view retains authored text. A document adds one cache entry per bounded prose segment rather than one per file.

## Testing

[Document chunk tests](../../../../tests/document-chunks.test.ts) cover bounded descriptions, preserved separators and document AST handling. [Document translation tests](../../../../tests/translation-document.test.ts) exercise the catalog and store path. [Cache tests](../../../../tests/translation-cache.test.ts) pin role-key compatibility; [localizer tests](../../../../tests/translation-localizer.test.ts) cover batch limits. These are coverage references, not a claim that this documentation edit ran the suite.

## Related

[The universal layer](2026-10-04-universal-translation-layer.md) owns provider order and persistent keys. [Language-derived defaults](2026-10-05-translation-default-follows-language.md) owns the absent-setting rule. The reading-mode portion of this note is partially superseded; the bounded-work and identity rationale remains active.
