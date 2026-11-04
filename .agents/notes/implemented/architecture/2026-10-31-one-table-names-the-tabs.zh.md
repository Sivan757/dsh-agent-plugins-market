# Agent Note：一张表给页签命名

Status: implemented

## Problem

负责人两次问到预设管理器与设置页是否共享组件与逻辑。它们已经在共享轨道、列表、工具栏与卡片，但有一段逻辑被复制了四份。

工作区页签行、预设管理器与安装确认各自持有一张「页签 → 标签」的表。预设管理器持有四张：面清单、标签键、计数名词、页签键翻译——因为它的 `agents` 面对应工作区的 `personas` 页签，而它的钩子行用的是自己的标签键（`epHooksTab`）而不是工作区那个。新增一个页签、改一个名词或改一个标签，都要动三个文件，还得留意四张表是否还一致。

## Decision

- **`workspace/tab-meta.ts` 持有答案。** 每个 `WorkspaceTabKey` 一条：页签标签、需要时用来指一类集合的名词，以及预设管理器那边不同的面名。`PRESET_FACES` 是预设能开关的面的字面量元组，`workspaceKeyOfFace` / `faceOfWorkspaceKey` 在两套词汇之间翻译。
- **四张表变成各一次查表。** 预设管理器从元数据取标签与计数，工作区页签行用它构造标签记录，安装确认用它派生计数标签。`epHooksTab` 被删除：它和 `workspaceTabHooks` 说的同一个词，而一个标签两个键正是漂移的起点。
- **提示层不进入预设行，靠数据而不是靠省略。** `instructions` 与 `outputStyles` 没有 `presetFace`，所以面元组不会意外把它们长进去。

## Alternatives considered

- **把预设管理器搬进设置页，让两者渲染同一个组件。** 暂时否决：它属于会话、从输入框上方打开，而负责人没有要求改变这个入口。能共享的部分已经共享，外壳的差异是有意的。
- **保留四张表，加一个「它们一致」的测试。** 否决：比较四份相同数据的测试，是不取消这四份数据的更慢做法。
- **用过滤元数据的方式派生 `PRESET_FACES`。** 否决：过滤得到 `string`，会把断言塞进每个调用点；字面量元组让每个面保持字面量类型。

## Consequences

- 新增一个页签等于契约里一条、元数据里一条。
- 改一个集合的名词会同时到达工作区行、预设计数与安装确认。
- 预设管理器里钩子的标签就是工作区自己的，两行不可能再不一致。

## Verification

- `packages/market-ui/test/workspace-tab-meta.test.ts` 钉住：契约每个键一条、每条都有中英标签与名词、`PRESET_FACES` 与工作区键一一对应、提示层没有面。
- `packages/market-ui/test/tab-layout-sharing.test.ts` 现在用「有市场页签、没有提示层页签」来找预设那一行，因为两行共享同一个钩子标签。
- `packages/market-bundle/test/integration/client-extension-preset-v5.test.ts` 用工作区的标签点击钩子面。
- 四个类型检查、`check:refactor` 与全量测试通过。
