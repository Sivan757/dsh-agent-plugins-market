# Agent Note: the service detail's status band is its only state container

Status: implemented

Revised by nothing; revises [a failure report that leads with the cause](2026-09-24-failure-report-with-cause-chain.md).

## Problem

The failure report that fixed the raw-diagnostic lead still lived as a second filled block below the overview table. Three problems survived it:

1. **Two containers, two reds.** The dialog opened with the platform's neutral `.hero` band and then repeated the state in a red-filled reason panel; a retry echo also floated at the very top, furthest from the button that produced it.
2. **The cause sat below the metadata.** A reader asking "is it working, and if not what do I do" had to cross the four-cell overview grid first.
3. **The identity was a machine name.** The title was the mount name (`chrome-devtools__chrome-devtools`), which is also the tool namespace, so the one readable name the row has (`serverKey`) appeared nowhere.

The band's leading edge also had no tone at all, while the inventory card next to it carried a state colour the dialog then contradicted.

## Decision

- **One container per dialog.** `src/client/ui/StatusBand.tsx` renders the state band as the dialog's only state surface, in one fixed order: state dot + tags + the state's single recovery action on the trailing edge, the last operation's echo, the classified reason sentence, the recorded diagnostic behind a host `DisclosureRow`, and the endpoint or command in mono. `FailureReport.tsx` and its module are deleted; the MCP and LSP service details both render `StatusBand`.
- **The edge carries the state, never the prose or the fill.** `bandTone(ResourceState)` maps the card's state vocabulary to the edge tone (active→success, warning→warn, error→error, otherwise neutral); the fill stays the platform's soft neutral. `mcpCardState` / `lspCardState` are the single state source, so a card and its detail band cannot disagree. No dialog text takes the error colour, and no second error-filled panel exists inside a detail dialog.
- **Actions live where the state is.** Retry and re-authorize move from the removed footer into the band's trailing edge; the re-authorization confirmation follows directly under the band as an inline two-button block with no fill. The MCP detail has no footer at all, and no enable switch — the card's switch writes the same override, and the detail is a read-only view (per [the detail-dialog fixes](2026-09-25-detail-dialog-fixes.md)).
- **The retry echo reports the operation, not the service.** It says whether the operation reconnected; the reason below it comes from the refreshed row, so the recorded diagnostic is no longer restated. Only a successful reconnect takes the success colour.
- **Readable identity.** The dialog title and the card's identity line render `serverKey` for plugin rows and `name` for direct rows; the mount name keeps its own mono row (`mcpMountNameLabel`) in the overview, and the card carries it as its `title`.
- **State-aware copy for an empty tool list.** A failed or orphaned row with no tools says the list needs a live connection (`mcpToolsUnreachable`) instead of claiming no tools are registered.

## Alternatives considered

- **Adding a tone modifier to the shared `.hero` in `panel.module.css`.** Rejected: `.hero` is the status band of every detail dialog (suite, user entry, credentials), so a rail and a tone there would restyle surfaces this change does not own. A dedicated component keeps `panel.module.css` byte-identical.
- **Folding the band into `FailureReport` instead of replacing it.** Rejected: the report owned a filled container of its own, which is exactly the second container the reader was seeing; the band has to own the state, the action and the diagnostic together.
- **Routing the re-authorization confirmation through the host's `RiskConfirmation`.** Rejected: uninstall keeps that component because it destroys suite-owned files, while re-authorization is a recovery action whose acknowledgement checkbox would add a step the state does not need. The inline confirm states the consequence and offers cancel/confirm.
- **Keeping the original tone draft where connected/mounted read neutral.** Rejected in favour of the card-shared mapping: two surfaces reporting the same service must not disagree about whether it is healthy.
- **Putting the mount name in the dialog title.** Rejected: the title is the one line a reader scans, and the mount name is a namespace detail; it belongs in the overview next to the service key.

## Consequences

- A new service state is added once, in `mcpCardState` / `lspCardState`, and both the card rail and the band edge follow.
- The reason sentence and its disclosure now sit inside the band, so any future band content has to keep the order the component fixes.
- `mcpReasonLabel` and `lspReasonLabel` are gone: the band's sentence replaces the labelled reason block.

## Verification

- `pnpm run check:quick`, `pnpm run format:check`, `pnpm run check:architecture` and the full suite green (97 files; 847 cases at the rework, plus the tone and LSP-title cases added from review).
- Real-dictionary render of the MCP detail for a `mount-failed` row: the collapsed text leads with `找不到命令：确认它在 PATH 中，或改用绝对路径。`, the recorded English wrapper appears only after expanding `诊断详情`, and the tool block reads `服务未连接，暂时读不到工具清单`.
- An independent read-only reviewer reproduced the contract per file:line, then broke the disclosure switch and the echo in turn to confirm the new cases actually fail (five and one case respectively) and restored the tree byte-identically.
- Tone mapping had no coverage at first — making `bandTone` return a constant kept every case green — so the review's finding is pinned by a case that asserts the band's `data-band-tone` next to the card's `data-resource-state`.
