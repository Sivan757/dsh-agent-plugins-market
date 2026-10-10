# Agent Note: Hook dry run and the stage on the card

Status: implemented

## Problem

The Hooks surfaces showed what a declaration says and never what it does. A user could read the command, the matcher, the timeout and the support verdict, yet a wrong path or a missing interpreter stayed invisible until the event fired inside a session. The same surfaces hid every event but one behind a tab row: with declarations in two events, a user had to switch tabs to learn that the second stage existed at all.

## Decision

One dry run per declaration, and the stage on the card.

`EXTENSION_ROUTES.hookRun` (`/api/agent-plugins/extension-presets/hook-run`) accepts a POST body of `ExtensionHookRunInput`: sourceId, suiteId, event, hookIndex and the resource address's optional sessionId. The body carries identity only. The server resolves the declaration from the same catalog read the overview uses, so a caller never supplies the command. Without a sessionId the lookup covers user and installed rows; with one it widens to that session's project hooks. The working directory is the home directory, never a client-supplied path.

The command runs once with a synthetic event payload on stdin (`hook_event_name`, a `dry-run` session id, `cwd`, `permission_mode`, `dry_run`), the declaration's own timeout capped at 60 seconds, and the same `pluginPathEnvironment` values a real hook process receives. Each stream is capped at 32768 characters, and the result reports `timedOut` and `truncated`. The dialog shows the exit code, the duration, the run note and whichever streams the command wrote. An unknown declaration, a declaration with no admitted hook and a missing shell seam report a stable error in the result instead of failing the request.

Both hooks surfaces drop their per-event `ResourceTabs` row. Every declaration lists together, and `HookResourceCard` shows `detail.event` as a footer tag beside the matcher and the support tag. `packages/market-ui/src/ui/hook-event-grouping.ts` is deleted with the tabs.

## Alternatives considered

- **Accept the command string from the client.** Rejected: the route would execute an arbitrary string, and the same-origin check guards against cross-site requests, it is not an authorization boundary.
- **Run in a throwaway temporary directory.** Offered first; the user chose the home directory, because a hook that keeps state reads its own location under the home directory.
- **Run in the session workspace.** Offered; not chosen, because the command can write to the directory it runs in.
- **Static validation only, with no execution.** Offered; not chosen, because it cannot answer whether the command runs.
- **Keep the event tabs and add the stage tag.** Rejected: the tag names the stage on every row, so the tab row only duplicates it while hiding the other rows.
- **Export every path alias to the run process.** Rejected: a dialect alias is a runtime marker inside suite scripts, and one of them selects another runtime's branch.

## Consequences

- A user sees a broken declaration before a session reaches the event, with the interpreter error and the exit code.
- The command runs in the home directory, so a hook with side effects can change files there. The action is explicit and per declaration.
- The Hooks panel lists all events at once. The search and status filters and the card anatomy stay unchanged.
- With no sessionId the run resolves user and installed rows. A manager row carries the session id, so its project hooks resolve too.

## Testing

Client coverage lives in `tests/client-hooks-status-panel.test.ts`: the tab-free list, the footer stage tag, the dry-run request body and the rendered result. Server coverage lives in `tests/extension-hook-run.test.ts`: declaration resolution by declared position, an unknown address, a rejected declaration with no command, the run path against a fake shell (directory, stdin, timeout, caps, signal, executor rejection) and the route (POST only, cross-origin rejection, unavailable service, malformed address, and that neither a command nor a directory crosses the wire).
