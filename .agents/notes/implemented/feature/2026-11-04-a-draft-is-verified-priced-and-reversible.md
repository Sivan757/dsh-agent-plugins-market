# Agent Note: a draft is verified against a real model, priced, and reversible

Status: implemented

## Problem

The drafting surfaces shipped with tests around the route and the field, but nothing had ever answered with a real model. The first live run found a defect the tests could not: both AI routes answered a successful draft without the repo's `ok: true` envelope, and the shared client helper refuses a body without it, so **every successful draft reached the reader as `draft failed: 200`**. The unit tests passed because they read the route's own body, never the client's parser.

Two product gaps surfaced with it. A draft spent the deployment's tokens and never said so, and a draft replaced the editor's text with no way back.

## Decision

- **Live verification is part of shipping an AI surface.** Every face was drafted once against the deployment's model (skills, commands, experts, output styles, system prompt) and the preset manager suggested one selection; the preset was created and then removed. The envelope defect was found there, fixed at the route, and pinned in both route tests.
- **Success answers carry `ok: true`.** Both AI routes now use the repo's write envelope, and the tests assert it, because its absence is indistinguishable from a failed call to a client.
- **Every answer reports what it cost.** `AiDraftResult` and `AiPresetSuggestion` carry the provider's `usage`, and the field prints the model with the input and output tokens in the same line. A provider that reports nothing gets the shorter sentence rather than a fake zero.
- **A draft is reversible.** The field keeps what the editor held when the draft arrived, and the undo button puts it back: the whole document for a face that edits one text, and the prior field pair for the output-style editor, which unpacks a draft into two fields and therefore restores its own snapshot.
- **Auxiliary calls ask for the cheapest thinking the route accepts.** The effort ladder is `off`, `minimal`, `low`, then the deployment's own selection. Drafting and translation are mechanical, and this profile selects `max`, which spent seconds per call on work that does not reason.

## Alternatives considered

- **Trust the unit tests and ship without a live draft.** Rejected: the tests exercised the server contract, and the defect lived between the server's body and the client's parser.
- **Make the client accept a body without `ok`.** Rejected: every other write in this plugin answers `ok: true`; tolerating its absence in one place would hide the next omission instead of surfacing it.
- **Show a token count estimated from the text.** Rejected: the provider's own accounting is exact and free to carry; an estimate would be a second, disagreeing number.
- **Always forward the deployment's reasoning effort.** Rejected after measurement: a draft took about 11 seconds at `max` and 7 to 10 seconds at the cheapest accepted rung, and translation makes the same call for every string on a page.

## Consequences

- A draft now states its model and cost, and can be undone in one press.
- Translation inherits the cheaper effort, which is the same improvement for a surface that calls the model far more often.
- The `ok: true` omission was a shipping defect caught before release; the route tests pin it.

## Verification

- Live, in `market-dev` against `auto/deepseek-v4.1-flash`: skill (frontmatter plus numbered steps), command (`description`, `argument-hint`, body addressing `$ARGUMENTS`), expert (frontmatter plus role instructions), output style (description landed in its field, body in the editor), system prompt (Markdown block), preset suggestion (13 real ids from the rows on offer, preview, created and then removed from the store).
- `ai-draft-field.test.ts` (5 tests) covers the cost line and both undo paths; `ai-draft-routes.test.ts` (11 tests) now asserts `ok: true` on both AI routes.
- Full suite: 2,542 tests pass; gate clean.
