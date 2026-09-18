# Agent Note: the editor chrome loses its explanatory text

Status: implemented

## Problem

The editors had grown two habits that cost space without answering a question the surface already answered.

1. **Every editor stated its write target under the title.** `保存后写入 ~/.agents/skills/<名称>/SKILL.md` and its five siblings repeated what the title, the mode, and the fields below already said, on the first line of a dialog whose job is to edit a document.
2. **Field hints explained the product to the person using it.** `frontmatter 的 description 决定触发，正文写执行步骤。`, the JSON view's two-views sentence, the persona route caveat, and the source editor's five field hints were mechanism prose attached to fields whose labels already named them.
3. **The service and source forms nested a platform `Input` inside the form sheet's field.** Two edges around one value read as an input inside an input, and it appeared wherever a service or source form asked for a name, a URL, a branch, or a checksum.
4. **A row list's add action was a bordered button under the rows.** It added a 26px control and a gap to every list, for an action that belongs to the list's own label.
5. **Creating an entry put its identity row inside the left pane.** The name field pushed the editing box below the preview box beside it, so the two were only level while editing.

## Decision

- **No editor carries a subtitle.** Title, then content. The write target is the create flow's own business, and the pane chip, the fields, and the panel list already state it.
- **No editor carries a field hint.** The advisory sentences were removed rather than relocated: an explanation of how the product works is not part of filling in a field. What a hint carried as an example moved into the control's placeholder (`https://github.com/org/repo.git` for a URL, `main` for a branch), where it shows up while the field is empty and disappears once it is filled.
- **The save consequence stays.** `创建后立即生效，可在列表里停用` and `未保存的改动会在关闭时丢失` sit beside the buttons: they describe what the action the user is about to take will do, which is the one piece of context a footer owes.
- **Inside an editor, every control comes from the form sheet.** The MCP, LSP, and source editors take native `input` and `select` elements like the document editors do; the platform `Input` is left to the panels' own toolbars, where it is the only control on the line.
- **A row list's add action rides on its label line as a flat icon.** `参数`, `环境变量`, `语言扩展名映射` and the request headers each end their label row with a 20px transparent button that fills on hover, matching the cards' in-row actions; the accessible name stays `<add> <what>` so the row it appends is still named for assistive technology.
- **An entry's identity row sits above the body** (the panes themselves were later removed — see [the single-view note](./2026-09-16-workspace-document-editor-single-view.md)). The create and edit dialogs then differ by that row alone.

## Alternatives considered

- **Keeping the subtitle only while creating.** Rejected: the create dialog's own field labels and the panel's list already say where the entry lands, and the line was the first thing a reader had to skip.
- **Moving each hint into a tooltip on the field's label.** Rejected: it hides mechanism prose behind a hover, which is more machinery for text that earns no place in the form.
- **Keeping the platform `Input` and removing the form sheet's edge instead.** Rejected: the form sheet's 12px control with a `border-l2` edge is the editors' geometry; making the inner control the only styled one would leave the dialog mixing two control sizes again, which is the state the form sheet was introduced to end.
- **Keeping the bordered add button under the rows.** Rejected: it is a whole row and a gap for one verb. The prototype draws it that way, and this is a deliberate departure — the flat icon is the house geometry for an action that belongs to a list.
- **Moving the identity row above the panes only while creating.** Rejected: two layouts for one dialog, and the pane headers would move between modes.
- **Making the JSON views use the code editor as well.** Still declined: the JSON view is a raw document dump owned by the form beside it, and its `aria-label` is the seam the tests drive text through.

## Risks

- Removing the hints drops the one place a URL or checksum format was spelled out in a sentence; the placeholders carry the example, which is shorter but also invisible once the field has a value.
- The add-row icon is a bare `+` on a label line: it is discoverable by hover and by its accessible name, not by a visible verb.
- The identity row above the panes makes the create dialog one row taller than the edit dialog, so the modal's height changes between the two modes.

## Verification

- `pnpm run check:refactor` green; `pnpm run test` 82 files / 638 tests green; `pnpm run build` succeeds.
- Isolated-profile walkthrough: the skill, command, agent-role, MCP, LSP and source dialogs render a title with no subtitle and no hint line; `getBoundingClientRect` reports the editing box and the preview box identical in both create and edit (`240x408`, same top and bottom, measured at `241/481` while creating and `215/455` while editing).
- The LSP and source name fields report a `1px` border on the input and `0px` on its field wrapper, where the platform `Input` had drawn a second edge; `参数`, `环境变量` and `语言扩展名映射` each render one `addIcon` button on their label row.
