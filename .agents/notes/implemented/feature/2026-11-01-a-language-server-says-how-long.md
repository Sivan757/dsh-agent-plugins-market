# Agent Note: a language server says how long its start took

Status: implemented

## Problem

The MCP side learned to report a failed attempt's duration; the language-engine side still could not answer "why has it been starting for thirty seconds". A start that never completes and one that fails immediately read the same: a state word and a reason, no number. The LSP panel's detail had no place for it either.

## Decision

- **The mount path times itself.** `mountWith` wraps the plugin mount and its `await()` — the wait a reader experiences as "still starting" — and puts `mountMs` on the failure diagnostic it returns. `LspMountDiagnostic` and `LspStatusEntry` each grow one optional field, and `deriveState` carries it to both suite rows and direct rows.
- **The card says the seconds, the detail says the milliseconds.** A start that took a second or more appends `· 2.0s` to the cause on the card, the 概览 grid gains `挂载用时  2 毫秒`, and the 复制诊断 block carries `mountMs: 2`.
- **The copied cause is clipped.** The language-server resolution failure appends the whole searched PATH — a couple of thousand characters — so the diagnostics block now cuts any cause at 300 characters. The panel still shows the full sentence; the copy keeps what a message can carry.

## Alternatives considered

- **Time the whole reconcile pass.** Rejected: a slow pass says nothing about which server was slow, and the pass is bounded by the mount queue, not the server.
- **Report the duration only in the log.** Rejected: the same reason as the MCP note — the person asking is looking at the panel.
- **Shorten the PATH message at its source.** Rejected: that sentence is genuinely useful when someone asks what PATH the host searched; the copy is the place that has a length budget.

## Consequences

- A language server that hangs is distinguishable from one whose command is missing.
- The copied block stays readable even when a cause carries an environment dump.
- Successful starts still report no duration (the same recorded follow-up as the MCP side).

## Verification

- Live in `market-dev` with a temporary direct server whose command does not exist: the row reads `失败 · 找不到命令`, the detail shows `挂载用时  2 毫秒`, and the copied block carries `mountMs: 2` before the cause. The temporary `~/.agents/lsp.json` was removed and the row disappeared on the next start; 2 ms is correct for a command that cannot be resolved, and the card correctly omits the seconds under one second.
- `packages/market-bundle/test/integration/lsp-status.test.ts` pins the diagnostic's duration reaching the row.
- `packages/market-ui/test/client-diagnostics.test.ts` pins the cause clip.
- The four typechecks, `check:refactor` and the full suite pass.
