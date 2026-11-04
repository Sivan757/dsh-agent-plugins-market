# Agent Note: three questions about what a page may read and run

Status: implemented

## Problem

Three questions came out of the same demo review, and each one named a rule the plugin had stated badly rather than broken:

1. The settings page listed a project-level `AGENTS.md` from a workspace it did not belong to.
2. The preset manager showed only some of the faces, so a face the workspace had stowed could not be put in a preset.
3. An installed suite's output style asked for a click before its text existed, and the person asking had not chosen to skip anything.

## Decision

- **A page with no session reads the user level only.** Settings belongs to no workspace, so it answers for the user's own Agent root: `readInstructions(cwd, limits, 'user')` pins the project root at that directory, so no marker is walked, and drops project rows. What it used to do was read `process.cwd()`, which is whatever directory the harness was started in, and report that directory's project file as if the reader had chosen it. Project chains are read for a session, from that session's workspace, and the page says so.
- **The preset manager lists every face.** It used `visibleTabs`, which filters out the tabs the workspace stowed. Stowing is a display choice about the workspace tab row, not a statement that a face has nothing to configure; a preset covers every face, so the editor now walks the stored order directly.
- **A suite style is captured when the face is opened.** The text comes from a program the suite declares, so the row used to wait for **Capture text**. The page now runs that pass once on the first view of each workspace and leaves the action only as a retry. The explicit decision moved one step later and did not disappear: the preview still shows the captured text, and only the switch puts it into the prompt.

## Alternatives considered

- **Keep the settings page truthful instead of scoping it.** Rejected: a settings page cannot be truthful about a workspace it has no way to name. The session-scoped surface is where a project chain has a meaning.
- **Keep the manager filtered and add a show-stowed toggle.** Rejected as an extra control for a list where hiding a face has no upside: a preset that cannot name a face silently cannot configure it.
- **Capture all suite styles at startup.** Rejected: that runs suite programs for readers who never open the face. Opening the face is the smallest event that says the reader is looking.
- **Keep the per-row click.** Rejected by the review: it asks the reader to press a button for the row they already opened the face to read.

## Consequences

- A workspace's first look at the output-style face now runs one program per uncaptured suite style, bounded by the same timeout and output cap as before, and records the capture.
- A captured style still cannot be injected without a selection, and a capture that no longer matches the suite's fingerprint is still refused rather than replayed.
- The preset editor can name every face, including ones the workspace tab row hides.

## Verification

- Live in `market-demo`:
  - 系统提示词 in settings lists `~/.dsh/AGENTS.md` only, its cuts read 全部 1 / 项目 0 / 用户级 1, and the page states that a project file is read for a session;
  - the preset manager's tab row shows all nine faces where it showed six;
  - opening 输出风格 turned the suite card from 未捕获 to 未选用 with no click, and selecting it then reported 使用中 (the demo selection was restored to `builtin:default` afterwards).
- Tests added: a user-scope read with no project rows, the manager's unfiltered face list, and a capture that runs on mount without an action.
- Full suite: 2,562 tests pass; gate clean.
