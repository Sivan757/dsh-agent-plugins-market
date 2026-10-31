# Agent Note: a failed connector says why on its own row

Status: implemented

## Problem

Three connectors on the development profile fail to mount, and their rows all said the same thing: **连接失败**. The cause (a timeout, a TLS handshake failure) and the advice ("确认服务可达…") existed, but only inside the detail dialog, one click away. A list whose purpose is to show which rows need attention had no way to show _why_, so a reader either opened all three dialogs or treated them as identical failures.

The same held for the language-engine rows: a server that never mounted carried only 挂载失败 until opened.

## Decision

- **The card states the cause; the detail keeps the advice.** `failureCause` takes a classified guidance sentence and returns the clause before its first separator ("连接超时", "TLS 握手失败", "Connection timed out"), so the row answers the one question a list reader has. The connector and language-engine rows render it in the card's warning tag.
- **The sentence still exists where it is actionable.** The detail dialog keeps the whole sentence with its instructions and the retry action, so nothing was moved out of reach.
- **A row with no reason stays silent.** A mounted row whose last call failed keeps its own wording, and a row the classifier cannot place shows nothing rather than a guess.

## Alternatives considered

- **Put the whole guidance sentence on the card.** Rejected: it is 24 to 60 characters, so in the list view it would ellipsize to its first few words anyway; the cause is the part that survives a narrow column.
- **Add a separate short key per failure shape.** Rejected: 23 more keys in two languages duplicating the first clause of sentences that already exist, and two places to update when a sentence changes.
- **Rely on the tag alone and leave the reason to the tooltip.** Rejected: a tooltip is not visible while scanning, and the objective of this row is exactly to be scannable.

## The advice names the case that produces it

A real profile failed three connectors while its network was fine: every one of them resolved to a LAN address, and the machine's HTTPS traffic went through a local proxy whose tunnel could never reach the LAN, so the requests died in the handshake. The two sentences those failures land on now name that case — 连接超时 / TLS 握手失败 both say an intranet host usually means the proxy is not letting it through, and name the fix (route the domain directly, or add it to `NO_PROXY`). Verified with `curl`: the same three hosts answer `401` in under 150ms with `--noproxy '*'` and time out through `127.0.0.1:7890`.

## Consequences

- Three failing connectors read as three different problems at a glance.
- A locale whose guidance sentences have no separator keeps the whole sentence and lets the row truncate it.
- The classifier stays the single place that decides what a failure is; the card only shows its short form.

## Verification

- Measured in `market-dev` against the real failing connectors: kuboard reads 连接超时, GitLab reads TLS 握手失败, signoz reads 连接超时 — previously all three read 连接失败.
- `packages/market-ui/test/client-failure-guidance.test.ts` asserts the split on both locales, the unchanged fallback, and that a sentence opening with a separator is kept whole.
- `packages/market-ui/test/mcp-status-render.test.ts` asserts a refused mount renders the refusal shape in the card's warning tag and not the timeout advice.
- The four typechecks, `check:refactor` and the full suite pass.
