# Agent Note: one action row, one progress surface, one acquisition

Status: implemented

## Problem

The owner reviewed the Agent Plugins workspace by photographing six surfaces and reporting each as 不和谐: not in harmony with the rest of the plugin. Five of the six are layout defects, and the sixth is a defect in the data flow behind them.

| surface | what the photograph showed | measurement |
| --- | --- | --- |
| a user skill's detail dialog | 删除 sat on the hero row, beside the path and the tags, far from the dialog's bottom edge | the button occupied 651,188 in a 800x800 dialog; the dialog's only other button, the header close, sat at 1010,129 |
| adding a repository | a spinner and a step sentence at the bottom of the add dialog repeated what the busy overlay was already saying over the same dialog | two indicators described one acquisition |
| adding a repository | pasting `https://github.com/shadcn-ui/ui` twice registered two source rows | every accepted add appends one row and clones once |
| the MCP create dialog | the form stopped well short of the dialog's own edges, and the transport control read as an empty input holding a small pill | fields ended at 896 in a dialog spanning 252 to 1052; the segmented track was 305 wide for 207 of segments |
| the hook create dialog | it opened at a width no other create dialog uses and led with an inset drafting row the other forms do not have | 380px wide against 800 for every sibling; the drafting field started at 496 while the fields below started at 486 |
| the LSP create dialog | the same short column, so the footer's submit button stood to the right of everything it submits | fields ended at 896, the footer's button at 1028 |

Two of the rows share one cause. A source is acquired and then registered, and nothing checked whether the same acquisition was already registered, so a second add wrote a second row and cloned a second checkout that no reader could tell from the first. The other is the editor's 620px column cap: it was sized for a 640px `md` dialog, and the preset manager's fixed settings frame stretches every dialog opened inside it to 800px, so the cap left 156px of the dialog unused while the footer kept spanning the whole dialog.

The hook dialog's drafting row is the one entry that contradicted a documented stance: [the AI assist page](../../../../docs/user/ai-assist.md) already says a hook is configuration a person owns and an editor does not draft it for them, and [the demo review note](../feature/2026-11-04-the-demo-review-changed-four-things.md) had paired the form with a model that filled it. The code disagreed with its guide, and this change settles the disagreement in the guide's favour.

## Decision

### A detail dialog ends in one action row

A detail's body states facts and shows the document; the dialog's actions stand on the footer row. Applied to every detail this plugin owns:

| detail                                         | footer row                                         |
| ---------------------------------------------- | -------------------------------------------------- |
| `ui/UserEntryDetail.tsx`                       | 删除 (user-authored entries only) · 完成           |
| `ui/HookDetailModal.tsx`                       | 试运行 (runnable declarations only) · 关闭         |
| `features/mcp/McpDetailModal.tsx`              | 删除连接器 · 复制诊断 · 重试连接 · 重新授权 · 关闭 |
| `features/lsp/LspStatusPanel.tsx`              | 复制诊断 · 重启服务 · 完成                         |
| `features/instructions/InstructionDetail.tsx`  | 删除 · 编辑 · 完成 (already)                       |
| `features/output-styles/OutputStylesPanel.tsx` | 编辑 · 删除 · 选用 (already)                       |
| `features/market/SuiteDetail.tsx`              | 安装 / 卸载 (already)                              |

`StatusBand` loses its `action` prop. The band reports a service's condition; it never hosts the repair for it, and with both of its callers moving their actions out, the slot had no user left. The destructive action leads the row so it does not sit beside the close action; the MCP detail's row is the longest at five buttons and relies on the shared footer's wrapping for narrow dialogs.

### A source acquisition reports through the mask alone

The add-source dialog renders no progress line, spinner, or step sentence. The busy overlay is the plugin's one progress surface: it covers the active dialog, marks it inert, and reports that something is running. The dialog keeps its fields, its footer, and its position.

What that removed: the dialog's progress block, its `SourceProgressState`, the polling helper `startSourceProgressPolling`, the client binding `fetchSourceProgress`, and the four locale keys that named the clone steps. Failures reach the reader through the panel's toast, which is where every other mutation failure already lands.

The route is gone with it. [The dialog shell note](2026-11-20-one-dialog-shell-and-one-radius-scale.md) removed `MARKET_ROUTES.progress`, the `SourceProgress` contract, the port method, the store's `progress()` and the step bookkeeping; the store keeps one record of the acquisition in flight, because its checkout probe must not race it.

### One repository is one acquisition

`SourceStore.add` refuses an acquisition the state already holds, before any clone or download starts. The identity is what a source does, not the id it was registered under:

- the kind (git, archive, local), because the same URL means different work on a different transport;
- the URL in its canonical form for a git source (`canonicalGitUrl` folds the `git@host:owner/repo` shorthand, `ssh:`/`git:`, the trailing slash and the `.git` suffix), the expanded path for a local source, and the trimmed URL for an archive;
- the branch, because one repository at two branches is two sources, which is what the branch field is for.

`SourceStore.update` applies the same rule when a patch moves a row onto another row's acquisition. The refusal carries `code: 'source-duplicate'`, which the route passes through and the client turns into one locale line, `sourceDuplicate`, through `clientErrorMessage`.

### An editor column follows the dialog it is in

`.editorBody` no longer caps its width. A service editor's fields now take the column its dialog gives them, so their leading and trailing edges match the dialog's own header and footer instead of stopping 156px short. The `.seg` class gains `align-self: flex-start` so a hand-rolled segmented track sizes to its segments; stretched to its field column it read as an empty input carrying a pill of text.

### The hook form is the same form as its siblings

