# Duplicate functions

Two identical function bodies in shipped code are a bug, not a style preference. The copy compiles, lints, type-checks and tests exactly as well as the original, so nothing notices it; the cost arrives later, when one copy is fixed and the other keeps the old behaviour. This repository shipped five copies of the same route plumbing, two climb-to-the-project-root helpers, and two groupings of output styles by source before anything looked.

`pnpm run check:duplication` (`scripts/check-duplicate-functions.mjs`) reads this page and fails the tree when a body is duplicated and not recorded here.

## Parsing conventions

- Rows are the Markdown table lines below. Every other line is commentary.
- Columns: `fingerprint` | `copies` | `reason`.
- `fingerprint` is the first 12 hex characters of the SHA-256 of the normalized body, as the gate prints it. It is stable across renames and formatting.
- `copies` is the files involved, for a reader who wants to find them without the gate.
- `reason` says why two copies must both exist. A row that says only "intentional" is not reviewable; name the constraint that keeps them apart.

## What the gate checks

- R1 a body of at least 200 normalized characters appearing in two or more shipped files, with no row here, fails as `duplicate-body`;
- R2 a row whose fingerprint is no longer duplicated fails as `ledger-stale`, so the ledger cannot remain as a permanent suppression list.

Normalization masks what a copy is free to change: whitespace, string contents and numbers. Renaming a parameter or changing a constant therefore does not hide the copy. The unit is a whole function body rather than a line window, because the real pairs here were functions copied verbatim, while sliding-window matching drowns in near-identical error handling.

## Scope

Production sources only, meaning `packages/*/src`. Tests are excluded deliberately: a test that stands up its own fake host reads better with the fake inline than through a shared helper three files away, and pushing them together would buy a green gate with a harder failure to read.

## When to add a row

Almost never. The honest answers are to extract the shared body or to delete one copy. A row is for the case where extraction would be wrong: two providers that must be able to diverge, or a copy that exists to pin a wire format against accidental edits on the other side. Say which, and what breaks if they merge.

## Ledger

| fingerprint | copies | reason |
| ----------- | ------ | ------ |

## Why this page is empty

The tree measured zero duplicated production bodies when the gate landed, because the audit pass before it removed every pair it found. An empty table is the healthy state, and the gate exists so it stays that way.
