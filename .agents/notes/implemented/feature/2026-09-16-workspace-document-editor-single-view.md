# Agent Note: the document editor shows one view behind a switch

Status: implemented

## Problem

The document editors laid the source and the rendered draft side by side, and the layout worked against the form around it.

1. **Two columns took the dialog's whole width for one document.** The editor ran 408px wide beside an equally wide preview, in a dialog that also has to fit a name field, a command's argument hint, and a role's runtime configuration stacked above them.
2. **The two-column grid was the odd layout in the product.** Every other editor in the plugin — MCP, LSP, and the source dialog — is a single-column form, and the document editors broke that shape to keep the two boxes level.
3. **The preview re-rendered the whole document on every keystroke.** A keystroke in the editor re-parsed and re-rendered the Markdown beside it whether the author wanted it or not.
4. **A large document could not be read comfortably in half a dialog.** The preview scrolled inside a 408px column, and wide code or tables wrapped or clipped.

## Decision

- **One body at a time.** The dialog shows the editing surface, and the segmented control beside the title swaps it for the rendered draft. Both views fill the dialog's full width, so a 300px-tall document is laid out once and read once.
- **The switch rides on the document's own label row.** `编辑 Markdown` / `预览` sit at the right end of the line that names the body (`文档`, `命令正文`, `系统提示词`), drawn by the same bordered track the service editors use for `表单` / `JSON`; the active side carries `aria-pressed`, and opening an editor always starts on the editing view.
- **The preview is on demand.** Nothing re-renders while the author types in the editing view; switching to `预览` renders the current draft, and switching back returns to the editor with the same document and cursor history intact.
- **The editors keep one form shape, and one top gap.** Identity row, then the document's label row with the switch, then the body, then the footer — the same vertical order the service editors use. The host Modal's 20px dialog gap and body margin assume a description under the title; these editors have none, so the editor dialog sets its own 12px gap and clears the body margin, and the title sits 12px above the first field.

## Alternatives considered

- **Keeping both panes and letting each scroll independently.** Rejected: two columns remain two columns — the name field, the argument hint, and the runtime fields above them still sit on a grid that only the document editors use.
- **A toggle that hides the preview but keeps the split.** Rejected: a hidden half leaves the visible half at half width, which is the original complaint.
- **Debounced live preview instead of a switch.** Rejected: it keeps re-rendering work on a timer and still splits the width; the author who wants the draft checked asks for it with one click.
- **A tab strip in the modal's header row.** Rejected: the host modal owns that row, and a control inside the form keeps the dialog's own footer and body self-contained.

## Risks

- The draft's rendered form is one click away rather than always visible, so an author who pastes and saves without switching does not see how it renders.
- `aria-pressed` on a segmented control communicates state to assistive technology; a future third segment would need a radiogroup or a tablist instead.

## Verification

- `pnpm run check:refactor` green; `pnpm run test` 82 files / 638 tests green; `pnpm run build` succeeds.
- Isolated-profile walkthrough: the create dialog reads switch, `名称`, full-width editor, footer; `aria-pressed` flips between the two buttons, the editor unmounts on preview and returns on edit, and typing in the editing view leaves no preview rendering behind.
- Saving from the editing view still issued `POST /api/agent-plugins/user-panel/skills/update?name=review-code` (200) and the file on disk carried the typed line.
