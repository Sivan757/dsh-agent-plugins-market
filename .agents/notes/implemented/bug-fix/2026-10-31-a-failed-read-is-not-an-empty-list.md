# Agent Note: a failed read is not an empty list

Status: implemented

## Problem

I broke the status read on purpose to see what a reader gets. With `/mcp-status` answering 502, the connectors panel showed:

1. **`MCP status failed: 502`** — an English internal label and a bare HTTP code in a Chinese panel.
2. **没有匹配的连接器** — "no matching connectors", under a filter strip reading 全部 0 / 需处理 0 / 已禁用 0, while five connectors existed and only the read had failed. A reader could reasonably conclude their connectors were gone.

The same two defects applied to any panel whose read failed: every `getJson` route threw `new Error('<label> failed: <status>')`, and every list fell back to its "nothing here" copy when the payload was simply absent.

## Decision

- **A failed request is typed.** `RequestFailedError` carries the route label and the status; `getJson` throws it. `clientErrorMessage` renders one localized sentence with the code — 宿主服务返回 502，读不到这一项。稍后重试，或在宿主日志里查看同一时刻的记录 — so the alert says what happened, keeps the one fact a reader can relay, and names the next step.
- **Nothing read is not nothing there.** The connector and language-engine panels say 读不到状态，稍后重试 in the list area and render **no filter tabs**, because three tabs reading zero restate the same false fact.
- **A stale-but-present payload still renders.** The rule only applies while the panel has no rows and an error; a refresh that fails over existing rows keeps showing them.

## Alternatives considered

- **Keep the raw message and add a retry button.** Rejected: the retry already existed next to it; the sentence was the part that did not speak the reader's language.
- **Show a dedicated error panel instead of the list.** Rejected: the alert above the list already carries the failure and the retry, and a second error surface would hide the search and view controls that still work.
- **Hide the empty text entirely on failure.** Rejected: an empty area with no line reads as a rendering bug; one neutral sentence says the state is unknown rather than empty.

## Consequences

- A transport failure now reads as a sentence, in the reader's language, with the code and the next step.
- No panel claims a set is empty because the request that would have filled it failed.
- The typed error is the seam every route already goes through, so future panels inherit it.

## Verification

- Simulated in `market-dev` by failing only `/mcp-status`: the alert reads 宿主服务返回 502，读不到这一项…, the list area reads 读不到状态，稍后重试, and the toolbar carries no filter tabs (measured: 0 tabs, 3 toolbar children).
- `packages/market-ui/test/client-api-timeout.test.ts` asserts the status-carrying sentence replaces the raw message.
- `packages/market-ui/test/mcp-status-render.test.ts` asserts a failed read shows the unreadable line, not `mcpEmpty`, and renders no filter tabs.
- The four typechecks, `check:refactor` and the full suite pass.
