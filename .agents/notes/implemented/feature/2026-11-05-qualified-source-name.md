# Agent Note: a skills-only market is named by its owner and its repository

Status: implemented

## Problem

A source id is a key, not a label. It comes from the URL's basename, so two repositories called `skills` from different owners collide: the second one is stored as `skills-2`, and a reader sees `skills` next to `skills-2` with nothing to tell them apart. The bare name is also too short to say what it is, so a reader cannot pick the right row.

The id cannot move. It is persisted state: every `market:<sourceId>/<suiteId>` resource id, every install-state key and every `.sources/` checkout directory is built from it.

## Decision

- **A source row carries an optional display name; the id stays the key.** `SourceOverview.displayName` is the name a reader recognizes the source by. The catalog computes it in `market-catalog/src/scanning/source-name.ts`, and it never takes the place of the id in a resource id, a state key or a checkout path.
- **The name is `owner/repository`, read from the URL.** `parseRemoteRepository()` in `scanning/paths.ts` parses the owner and the repository out of a remote URL, and the owner-prefixed source id and the qualified display name read that one parse, so they cannot drift over what a URL says. `github.com/jeecgboot/skills` is named `jeecgboot/skills`.
- **Only a remote skills-only source gets a name.** The scanner marks a manifest-less collection with the `skill-collection` layout, so a source whose every suite carries that layout ships skills and nothing else. A plugin marketplace, a mixed source and a local directory keep the id alone: the first two are named by their own manifests, and a local directory is named by the reader who chose it.
- **A name is added only when the id is ambiguous.** When the id already carries the owner (`jeecgboot-skills`), the row is recognizable as it stands and no name is added.

## Alternatives considered

- **Change the id to `owner-repo`.** Rejected: the id is persisted. A new id would move every install-state key, every `.sources/` directory and every resource id of every source already on disk.
- **Qualify every source, not only the skills ones.** Rejected: a plugin marketplace row already carries its manifest's name, and the market's chip names it. The report is about a market whose name says nothing: a bare `skills`.
- **Let the client derive the name from the URL.** Rejected: the URL is not on the chip's contract, and the client would repeat a parse the catalog already owns, in a second place that can drift.
- **Show the owner only when the id is short.** Rejected: length is not the property that matters. What matters is whether the id says which repository it is. `skills-2` is short and ambiguous, `my-skills` is long and equally ambiguous.

## Consequences

- The market's source chip reads `source.displayName ?? source.id`, so a source stored as `skills` reads as `jeecgboot/skills`, and its id stays the chip's key and the scope the chip selects. Every other reader of the id (the persisted state, the checkout directory, the `market:<sourceId>/<suiteId>` resource ids) sees the same key as before.
- A source that gains a suite which is not a skill collection loses its qualified name: the name follows the source's content, not a rule about its URL.
- The owner-prefixed id rule and the display name read one URL parse, so a change to what a URL says lands in both.

## Verification

- `packages/market-catalog/test/source-name.test.ts` pins the name for a remote skills-only source, for an scp-style URL, for a collided id, and the three cases that carry no name; it asserts through `overviewRows()` that the row keeps its id.
- The id candidates are unchanged: `deriveSourceIdCandidates('https://github.com/jeecgboot/skills')` still answers `['skills', 'jeecgboot-skills']`.
