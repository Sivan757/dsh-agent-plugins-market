# Agent Note：源胶囊按 id 的宽度排布

Status: implemented

## Problem

市场页来源条把每个胶囊放进等宽的网格单元。在 id 变长之前这看起来很整齐：`claude-code-plugins-plus-skills` 与 `claude-code-workflows` 在 118px 里都被省略成 `claude-code-plugi…`，挑来源的人必须逐个悬停才能分辨。短 id 省下来的空间也没有被利用。

## Decision

- **胶囊有多宽的标签就多宽，但有上限。** `.sourceTabsRow` 改为按内容宽度排列的 flex 行，每个胶囊上限 220px（单行收藏条早就在用的同一个上限），超过则省略而不是撑开整行。
- **折叠仍然决定高度。** 不管标签多长，两行就是 52px，渐隐、悬停浮层、选中来源排序与选后收起都保持不变：只是轨道尺寸换了。
- **id 按需要的宽度显示。** 在促成这次改动的 profile 上，最长胶囊占 207px 并完整显示；同样两行里能看到的来源也比等宽网格更多。

## Supersession

这构成对[等宽胶囊网格](../feature/2026-09-08-source-strip-fold.zh.md)的**部分**取代：它的折叠、浮层、渐隐与选后收起规则依然成立，只有第一条决策（等宽轨道、固定 118px 下限）被替换。折叠从来不是等宽的理由，它是那条记录解决的高度问题，而折叠现在仍在解决它。

## Alternatives considered

- **提高最小单元宽度。** 否决：160px 仍会截断 31 个字符的 id，而更宽的下限每行能放的胶囊比自然宽度更少。
- **改成固定宽度的横向滚动。** 否决：它会隐藏折叠当前能看到的来源；单行收藏条已经有一个滚动变体，那里的取舍不同。
- **保留等宽、只在悬停时显示完整 id。** 否决：读者必须逐个悬停才能找到某个来源，正是这次要消除的成本。

## Consequences

- 行尾参差而不是齐平；折叠的渐隐本来就盖住最后一行。
- 极长的 id 在 220px 处省略，而不是独占一整行。
- 单行收藏变体保持自己的尺寸规则不变。

## Verification

- `packages/market-ui/test/market-section-render.test.ts` 钉住该行是换行 flex、有 220px 上限、没有 118px 下限。
- 在 `market-dev` profile 对构建产物实测：来源条渲染为 `display: flex; flex-wrap: wrap`，最长胶囊 207px 并完整显示 `claude-code-plugins-plus-skills 438`，两个此前无法分辨的 id 现在屏幕上就能区分。
