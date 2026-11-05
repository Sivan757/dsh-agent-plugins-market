# Agent Note：纯技能市场用「所有者/仓库」命名

Status: implemented

## Problem

源的 id 是键，不是标签。它来自 URL 的 basename，于是不同所有者的两个 `skills` 仓库会撞名：第二个被存成 `skills-2`，读者看到 `skills` 挨着 `skills-2`，却没有任何东西能区分它们。这个裸名字也太短，说不清自己是什么，读者因此挑不对行。

id 不能动。它是持久化状态：每个 `market:<sourceId>/<suiteId>` 资源 id、每条安装状态键、每个 `.sources/` 检出目录都由它构成。

## Decision

- **源行带一个可选的显示名；id 仍然是键。** `SourceOverview.displayName` 是读者认得出来的源名。catalog 在 `market-catalog/src/scanning/source-name.ts` 里计算它，而它绝不顶替资源 id、状态键或检出路径里的 id。
- **名字是「所有者/仓库」，从 URL 读出来。** `scanning/paths.ts` 里的 `parseRemoteRepository()` 从远程 URL 解析出所有者与仓库；带所有者前缀的源 id 与这个限定名共用同一处解析，两者不会在「URL 说了什么」上走偏。`github.com/jeecgboot/skills` 读作 `jeecgboot/skills`。
- **只有远程的纯技能源才拿到名字。** 扫描器给无 manifest 的集合标上 `skill-collection` 布局，所以每个套件都带这个布局的源只提供技能，别无他物。插件市场、混合的源与本地目录都只用 id：前两者由自己的 manifest 命名，本地目录则由选它的读者命名。
- **只有 id 含糊时才加名字。** 当 id 已经带着所有者（`jeecgboot-skills`）时，这一行本身就认得出来，不必再加名字。

## Alternatives considered

- **把 id 改成 `owner-repo`。** 否决：id 是持久化的。改 id 会搬动磁盘上每个源的全部安装状态键、`.sources/` 目录与资源 id。
- **给所有源都加限定名，不只技能源。** 否决：插件市场这一行已经带着自己 manifest 的名字，市场的胶囊也据此称呼。报告说的是名字什么都没说的市场：一个裸的 `skills`。
- **让客户端从 URL 推名字。** 否决：URL 不在胶囊的契约里，而且客户端会把 catalog 已经拥有的解析再写一遍，在第二个可能走偏的地方。
- **只在 id 短的时候加上所有者。** 否决：长度不是关键属性。关键在于 id 有没有说是哪个仓库：`skills-2` 很短却一样含糊，`my-skills` 很长也一样含糊。

## Consequences

- 市场的源胶囊读取 `source.displayName ?? source.id`，因此存成 `skills` 的源读作 `jeecgboot/skills`，而它的 id 仍然是胶囊的键与胶囊选中的范围。读取 id 的其它部件（持久化状态、检出目录、`market:<sourceId>/<suiteId>` 资源 id）看到的键与从前完全一样。
- 一个源若新增了一个非技能集合的套件，就会失去限定名：名字跟着源的内容走，而不是跟着 URL 的形状走。
- 带所有者的 id 规则与显示名共用一处 URL 解析，因此「URL 变了」这件事会同时落在两处。

## Verification

- `packages/market-catalog/test/source-name.test.ts` 钉住远程纯技能源的名字、scp 形式的 URL、撞名后的 id，以及三种不带名字的情况；它还通过 `overviewRows()` 断言这一行保住了自己的 id。
- id 候选没有变化：`deriveSourceIdCandidates('https://github.com/jeecgboot/skills')` 仍然回答 `['skills', 'jeecgboot-skills']`。
