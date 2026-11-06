# Agent Note: one button size per dialog footer

Status: implemented

## Problem

A dialog footer's action row mixes a 28px control with a 36px one, so the buttons do not line up.

The host `Button` has two sizes. `md` is 36px tall with 14px type and `--dsw-radius-md`; `sm` is 28px tall with 12px type and `--dsw-radius-sm`. Two footers chose one button per size:

| footer                                        | the row before                                                                                 |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `features/instructions/InstructionDetail.tsx` | 删除 (`ghost`, `sm`, 28px) · 编辑 (`primary`, `sm`, 28px) · 完成 (`ghost`, default `md`, 36px) |
| `features/lsp/LspStatusPanel.tsx`             | 复制诊断 (`ghost`, `sm`, 28px) · 完成 (`ghost`, default `md`, 36px)                            |

A third footer, the preset manager's in `features/extension-presets/ExtensionPresetEntry.tsx`, stated `sm` on both of its buttons: uniform inside itself, but the one footer in the plugin whose geometry no other dialog shared.

The cause is a pair of `size: 'sm'` props that were added to two footers and never read as a row. The owner photographed the instruction file's dialog — 删除 | 编辑 | 完成 — and reported 有些编辑页的按钮对不齐: on some edit pages the buttons do not line up. The reader sees a short button standing beside a taller one, and the row's baseline breaks.

## Decision

- **A dialog footer's action row is one size.** A footer is a row of peer controls, not a toolbar of mixed weights: the reader presses one of them, and they are read as a set.
- **The house size is `md`.** It is the host's default, it is what every other footer in the plugin already used, and the footer row is the one place in the plugin where the controls are full-size labels rather than inline actions. The measured row of three `md` buttons is 36px tall in the instruction dialog, which is a `size: 'lg'` dialog 800px tall: the row fits with room to spare, and the 编辑 primary button still reads as the primary action at 36px.
- **A footer states no size.** The house size is the host's default, so a footer's buttons pass no `size` prop at all. Saying `size: 'md'` would say the same thing the default already says, and would put the next reader's choice — smaller, or larger — one edit away from the rule.
- **The body keeps its compact controls.** `size: 'sm'` is a fine control size for an inline action inside a body: the credential fields, the server config editor, the user entry's hero delete button, the card's primary action, the diagnosis block, the translation retry, the MCP detail's recovery cluster, the settings card, the hook create dialog's AI draft button, and the language server panel's seam banner and restart band all keep it. The rule is about the footer row, not about every button.

### The audit

Every footer in the plugin, and the size it now uses:

| footer                                                                            | buttons              | size |
| --------------------------------------------------------------------------------- | -------------------- | ---- |
| `ui/AiSelectionModal.tsx`                                                         | 取消, 生成           | md   |
| `ui/HookDetailModal.tsx`                                                          | 关闭                 | md   |
| `ui/panel.tsx` (entry editor)                                                     | 取消, 保存           | md   |
| `ui/panel.tsx` (confirmation)                                                     | 取消, 确认           | md   |
| `ui/ServerConfigModal.tsx`                                                        | 取消                 | md   |
| `ui/ServerConfigDetail.tsx` (the save portaled into the frame)                    | 保存                 | md   |
| `features/instructions/InstructionsPanel.tsx` (editor)                            | 删除, 取消, 保存     | md   |
| `features/instructions/InstructionDetail.tsx`                                     | 删除, 编辑, 完成     | md   |
| `features/output-styles/OutputStylesPanel.tsx` (editor)                           | 取消, 保存           | md   |
| `features/output-styles/OutputStylesPanel.tsx` (detail)                           | 编辑, 删除, 选用     | md   |
| `features/lsp/LspStatusPanel.tsx`                                                 | 复制诊断, 完成       | md   |
| `features/hooks/HookCreateModal.tsx`                                              | 取消, 保存           | md   |
| `features/market/SuiteDetail.tsx`                                                 | 安装 / 卸载          | md   |
| `features/market/SourceEditorModal.tsx`                                           | 移除来源, 取消, 保存 | md   |
| `features/market/MarketSection.tsx`                                               | 取消, 确认删除       | md   |
| `features/market/InstallConfirmModal.tsx`                                         | 取消, 确认安装       | md   |
| `features/extension-presets/ExtensionPresetEntry.tsx` (manager)                   | 设为默认, 保存       | md   |
| `features/extension-presets/ExtensionPresetEntry.tsx` (naming, delete, clipboard) | one button each      | md   |
| `workspace/ExtensionResourceDetail.tsx`                                           | a switch, no button  | —    |

## Alternatives considered

- **Make the whole row `sm` instead.** Rejected: the `md` row fits the dialog it is in — the instruction dialog's footer row is 36px tall inside an 800px-tall `lg` dialog, and its three buttons are 56px wide each — and `sm` would leave the plugin with the opposite house size, one that the host's own default and every other footer already reject.
- **Make 完成 `sm` so it matches the two small buttons.** Rejected: 完成 is the host's default size in every other dialog; shrinking it in two dialogs makes those two the odd ones, and the reader loses the full-size closing control that tells them the dialog's primary action is elsewhere.
- **Fix only the dialog the owner photographed.** Rejected: the language server detail carries the same defect, and the preset manager's footer carries the same deviation.
- **Add a third, smaller footer size to the plugin's own chrome.** Rejected: the host Button has two sizes and the plugin does not re-implement it. A footer row of one size is a rule about which of the two to use, not a third control.

## Consequences

- The instruction file's dialog footer is three 36px buttons on one line, and the language server detail's is two. The rows read as one row.
- The preset manager's footer matches every other dialog's, so a reader who moves between dialogs does not meet a new geometry.
- Two buttons grew by 8px and one footer row by 8px. The dialog's body is the host's scroll region, so it gives the space back rather than clipping.
- The compact body controls are untouched, so nothing outside a footer row changed shape.
- A footer that wants to be compact now has to state it on every button in its row, and the source guard fails when it does.

## Verification

- `packages/market-ui/test/dialog-footer-size.test.ts` renders the instruction file's dialog and the language server's, and asserts that every button in the footer row carries the host's `md` size class; it also reads the plugin's source and fails when any footer expression states a size of its own, including a size added to the helper that builds the suite detail's row. The guard was checked against the pre-change sources: it flags all three of the files this note changed.
- The live measurement, in the `market-demo` profile at the Agent 扩展 → 系统提示词 tab, on the `~/.dsh/AGENTS.md` row:

  | button | before                       | after                        |
  | ------ | ---------------------------- | ---------------------------- |
  | 删除   | 28px, 12px type, 8px radius  | 36px, 14px type, 12px radius |
  | 编辑   | 28px, 12px type, 8px radius  | 36px, 14px type, 12px radius |
  | 完成   | 36px, 14px type, 12px radius | 36px, 14px type, 12px radius |

  All three now occupy the same box (top 890, bottom 926), and the footer row itself is 36px tall.

- `pnpm run typecheck`, `pnpm run lint`, `pnpm run format:check` and `pnpm run test` are green.

The dialog chrome this note completes is recorded in [the one card anatomy note](2026-09-14-workspace-card-anatomy-and-host-affordances.md) and [the dialog chrome note](../bug-fix/2026-09-29-dialog-chrome-and-mode-switch.md); neither recorded a footer's button size, so nothing is superseded.
