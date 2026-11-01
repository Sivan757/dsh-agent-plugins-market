# Agent Note: a preset switch says what it changed

Status: implemented

## Problem

The previous round let a preset carry an output style, and selecting such a preset changes how the session answers. That change was silent: the confirmation toast said "preset selected", which is true and useless. The manager also said nothing about what a preset covers, so a reader had to open each face to find out whether a preset carries a style or how many prompt files it lists.

## Decision

- **The confirmation names the style.** Selecting a preset reports `已切换预设 · 输出风格改为 {style}` when the preset carries one, and the plain sentence otherwise. The name comes from the inventory row the id points at, so it is the same text the 输出风格 face shows.
- **The manager states the coverage.** One line under the preset strip reads `开启 132 项能力 · 未带输出风格 · 列出 3 个提示词文件`. The counts come from the same rows the tabs render, so the sentence cannot disagree with them.
- **The guard stays where it was.** The new selection path keeps the modified-selection confirmation and closes the menu exactly as the old one did; only the confirmation copy is new.

## Alternatives considered

- **Say nothing and rely on the 输出风格 face.** Rejected: the reader who switched presets is not looking at that face, and a silent change to how the model answers is the kind of surprise this surface exists to remove.
- **Put the counts on each preset pill.** Rejected: three numbers on every pill is noise when one preset is selected at a time; the line states the current one.

## Consequences

- A preset that changes the style says so at the moment it changes.
- The manager answers "what does this preset cover" without opening a face.

## Verification

- Live in `market-dev`: the manager's line reads `开启 132 项能力 · 未带输出风格 · 列出 3 个提示词文件` for the default preset in this workspace.
- `packages/market-bundle/test/integration/client-extension-presets.test.ts` still pins the modified-selection confirmation and the no-op when the selection is unchanged; the preset suites and the full suite pass.
- The four typechecks and `check:refactor` pass.
