# Agent Note：概览网格自己平衡列数

Status: implemented

## Problem

每个详情弹窗都用同一张网格画事实，而列数由面板宽度决定。四列之下，五个字段的弹窗会把四个字段排一行、第五个单独落在第一列下面；六个字段读作 4+2，七个读作 4+3——在读者用来对照数值的界面上，最后一行总是参差不齐。

## Decision

- **网格按格子数决定列数。** 四个以内一行；超过时按「最多四列」的最少行数来分：五格变 3+2，六格 3+3，七格 4+3，八格 4+4。
- **一个组件持有它。** `ui/DetailRows.tsx` 的 `KvGrid` 渲染 `dl` 并设置内联模板，于是原先手写 `panelCss.kvGrid` 的六处改为传格子，不会再各自漂移：MCP、LSP、系统提示词、套件、钩子、条目的详情都换了。
- **样式表保留响应式下限。** `.kvGrid` 仍是 `auto-fit minmax(170px, 1fr)`，供任何直接使用该 class 的地方；内联模板只替换列数，窄面板依然会折行。

## Alternatives considered

- **一律两列。** 否决：三个字段的弹窗会浪费一半宽度，而路径需要宽度。
- **让最后一格横跨剩余列。** 否决：四个一格之后又来一条整行数值，会读成另一种事实，而它不是。
- **保留 `auto-fit`，接受参差。** 否决：这正是对照数值的地方，而空白格恰好是视线落点。

## Consequences

- 每个详情弹窗现在都收在整行上。
- 新弹窗只要渲染 `KvGrid` 而不是裸 `dl`，就继承这个行为。

## Verification

- 在 `market-dev` 实测：系统提示词详情的五个字段排成两行 3+2（实测：747px 网格里五个格子只有两个不同的行顶），此前同一弹窗是 4+1。
- `packages/market-ui/test/mcp-status-render.test.ts`、`lsp-seam-render.test.ts` 与 `client-instructions-panel.test.ts` 在新网格下依然通过。
- 四个类型检查、`check:refactor` 与全量测试通过。
