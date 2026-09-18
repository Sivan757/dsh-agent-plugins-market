# Agent Note: a real editor for the document dialogs

Status: implemented

Superseded in part by [the single-view note](./2026-09-16-workspace-document-editor-single-view.md): the side-by-side panes are gone, and the editor shows one full-width view behind a switch.

## Problem

The document dialogs edit one Markdown file that a user writes by hand, and they offered it as a bare `<textarea>` under two rows of repeated identity.

1. **Editing showed the identity twice.** The dialog's title is the entry's name and the left pane's chip is its file name, yet the body was preceded by a `名称` input holding that same name and a read-only box printing the path the detail dialog had just shown.
2. **The subtitle restated the dialog behind it.** `技能 · 用户` said what the overview rows of the detail dialog said, on a surface the user had already read.
3. **That chrome pushed the two panes apart.** The `文档` label above the body, and the identity row inside the left pane, made the editing box start below the preview box beside it and end at a different height.
4. **A textarea is not an editing surface.** No line numbers, no syntax highlighting, no bracket matching, and no document-level undo — the only code-shaped surface in the product without them.

## Decision

- **`ui/CodeEditor.tsx` wraps CodeMirror 6.** One controlled component takes `value`/`onChange`, a `markdown` or `json` grammar, an accessible `label`, and a `minHeight`; the view is created once and external value changes are dispatched into it, so React stays the owner of the text.
- **The editor's skin comes from the platform tokens.** `EditorView.theme` reads `--dsw-alias-*` for the surface, the text, the gutters, the active line, the selection, and the caret, so both themes follow with no branch, and the frame's border, radius, and background match the form sheet's controls.
- **The Markdown body is that editor.** `EntryEditorModal` renders it where it rendered the textarea; the field wrapper around it is gone.
- **The create-time identity row sits above the panes** ([cleanup note](./2026-09-16-workspace-editor-chrome-cleanup.md)), so both panes are a header and a box in either mode.
- **While editing, the dialog shows the document only.** The subtitle and the identity row are create-time chrome: the title names the entry, the pane chip names the file, and the path is on the detail dialog the user just left. Creating still asks for the name, because nothing else supplies it.
- **The two pane boxes are one size.** The preview box is `border-box` under its 240px floor, and the editor frame is a flex column with the same floor, so both boxes measure 240x408 in the measured locale rather than 266 and 240.
- **A pinned chip line box levels the two headers.** Two chips of different scripts gave the headers 14px and 16px, which moved the box under one of them; the chip's `line-height` and the header's `min-height` are pinned so the header is one height whatever the label says.
- **The document label moves into the editor's accessible name.** `文档` / `命令正文` / `系统提示词` no longer render as a visible row above the box; the pane header already names the surface (`编辑 Markdown`), and the label reaches assistive technology through `aria-label`.

## Alternatives considered

- **Reusing a host editor.** Rejected: there is none. `@deepseek-ai/dsh-client-ui-primitives` exports `CodeBlock`, `JsonBlock`, `ReadBlock`, `DiffBlock`, `TerminalBlock`, and `MarkdownText` — every one of them a read-only renderer — and the harness's own packages declare no CodeMirror or Monaco dependency to borrow. This is the "reuse the host first" rule landing on the host having nothing to reuse, not on skipping the check; the export list above is the check.
- **Monaco.** Rejected: an order of magnitude larger than the client bundle it would enter, and its worker and theming model would have to be reconciled with a page that owns no workers of its own.
- **A syntax-highlighted overlay over the textarea** (a `<pre>` behind a transparent textarea). Rejected: it re-implements line numbers, scrolling, selection, and highlighting alignment by hand, and still has no bracket matching or document undo.
- **Keeping the `文档` label and levelling the panes with a spacer opposite it.** Rejected: the preview pane has no such label in the prototype, so the spacer would be an empty invention to compensate for a redundant row; naming the surface once, in the pane header, is what the prototype already does.
- **Keeping the identity row while editing so one body serves both modes.** Rejected: a rename is not offered (the file name is the identity), so the row could only echo the title and the chip back at the user.
- **Giving the JSON views the editor too.** Not now: the service editors' JSON view is a raw document dump that the form view beside it owns, and swapping it would take the `aria-label` seam its tests drive the text through. The Markdown body is the surface a user writes prose in.

## Risks

- **A new runtime dependency ships in the client bundle.** `@codemirror/state`, `@codemirror/view`, `@codemirror/commands`, `@codemirror/language`, `@codemirror/lang-markdown`, and `@codemirror/lang-json` are declared in `devDependencies` and bundled the way React is, which is correct for a client bundle the installer does not ship its own copies of, but it is bundle weight: the client grew from 448 kB to roughly 750 kB.
- The editor owns its own document, so a caller that resets `value` mid-edit depends on the dispatch effect rather than on a re-render; a second editor instance per dialog would need the same treatment.
- jsdom has no layout, so the alignment above is a browser measurement, not a unit test; the suite pins the component and the wiring, not the geometry.

## Verification

- `pnpm run check:refactor` green; `pnpm run test` 82 files / 638 tests green; `pnpm run build` succeeds (`client/style.css` 51.67 kB).
- Isolated-profile walkthrough, light and dark: the edit dialog renders title, pane headers, editor with line numbers and highlighting, hint, and footer with no subtitle or identity row, and `getBoundingClientRect` reports both pane boxes at 240x408 with the same top (192) and bottom (432).
- Typing into the editor updated the live preview on the next frame, and saving issued `POST /api/agent-plugins/user-panel/skills/update?name=review-code` (200) after which the file on disk ended with the typed line.
