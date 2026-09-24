# Agent Note: a failure report that leads with the cause

Status: implemented

## Problem

The MCP service detail printed the raw diagnostic the mount pipeline recorded. That string is written by the layer that failed and wrapped around the bridge's internal server name — `mount failed: mcp-client(chrome-devtools__chrome-devtools): initial connection or tool synchronization failed` — and the same string appeared twice in one dialog: concatenated into the retry echo at the top, and again under `原因`. Every reason block was painted in the error colour, including the states that are not failures (a service switched off by an override, a mount another MCP client owns).

The cause behind the wrapper never reached the panel. The bridge throws one fixed sentence and puts the real failure in `cause` (`src/runtime/mcp-client/bridge.ts`), and the mount pipeline read `error.message` only, so a spawn failure, a refused connection and a handshake timeout all arrived as the same sentence. The client's classifier matched its regexes against that sentence, which is why the dialog offered no next thing to check for the most common failure it sees. The LSP detail dialog rendered the same block with the same problem, from its own English reasons.

## Decision

- **The runtime records the cause chain.** `src/runtime/failure-detail.ts` walks `cause` from the mount error, redacts URLs, de-duplicates, stops on a chain that points back at itself, and keeps at most four messages. Both mount pipelines put them on the diagnostic as `causes`, and both status builders carry the recorded `code` and `causes` to the wire: `McpStatusEntry` and `LspStatusEntry` in `src/contracts/` gain the field, and `LspStatusEntry` gains `code` as well, which it never reported.
- **The reasons the status builder writes itself now have codes.** `disabled by override`, `modified by override` and `MCP tools remain after this plugin surface was disabled` carry `disabled-override`, `modified-override` and `orphaned-tools`, so the panel localizes them instead of printing English prose next to Chinese controls.
- **One shared failure report.** `src/client/ui/FailureReport.tsx` renders a 3px state rail — the error colour only for the states the card also marks as errors — the sentence for the classified failure shape, the one recovery action that state offers, and the recorded diagnostic behind an `aria-expanded` disclosure labelled `诊断详情` / `Diagnostic details`. The MCP and LSP detail dialogs both render it, including the informational cases, so there is one block and one set of tokens rather than two.
- **Classification reads the recorded code first and the wording second.** `src/client/ui/failure-guidance.ts` replaces `src/client/features/mcp-status/diagnostic-guidance.ts`: a recorded code decides on its own, the wording path matches the summary line and the messages under it together, and a `mount-failed` row whose shape is unrecognized gets the one sentence that fits every startup failure instead of nothing at all.
- **The retry echo stops repeating the reason.** It reports whether the operation reconnected; the report below carries the reason, refreshed from the row the operation re-read.

## Alternatives considered

- **Leading with the raw sentence and putting the localized sentence under it.** Rejected: the raw sentence names the wrapper, and the reader's first question is what to check. Keeping it verbatim one disclosure away preserves its use in a bug report or a search.
- **Classifying on the client without carrying the cause chain.** Rejected: classification is only as good as its input. The wrapper sentence carries no shape, so `command not found` stayed unreachable until the chain travelled with it.
- **Localizing the reasons in the runtime.** Rejected: the runtime has no locale, and the host's own sentences are not ours to rewrite. The wire keeps the recorded text and the panel owns presentation, which is the split every other panel already uses.
- **Keeping the all-red reason box and only trimming its text.** Rejected: half the states that render the block are not failures, and an error colour on a service that is simply switched off is what made the dialog read as broken.
- **One report per dialog rather than a shared component.** Rejected: the two dialogs had already drifted into two spellings of the same block, and the second copy is where the raw English survived.

## Consequences

- The status wire gained `causes` and three MCP reason codes, and `LspStatusEntry` gained `code`. A consumer that matched the English `reason` has a stable code to match instead; the recorded text stays for logs and bug reports.
- A new failure shape costs one entry in the guidance table and its two sentences. No rendering code changes, and no new colour or spacing decision.
- A reason the classifier cannot place is shown as recorded rather than replaced by an invented sentence, and its report carries no disclosure because there is nothing hidden behind it.

## Testing

- `tests/failure-detail.test.ts` — chain order, URL redaction, de-duplication, the cycle stop, the four-message cap, and the no-chain case.
- `tests/client-failure-guidance.test.ts` — code-first classification, cause-chain classification over a wrapper sentence, the startup fallback, and a reason left unclassified.
- `tests/client-mcp-detail.test.ts` — the lead sentence for a chain-classified failure, the disclosure hiding and then revealing the wrapper and its cause, an unclassified reason shown as recorded, and the retry echo no longer carrying the reason.
- `tests/client-lsp-detail.test.ts` — the same lead-and-disclose path and the missing-component path for the language-server dialog.
- `tests/mcp-mounts.test.ts`, `tests/mcp-status.test.ts`, `tests/lsp-status.test.ts` — the diagnostics carry the chain and the builder attaches the codes.

## Related

- [服务详情先当档案来读](./2026-09-21-service-detail-skeleton.zh.md) — the dialog order this block sits in; its status row is what this note refines.
- [MCP identity without a session namespace](./2026-09-13-mcp-identity-without-session-namespace.md) — why the recorded sentence repeats a name like `suite__server`.
