# Agent Note: User-facing copy omits decisions and unrequested hints

Status: implemented

## Problem

User-facing surfaces here carried the reasoning behind internal choices. The agent-role editor, for example, told the reader that `tools` / `disallowedTools` stay in the frontmatter but are never applied, because they name Claude Code tools — a sentence about why this plugin stopped translating a foreign tool dialect, not about anything the reader can do. Copy like that asks a plugin user to keep an implementation decision in mind, spends their attention on our deliberation, and goes stale the moment that decision is revisited. The leakage had no stopping point either: the READMEs, the usage guides, the docs site, panel copy in `src/client/locales.ts`, and code comments each decided separately how much reasoning to expose.

## Decision

User-facing documentation and comments state what the user gets and what they can do. They do not present decision information — the rationale for an internal choice, the rejected alternative, what was given up — and they do not carry hints nobody asked for. This covers the READMEs, `docs/`, `docs-site/`, panel copy in `src/client/locales.ts`, and code comments. The rationale lives in Agent Notes and ADRs, which are developer-facing.

The first application removed `personaToolsHint` from both locale tables in `src/client/locales.ts` and the paragraph rendering it in `src/client/features/personas/RoleMetadataFields.tsx`.

## Where the line falls

A hint stays when it changes what the reader does: which declaration actually takes effect, what a control will do, what an error demands. It goes when it explains why an internal mechanism behaves as it does, or what we chose over what. That is why `personaModelHint` survived the same edit — it tells the reader that only a `provider` + `model` pair applies, where the deleted sentence explained the fate of a Claude Code field.

## Alternatives considered

**Reword the explanation instead of deleting it.** Rejected: the offending content is the reasoning itself, so a tighter sentence still asks a plugin user to track an implementation decision that only matters to contributors.

**Keep the explanations in the user-facing docs and strip only the UI.** Rejected: the docs are as user-facing as the panel. Their reader is installing and running the plugin, not reconstructing why the executor stopped converting Claude tool names.

## Consequences

User-facing surfaces are shorter and stay on the reader's task. The cost is that reasoning sits one hop away in `.agents/notes/` and `docs/adr/`, so contributors must look there rather than reading it inline. The boundary is also judgment-based — a hint that saves a support round trip can look like an unrequested hint — so the rule is review-enforced, not gated. It governs new and touched copy: user-facing text that still explains the `tools` / `disallowedTools` decision, in the READMEs and `docs/guides/agent-roles*.md`, has not been rewritten yet.

## Related

[Agent role delegation over the host continuation seam](../architecture/2026-09-10-agent-role-delegation-via-host-continuation.md) owns the shipped `tools` / `disallowedTools` behavior this rule keeps out of user-facing copy. [README information structure](2026-09-08-readme-information-structure.md) already governed what the READMEs present and had omitted the repository-versus-release notice at the user's request; this note generalizes that stance to every user-facing surface, so it partially supersedes that note's copy rule while its structure decisions stay active. Both notes remain active and cross-linked.
