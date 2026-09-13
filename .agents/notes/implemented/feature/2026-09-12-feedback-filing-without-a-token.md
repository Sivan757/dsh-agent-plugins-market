# Agent Note: Feedback filing prefers the gh CLI and never spools locally

Status: implemented

## Problem

`report_market_issue` filed through the GitHub REST API when `GITHUB_TOKEN` / `GH_TOKEN` was set, and otherwise appended a JSONL record under `data/feedback/`. The spool answered nothing: nothing reads it, it never reaches the maintainers, and "no token" was an implementation state a user could not act on. The tool also bypassed the `gh` CLI that the same users usually already have authenticated.

## Decision

`submitFeedback` files in this order: `gh issue create --repo Sivan757/dsh-agent-plugins-market ...` when gh exists and is authenticated; the REST API when a token is present; otherwise nothing is filed — the tool opens the prefilled `issues/new` page in the platform browser (the same opener the MCP OAuth leg uses) and returns the complete issue text plus that URL, and the tool description tells the model to show both to the human. The local JSONL spool is removed. The 60-second cooldown now advances only when an issue was actually created.

Absence of gh, an unauthenticated CLI and a network failure are treated alike (undefined or a thrown error) so the caller falls through; the failure text rides the returned reason. Effect ports are injectable so tests never reach a CLI, the network or a browser.

## Alternatives considered

**Keep the local spool as a never-lose-it fallback.** Rejected: an unread file is not a fallback; the prefilled page puts the report where a human will submit it.

**Require gh and fail otherwise.** Rejected: headless and CI hosts carry a token but no gh, and a user with neither still gets a working path.

**Open the page server-side without handing back the text.** Rejected: the browser may be unavailable (headless host) or ignored, and the user still needs the text to file the report elsewhere.

## Consequences

A submission may now end with the user doing the final click. The outcome distinguishes the three paths through `location`, `issueText` and `reason`, and the model is instructed to relay the last two. Nothing about `feedbackEnabled` or the tool's registration contract changes.

## Verification

`tests/feedback-tool.test.ts` covers the gh path, the prefilled-page path (URL, opened page, complete issue text), the cooldown advancing only on real submissions, and blank-title rejection with injected offline ports.
