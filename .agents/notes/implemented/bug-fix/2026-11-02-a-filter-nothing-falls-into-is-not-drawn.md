# Agent Note: a filter nothing falls into is not drawn

Status: implemented

## Problem

The owner asked whether the filters help anyone query. Measured in one workspace, several of them could not: the skills face drew 全部 157 · 用户 0 · 套件 157 · 已禁用 88, and the connectors face drew a 已禁用 chip with nothing in it. A chip that can only land on an empty list reads as a filter and behaves like a dead end, and the 用户 0 next to 套件 157 says nothing a reader did not already know.

## Decision

- **A cut with no rows is dropped.** `ResourceSurface` keeps only the cuts whose match set is non-empty, so the strip shows what can actually be queried here. The active cut is kept whatever its count, so a selection never vanishes from under the pointer.
- **When every cut is dropped, the strip goes too.** An empty face already explains itself; a lone "全部 0" tab is the chrome this surface refuses to draw anywhere else.
- **The rule is structural, not data-specific.** The cuts still exist in the panels; the surface simply does not draw the ones that cannot match right now. A workspace with user skills draws 用户 again.

## Alternatives considered

- **Keep zero-count chips as information ("you have no user skills").** Rejected: the face already says what it holds, and a filter is an invitation to click; inviting a reader to an empty list is the opposite of helping them query.
- **Disable the chip instead of hiding it.** Rejected: a disabled chip still occupies the row and still needs explaining, for a cut the reader cannot use.

## Consequences

- The filter row only offers cuts that lead somewhere.
- An empty face shows no filter chrome at all.

## Verification

- Live in `market-dev`: 技能 draws 全部 157 · 套件 157 · 已禁用 88 (the 用户 0 is gone), 连接器 draws 全部 5 · 需处理 1 (no empty 已禁用), and 输出风格, which has no rows, draws no strip.
- `client-extension-preset-v5.test.ts` asserts that the zero-cut chips are absent and that the remaining cuts still filter; the market-ui suite and the full suite pass.
