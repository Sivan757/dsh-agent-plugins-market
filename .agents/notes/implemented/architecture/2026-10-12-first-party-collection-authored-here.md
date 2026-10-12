# The first-party plugin collection is authored in this repository

Date: 2026-10-12. Class: architecture. Status: implemented.

## Decision

The `dsh-agent-plugins` collection (the `plugin-dev`, `toolkit` and `engineering` suites) moves into this repository under `plugins/`. The separate collection repository's role ends with this migration; the content tree is now authored, reviewed and validated here. The market's own scanner validates the collection in the same tree that ships the validator: `packages/market-catalog/test/first-party-plugins.test.ts` runs `scanSource` over every `plugins/<name>` directory and fails the tree when a manifest drifts from the vendored schemas or the scan chain reports a note. The namespace authoring guide joins `docs/reference/harness-namespace-authoring.md`; the collection READMEs ride under `plugins/`. The tree is added to `.prettierignore` — collection content ships byte-for-byte as authored, and prettier has no business reformatting prose assets.

The preset source contract is unchanged. `preset-source.ts` still registers `dsh-agent-plugins` as a git source pointing at the collection repository's URL, and a fresh install still discovers it that way. The URL keeps resolving because the collection repository stays on GitHub; publishing a content change now means pushing the collection repository again after landing the change here.

## Alternatives considered

- **git subtree.** Preserves one-commit dual development, but it needs a second push ritual for every content change and a team convention for why `plugins/` behaves differently from every other directory. The collection had no downstream consumers beyond this plugin, so the second remote carried no weight.
- **Keep two repositories.** The split forced every schema-or-spec change into a cross-repo dance: edit the schemas here, guess the collection impact there, validate by hand. Same-tree validation removes the whole class.
- **Absorb into the npm artifact.** The preset source acquires by git; shipping the tree inside the npm tarball would need a new self-referential source kind plus state migration for existing installs, for no gain over one extra push.

## Consequences

- The repository root gains one directory entry; the root-placement rule is unaffected (a content tree is not a root file).
- Publishing a collection change is two pushes: this repository first, then the collection repository (until it is retired or repurposed).
- The guard test is the conformance gate; it fails the tree, not the scanner, so a scanner change that starts rejecting valid collection content surfaces in the same commit.