`features/hooks/HookCreateModal.tsx` moves from the host `Modal` to `DetailModal` and the shared form sheet, which puts it at the same 800px frame and the same footer row as the MCP and LSP editors and gives it the same field geometry. The intent field and the drafting action are gone, and with them the route that backed them: `USER_HOOKS_ROUTES.draft`, `UserHookDraft`, `USER_HOOK_LIMITS.intentChars`, the `createAiHookService` module (`application/ai-hook.ts`), and the client binding `draftUserHook`. The dialog's description now says what the fields ask for and what saving does.

## Alternatives considered

- **Center the 620px column inside the frame instead of filling it.** Rejected: centering aligns the form with nothing. The dialog's header, its footer, and its scrolling body all start at the same 24px inset, and a centered column would leave two margins where the reader sees one page.
- **Give editor dialogs their own 640px width inside the settings frame.** Rejected: the frame exists so nested dialogs do not resize as a reader moves between them, and exempting one family reintroduces exactly the jump it removes. It also only half-fixes the photograph: at 640 the fields would fill the dialog, but the dialog would no longer match the details opened beside it.
- **Return the existing source when a duplicate add arrives.** Rejected: a silent no-op teaches the reader nothing about the row they already have, and a request that asked for a branch, a kind, or an archive digest the existing row does not use would be answered with the wrong source. Refusing names the fact instead.
- **Compare only the URL and drop the branch from the identity.** Rejected: the branch field would become a trap. A reader who added `main` and then asked for `dev` would be told the repository is already registered, and the second branch would be unreachable.
- **Keep the step sentence and drop only the spinner.** Rejected: the sentence still says a second time what the mask says, and the owner asked for the strip to go, not for its animation to stop. Keeping the sentence also keeps the polling that produces it, which is a timer per dialog for information the mask already conveys.
- **Keep the AI draft behind the settings switch that already gates translation and presets.** Rejected: the guide documents that a hook is authored, so a hidden drafting path contradicts the product's own story. A hook is three fields, and the model's contribution was a guess at two of them.

## Consequences

- Detail bodies no longer carry an action. A reader who wants to delete a user entry has two paths to the same confirmation, the card's danger icon and the dialog's footer, and the dialog's own path is now at the bottom edge where the rest of its actions are.
- The MCP detail footer is five buttons on wide dialogs. A narrow dialog wraps the row, which the shared footer supports, and the row reads as the dialog's action set rather than as a toolbar beside a status band.
- Two service editors and one detail block lost their 28px footer buttons as they moved onto the footer row; the footer's uniform size is the subject of [the footer size note](../feature/2026-11-06-one-button-size-per-dialog-footer.md), and its inventory now matches what ships.
- Service editors at an 800px frame carry 752px fields. That is wider than the 620px measure the sheet was written around, and the trade is deliberate: one page edge is worth more than a fixed measure.
- A dialog whose body scrolls no longer shortens its fields: [the dialog shell note](2026-11-20-one-dialog-shell-and-one-radius-scale.md) hides the native scrollbar and paints a floating thumb above the content, so the fields keep the footer's right edge and nothing shifts when a scrollbar appears.
- [The sources guide](../../../../docs/user/sources.md) states that each acquisition is registered once and which URL dialects name the same source, so the refusal is documented where a reader adds one.
- Nothing reads source progress any more: the route, its contract and its store read are deleted, and a later change that wants step-level progress has to introduce its own reader deliberately.

## Verification

- `pnpm run test` is green: 301 files, 2704 tests. The covered surfaces: `packages/market-ui/test/user-panel-surface.test.ts` (the delete moved to the footer row of a user entry's detail, and is absent from a suite entry's), `packages/market-ui/test/client-hook-create-dialog.test.ts` (three fields, no drafting affordance, the save button inside the footer row, the payload it sends), `packages/market-bundle/test/integration/client-mcp-detail.test.ts` and `client-lsp-detail.test.ts` (the band holds no button, the actions are footer buttons), and `packages/market-bundle/test/integration/source-duplicate.test.ts` (a local directory, a git repository in three URL dialects, the same repository on two branches, and an update that points one row at another row's acquisition).
- Live sweep in the `market-demo` profile through ego-browser, with the browser at 1448x1126 and the settings dialog at 800x800:
  - Every tab renders with content: 市场 120 of 1032 cards, 技能 120 of 221, 专家 40, 快捷指令 23, 连接器 2, and 语言引擎, 系统提示词, 输出风格, 钩子 with their empty or single-row states.
  - 市场 controls: search narrows 1032 to 2, the installed filter shows 13, a source chip filters to 1, clearing restores 120 of 1032, and the list and grid switches round-trip.
  - 技能 controls: a missing search term empties the list, clearing restores it, the user filter shows 1, and the translation switch flips its label and its text.
  - Detail dialogs: 删除 moved from 651,188 to 276,847, beside 完成 at 971,847. The suite, skills, expert, command, connector and instruction details each report no action above their footer row.
  - MCP create dialog: fields end at 1028, the same edge as 创建; the transport track is 657 to 866, sized to its three segments. LSP create dialog: fields stayed 5px short of that edge until [the dialog shell note](2026-11-20-one-dialog-shell-and-one-radius-scale.md) took the scrollbar out of the layout.
  - Hook create dialog: 800x800, fields 276 to 1028, footer 取消 at 865 and 保存并追加 ending at 1028, no `[data-ai-draft]` element.
  - Add source: with `https://github.com/shadcn-ui/ui` already registered, submitting it produced the toast 操作失败: 这个来源已经在列表里了，没有重复添加 and left the source count at 32. A failing clone against a nonexistent repository showed one overlay element and zero progress elements inside the dialog, and left the source count and `.sources` unchanged.
- `pnpm run check:quick`, `pnpm run build` and `pnpm run format:check` are green.
