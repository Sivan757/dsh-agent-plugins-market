# Agent Note: the preset row carries the prompt layer too

Status: implemented

## Problem

The owner put it plainly: the preset manager's row was short, and my claim that the two rows were "consistent" was about components, not faces. A preset could name seven capabilities and none of the prompt layer, so the files that decide what the model is told, and the style that decides how it answers, were unreachable from the one surface whose job is to describe a working setup.

The reason was a data model, not a preference: `enabledIds` accepted only `market|skills|commands|agents|mcp|lsp|hooks`, and both prompt surfaces were outside it.

## Decision

- **Both faces exist.** `ExtensionPresetFace` gains `instructions` and `outputStyles`, the id grammar accepts both prefixes, and `PRESET_FACES` lists all nine in the workspace's own order. The two rows are the same row: same rail, same list, same card.
- **A style is a real choice.** The inventory lists every style as a row whose `globalEnabled` is "this is the selected one", the manager's toggle drops the other `outputStyles:` ids before adding this one, and selecting the preset calls a new `applyOutputStyle` port, so the style is actually selected rather than merely recorded.
- **An instruction file is listed, never toggled.** The host injects every existing file and has no per-file switch, so the row carries `unavailableReason: 'instructions-no-switch'`: the card hides its switch, says 会注入 / 不注入 instead of 已启用 / 已停用, tags the scope (`系统提示词 · 用户级` or `· 项目`), and the dialog explains why. Both user-global roots and every project directory appear, because the chain does.
- **The boundary line is rewritten** now that both faces are in the row: it says a style is one choice and instructions have no switch, instead of claiming the prompt layer is "handled by the workspace".

## Alternatives considered

- **Give instruction files a fake switch** that wrote a disabled list the host ignores. Rejected: it would be a control that lies, which is exactly what the owner kept catching.
- **Keep the row at seven and explain the gap.** Rejected: the explanation was already there and did not satisfy the requirement; the faces are what was asked for.
- **Carry the selected style in `ExtensionSelection` as its own field.** Rejected for now: `enabledIds` already travels through every layer the preset selection touches, so one id prefix carries it end to end with no schema migration; a dedicated field can come later if the selection ever needs to distinguish "recorded" from "applied".

## Consequences

- The preset manager and the settings page show the same nine faces.
- Switching to a preset that carries a style changes the workspace's style; a failure there is caught and leaves the capabilities applied.
- An instruction row is honest about being read-only, and says which half of the chain it belongs to.

## Verification

- Live in `market-dev`: the manager's rail reads 市场 技能 专家 快捷指令 连接器 语言引擎系统提示词 输出风格 钩子, and the 系统提示词 face lists three rows — `~/.dsh/AGENTS.md` (系统提示词 · 用户级, 会注入, 6880 bytes) plus the project's `AGENTS.md` (11092 bytes) and `AGENTS.local.md` (7352 bytes) — each without a switch. The 输出风格 face renders empty here because this workspace has no styles yet, which is what the settings tab says too.
- `packages/market-ui/test/workspace-tab-meta.test.ts` pins a face for both prompt keys; `tab-layout-sharing.test.ts` pins that both rows carry them; `packages/market-bundle/test/integration/client-extension-preset-v5.test.ts` pins the nine labels, in order, in a localized build.
- The four typechecks, `check:refactor` and the full suite pass.
