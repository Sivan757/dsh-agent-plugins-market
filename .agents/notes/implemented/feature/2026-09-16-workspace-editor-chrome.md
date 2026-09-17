# Agent Note: the six editors' dialog chrome

Status: implemented

Superseded in part by [the editor chrome cleanup note](./2026-09-16-workspace-editor-chrome-cleanup.md): no editor carries a subtitle or a field hint any more, the entry body is a real editor, and an entry's identity row sits above the panes so both stay level.

## Problem

The workspace's cards and details were redrawn from the prototype, but its editors were left as whatever the previous chrome happened to be. Reviewing them against the prototype's own implementation exposed five shapes that no screenshot review had caught:

1. **No header subtitle.** Every prototype editor states what the dialog is about on the line under its title — the write target while creating, `name · path` while editing — and MCP/LSP state which file the declaration lands in. The panel editors had a bare title, one of them carrying an unrelated sentence in that slot instead.
2. **No document identity in the panes.** The prototype's left pane header names the file being edited (`SKILL.md`, `<name>.md`) and its right pane marks the preview as live; the panel editors showed two unadorned words.
3. **No footer hint.** The prototype says what happens after saving — `创建后立即生效，可在列表里停用` while creating, `未保存的改动会在关闭时丢失` while editing — and buttons the action is `创建` while creating.
4. **A missing field.** A command declares its argument hint in frontmatter, and the prototype gives it a control beside the name; the panel editor had nowhere to put it, so it was only reachable by hand-editing the YAML.
5. **Service editors were bare add forms.** They had no subtitle, no footer hint, no submit-primary styling, and their name field floated above a mode switch instead of sitting with the transport selector on the identity row, where the prototype puts both.

## Decision

- **One form sheet owns the field geometry.** `ui/form.module.css` carries the prototype's editor primitives — 12px semibold labels in the secondary tone, 12px inputs with 7/9 padding, an 8px radius and a 1px `border-l2` edge, a 240px mono editing box later replaced by a real editor (see the document editor note), a segmented control drawn as one bordered track, a dashed read-only box, row editors with a flat 24px destructive action, and a 26px bordered "add one more" action. The editors' fields are native controls styled by that sheet rather than the platform `Input`, whose 14px text and hairline `border-l4` edge are a different control; the panels' own search field and cards still use the platform components.
- **One header shape for all six editors.** The title alone: a subtitle naming the write target was removed from every editor, because the title, the pane chip, and the form's own fields already say what the dialog will do.
- **Both panes carry their own chip.** The editor pane shows the document's file name; the preview pane shows `实时`, because the preview is rendered from the draft on every keystroke rather than on save.
- **A footer hint states the consequence, not the mechanism.** Creating says the entry is live immediately and can be switched off from the list; editing says unsaved changes are lost. The submit button is `创建` while creating and `保存` while editing.
- **The command editor pairs `名称` with `参数提示`.** The argument hint is real frontmatter (`argument-hint`, with the camelCase alias accepted), read and written through the same document the textarea shows, so the two views cannot disagree.
- **The panel labels are the prototype's.** `名称` / `文档` / `命令正文` / `系统提示词` replace the parenthesised labels; the caveats the prototype wrote as hints were removed rather than moved, and an entry's document label reaches assistive technology as the editor's accessible name rather than as a visible row.
- **The service editors get the same chrome, and one control row.** `名称` and, for MCP, `传输方式` are rendered by `ServerConfigEditor` through a `nameField` prop, above the mode-specific body — so identity fields stay visible in both the form and the JSON view, and the MCP name input occupies a real grid cell instead of floating above the mode switch. The OAuth block becomes a `fieldset` with an `OAuth` legend around its checkbox and scope input.
- **The service form stacks the way the prototype's does.** `命令`, `URL`, `工作目录`, and the row editors span both columns; only the name/transport pair uses the two-column row.
- **The source editor states its fixed facts.** Editing shows a read-only `来源 ID` and a read-only `作用域` (`本地目录 · N 个套件`), plus the prototype's segment wording (`Git 仓库` / `归档包` / `本地路径`) and a plain `移除来源` footer action.
- **`ServerConfigEditor` grew the name slot rather than a second editor.** The service editors already shared one structured form backed by one JSON document; the missing piece was where the identity fields live, so the component takes the field instead of the callers duplicating its grid.

## Alternatives considered

- **Keeping the platform `Input` inside the editor bodies.** Rejected: sitting a 14px hairline control beside a 12px `border-l2` one is what made the forms read as assembled from two systems. The editors are one form language, and the prototype's geometry is the reference a reviewer opens the screenshots against.
- **Keeping the parenthesised labels and skipping the hint.** Rejected: the prototype's caveat reads better as a hint under the field than as part of its label, and a label that carries a validation rule cannot also carry the document's purpose.
- **Adding the prototype's `工具` selector to the role form.** Rejected: the prototype's control is a two-option demo (`全部` / `只读`) with no product semantics behind it — this panel stores an arbitrary `tools` list in frontmatter, and mapping one option onto it would invent a meaning the executor does not implement. The effective route is stated instead.
- **Letting the entry editor rename an entry on save.** Rejected: a user-panel entry is keyed by its file name, so the name is the identity; the editor shows the path it will write to and keeps the name fixed rather than offering an edit the store cannot honour.
- **Giving MCP and LSP an edit entry point on the card.** Rejected for now: an existing service's configuration is edited in place from its detail dialog, which has the service's resolved, redacted config to work from; adding a second editor would create a path with less information to validate against.
- **Reusing the source editor's `description` slot for its field hints.** Rejected: the hints belong under the fields they explain, which is where the prototype puts them and where the source editor already put two of them.
- **A second copy of the service form for the create dialog.** Rejected: `ServerConfigEditor` already owns the JSON/form duality, the row editors, and the validity contract shared with the detail dialog; a copy would drift from it.

## Risks

- The form sheet is editor-scoped by design: a field added to a panel outside it keeps the platform geometry, which is right for a toolbar and wrong inside a dialog.
- The subtitle hard-codes `~/.agents` as the user-content root, which is the default; a deployment that sets `DSH_AGENTS_HOME` shows the default path in the create flow, where no absolute path is available to the client.
- `ServerConfigEditor`'s `nameField` is optional, so a future call site that omits it gets the old single-column transport placement; the two current call sites both pass it.
- The entry editor's create-only pairing of `名称` with a second field is expressed as a render prop, so a new short identity field has to be added by the caller rather than by the shared editor.

## Verification

- `pnpm run check:refactor` green; `pnpm run test` 82 files / 638 tests green; `pnpm run build` succeeds.
- Isolated-profile walkthrough (`dsh --profile ui-check --port 3103` with `DSH_AGENTS_HOME` pointed at a scratch directory): the skill, command, agent-role, MCP, LSP, source-add and source-edit dialogs each rendered their title, subtitle, pane chips or control row, field hints and footer hint, with the command's `参数提示` pairing and the source editor's `作用域` read-out present.
