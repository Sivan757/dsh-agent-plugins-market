# Agent Note: the connectors page names the backend that ignores its policies

Status: implemented

## Problem

Whether a connector's startup timeout and tool filter are enforced at all depends on the mount backend, and the backend is fixed elsewhere: it comes from the profile's plugin configuration, not from this page. The page never said which one was active, so a reader could set a tool filter here and watch it do nothing — the only place the constraint was mentioned was inside one row's detail, and only once that row's tools were opened.

## Decision

- **The list states it, in one line under the header, when the backend is `host`.** The sentence is the one the detail already used (`宿主兼容后端不支持工具勾选；切换到内置客户端后即可按工具启用或停用。`), so the constraint is read where the policy is being configured rather than discovered afterwards.
- **It appears only when it matters.** The built-in backend enforces both, so the page stays quiet in the common case and the line is a fact about this workspace, not a warning that always shows.

## Alternatives considered

- **Add a control to switch the backend here.** Rejected: the backend lives in the profile's plugin configuration, the plugin has no route that writes it, and a control that cannot persist would be the kind of lying affordance this work keeps removing.
- **Put the backend in the header's action row as a chip.** Rejected: it is not an action, and a chip invites a click.

## Consequences

- A reader configuring a policy can see whether the policy is enforced.
- The page gains one line only on the backend where the line is true.

## Verification

- Typechecks, `check:refactor` and the full suite pass; the connector render tests still pass with the line conditional on `payload.backend`.
