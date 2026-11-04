# Agent Note: a failed service can be explained, and only explained

Status: implemented

## Problem

A connector or language server that failed shows a state word, a code, a reason and sometimes a list of causes. Those are the facts the builders established; what the reader usually needs next is the step to take, and the panel could state the problem but never suggest a next move.

## Decision

- **One read-only AI action, in the detail dialog.** `POST ai-diagnose` takes the facts the row already displays and answers prose: the likeliest cause, one to three steps, and, when the facts cannot decide, which fact is missing. The answer renders under the status band, the place the reader is already looking.
- **It cannot change anything.** No retry, no restart, no edit: the route is a model call and a string, and the row keeps the state it had, so a wrong explanation costs a reading.
- **The facts are bounded and rebuilt server-side.** State, code, reason, causes, transport and mount time, each trimmed and truncated to the contract's limits. Endpoints and commands stay in the browser on purpose: an endpoint can carry a credential in its query string, and an explanation is worth less than the leak.
- **The button names what it asks about.** A failed row offers _Explain this failure_; another state, a disabled one included, offers _Explain this state_, because asking a stopped server to explain its failure would be a lie in the label.
- **The same block serves both families.** MCP and LSP share `DiagnoseBlock` and one prompt with a per-family subject line, because the reader's question and the review step are identical.

## Alternatives considered

- **A per-surface explanation copy for MCP and LSP.** Rejected: two prompts, two answer shapes and two places to drift for one reader question.
- **Send the endpoint so the model can reason about reachability.** Rejected: the endpoint is the most likely field to carry a credential, and the panel's own reason already describes what failed without it.
- **Offer it on every row.** Rejected: a mounted connector has nothing to explain, and a button that usually answers that nothing is wrong teaches readers to ignore it.
- **Let the model propose a repair and apply it.** Rejected: that is a configuration change on the strength of an inference. The plugin's own retry and restart actions stay the repair, and they are deterministic.

## Consequences

- The two service surfaces gained a next-step explanation without a new dependency on each other.
- Every explanation costs one bounded model call; the answer names its model and, when a provider reports usage, follows the same field shape the draft surfaces use.
- The failed wording and the state wording are separate keys, so a future state joins the right one without a translation guess.

## Verification

- Live in `market-dev`: the disabled TypeScript server's dialog showed _让 AI 解释这个状态_, the answer named `state: disabled` as the only fact, suggested enabling the server and watching the row, and said which fact was missing rather than inventing one.
- `diagnose-block.test.ts` (4 tests): the request carries the facts, the answer renders in place, a provider limit uses the shared sentence, the state wording differs from the failure wording, and nothing renders before an answer exists.
- `ai-draft-routes.test.ts` (+3 tests): a diagnosis names its route, refuses an unknown family or a failure with no state without calling the model, and bounds what one request can carry.
- Full suite: 2,549 tests pass; gate clean.
