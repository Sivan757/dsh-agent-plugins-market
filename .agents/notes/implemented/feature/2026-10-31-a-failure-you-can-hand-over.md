# Agent Note: a failure you can hand to someone else

Status: implemented

## Problem

When a connector or a language server fails, the panel knows the endpoint, the transport, the classified cause and the advice. A reader who wants help had to retype all of it from a screenshot, and the reader on the other end had to guess which of the four failed rows they were looking at.

## Decision

- **One copyable block, one builder.** `ui/diagnostics.ts` renders the surface, the item's name, its state, one fact per line (endpoint or command, transport, tools, reason, advice), the cause chain and the observation time. Facts keep a fixed order and blank values are dropped, because a report is read, not parsed.
- **Both dialogs offer it.** The connector detail puts `复制诊断` in its action row and the language-server detail puts it in the footer, so the same sentence appears in the same place whether the failure is a service or a server.
- **The clipboard result is reported.** `copyText` returns whether the browser accepted the write; a dialog that claimed success while the clipboard API rejected (an unfocused document is enough) would be lying.

## Alternatives considered

- **Copy a JSON blob.** Rejected: the reader is a person in a chat window, and a JSON blob with redacted credentials invites a second round of questions about which field matters.
- **Add the block to the panel instead of a button.** Rejected: it is five lines of text that most readers never need, and it would push the list down on every row (the same defect the tab switch note removed).
- **Localize the fact labels.** Rejected: the labels name the host's data fields (`endpoint`, `transport`), and a translated label is harder to match against a log. The values are already whatever language the panel shows.

## Relation to earlier notes

Builds on [the row that says why](../bug-fix/2026-10-31-a-failed-row-says-why.md) and [one read-failure presentation](../bug-fix/2026-10-31-one-read-failure-presentation.md): those decide what a failure _says_ on screen, this one adds the same words as a block a reader can move off the screen.

## Consequences

- A failure report is one paste, and it names the row.
- The advice sentence that a reader needs is in the block, not only on screen.
- The language-server detail gained its first footer action besides 完成.

## Verification

- Live in `market-dev`: clicking `复制诊断` on the failed `kuboard` connector copied `dsh-agent-plugins-market · 连接器 (MCP) · kuboard` plus `state: 连接失败`, `endpoint: https://kuboard.platform.zealwon.com/mcp`, `transport: streamable-http`, `tools: 0`, the raw reason, the localized advice and `causes: - MCP error -32001: Request timed out`; the dialog echoed 诊断已复制.
- `packages/market-ui/test/client-diagnostics.test.ts` pins the line order, the blank fact drop and both clipboard outcomes.
- `packages/market-ui/test/mcp-status-render.test.ts` opens a failed row and asserts the copied block and the echo.
