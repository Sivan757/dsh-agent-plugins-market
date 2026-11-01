# Agent Note: the system prompt page is a reading surface first

Status: implemented

## Problem

The owner named three defects on the 系统提示词 tab, and each was a symptom of the same mistake: the page was built as an editor.

- **A card opened the editor.** Reading the chain meant being dropped into a text editor, so browsing felt like an unsaved change.
- **The text toggle did nothing.** The page shows paths, byte counts and status words, all of which are already in the reader's language; a switch between original and translation had nothing to switch.
- **新建 could only create one file.** The list filtered project rows out entirely (`row.scope !== 'project'`), so the project half of the chain was invisible — and the create action, which picked "the first missing user-global candidate", could never make the files that actually live in a repository.

## The questions, answered

1. **Purpose.** Answer two questions: which files the model receives, in which order, and what to change when one of them is wrong.
2. **Who reads it.** Someone debugging "my instruction is not taking effect" — they need order, scope, status, size and the path — and someone who wants to know what is in the chain before editing it.
3. **Who edits it.** The same person, deliberately. The files are plain Markdown; some are the reader's global preference, some are the repository's convention.
4. **Where changes land.** Exactly the file the row names, and the dialog says which: the absolute path, plus the scope (user-global root or project directory), so an edit to `~/AGENTS.md` is never mistaken for one to the repository's.
5. **How it interacts.** List (read-only, host load order, whole chain) → dialog (path, scope, what it contributes, size, budget share, the file's own text) → **Edit** or **Delete**. **Create** opens a menu of the candidates the host would load, named by path and scope.

## Decision

- **The whole chain is listed.** Project rows are no longer filtered; each row's meta line names its scope, so a user-global file and a project file are told apart without a second column.
- **The card opens a read-only dialog** (`InstructionDetail`), which owns 编辑 and 删除. The editor is now reachable only through 编辑.
- **新建 is a choice**, listing every existing-but-missing candidate with its path and scope.
- **The text toggle is gone from this tab.** The toolbar keeps search and the view switch; there is nothing here to translate.

## Alternatives considered

- **Keep the one-click editor but add a preview toggle.** Rejected: it leaves the destructive default in place — the first click still decides the mode for you.
- **Group the list into 用户级 / 项目 sections.** Rejected for now: the surface renderer draws one list, and a section header costs a row per group while the scope in the meta line already answers it. Worth revisiting if the chain grows beyond a handful of rows.
- **Keep the create action creating one default file.** Rejected: it picked a file the reader did not ask for, and the project candidates — the ones that go into version control — were unreachable.

## Consequences

- Browsing the chain cannot change anything; editing is a step the reader takes.
- A reader can create a project `AGENTS.md` from the page for the first time.
- The page's own description in the user doc names the new flow.

## Verification

- `packages/market-ui/test/client-instructions-panel.test.ts` covers: the whole chain in load order (project rows included), a card opening the dialog with the file's text and no editor, 编辑 opening the editor and saving, and 新建 listing the candidates by path.
- The four typechecks, `check:refactor` and the full suite pass.
- The user pages (`instructions.md` and its Chinese pair) describe the same flow and keep equal line counts (62 each).
