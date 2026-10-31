# Agent Note: a reconnecting row says how long it has been down

Status: implemented

## Problem

The owner's list has one line the panel could only half answer: "断开不知道为什么重连连大几十秒连不上". The row already named the attempt (`第 2/5 次`), the next attempt's countdown (`45 秒后重试`) and the last error, so "how often" and "how soon" were covered. What no surface said was **how long the outage had already lasted** — the one number that turns "it retries a lot" into "it has been down for a minute and a half".

## Decision

- **The connection sentence carries the elapsed time.** `mcpConnectionNote` reads `connection.since`, which the supervisor already records, and appends `已断开 46 秒` (or `已断开 3 分钟` past ninety seconds) between the attempt and the countdown. Below one second it stays silent, so a row that just dropped does not claim an outage.
- **The sentence stays one line.** Attempt, elapsed, next retry, last error: four facts, one sentence, in the order a reader asks for them.

## Alternatives considered

- **A separate "已断开" line or badge.** Rejected: it would repeat on every repaint and the card has one line for a reason; the fact belongs in the sentence that already reports the reconnect.
- **A live-updating counter.** Rejected: the panel already schedules its next status read off the supervisor's own timer, so the number refreshes exactly when something can have changed; a second timer would only animate.
- **Always show seconds.** Rejected: past ninety seconds a reader thinks in minutes, and "已断开 187 秒" makes them do the division.

## Consequences

- A long outage is distinguishable from a fresh drop at a glance, without opening the detail.
- The detail's connection line and the card's note use the same sentence, so the two cannot drift.

## Verification

- `packages/market-ui/test/mcp-connection-wait.test.ts` pins the seconds form (46 s) and the minutes form (3 m), and that a sub-second outage adds nothing.
- `packages/market-bundle/test/integration/client-mcp-detail-actions.test.ts` pins the stopped-supervisor sentence and now passes the row's own clock, so an epoch timestamp cannot read as a centuries-long outage.
- The four typechecks, `check:refactor` and the full suite pass.
