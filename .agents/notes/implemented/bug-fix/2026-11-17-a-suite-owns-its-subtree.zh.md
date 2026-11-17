# Agent Note: A suite owns its subtree

Status: implemented

## Problem

Marketplace 发现会在目录索引产出套件之后，继续遍历 `plugins/`、`external_plugins/` 与 `skills/`，补充索引没有列出的包。这次遍历只问候选目录有没有套件清单，从不问它是否位于同一轮扫描已经解析出的套件之内。`JuliusBrussee/caveman` 在 `./` 声明了一个插件 `caveman`，又在 `plugins/caveman` 放了同一插件的 Codex 打包副本，其中六项技能是根套件二十二项的子集。扫描把两个根都发布成 id 为 `caveman` 的套件。安装态、套件数据目录、挂载键与预设资源 id 都以 `${sourceId}/${suiteId}` 为键（`packages/market-catalog/src/scanning/paths.ts`），于是一条安装记录同时点亮两张卡，技能页列出二十八行，预设编辑器把一个名字渲染成两种身份。持久化索引记录了两个套件且没有任何注记，这个凭空出现的套件完全静默。

## Decision

已解析的套件拥有它自己的子树。补充循环（`packages/market-catalog/src/scanning/scan-resolvers.ts` 中的 `MarketplaceStrategy`）跳过位于已解析根之内的候选目录，并写一条扫描注记，同时点名两个 checkout 相对路径（`suite .: "plugins/caveman" is the content of this suite, not a separate suite; skipped`）。这条规则只收窄补充发现：目录索引明确声明的条目保持权威，所以声明了 `plugins/alpha`、同时未声明的兄弟目录 `plugins/beta` 自带清单时，仍然得到两个套件。

`SOURCE_INDEX_VERSION` 从 1 升到 2（`packages/market-catalog/src/application/source-index-schema.ts`）。版本 1 的记录可能把嵌套包描述成套件；版本不匹配会让读取方丢弃该记录并重新发现来源，而不是继续使用旧的形状。

`docs/user/sources.md` 及其中文对照在描述补充发现的位置写明了这条边界。

### What the rule does not decide

来自不同根、清洗后 id 相同的两个套件仍然共用一个安装键。任何布局都可能产出同名兄弟套件，消除它属于身份模型的决定（以 checkout 相对路径作为套件键），会迁移 `state.json`、套件数据目录、挂载键与预设 id。边界规则移除了产生本次缺陷的那个情形，但并未声称身份模型不会撞车。

## Alternatives considered

**发现结束后按 id 去重。** 保留第一个套件、把后来的改名或丢弃，是在治标：嵌套的打包副本仍然有资格成为可安装套件，改名后的副本还会留下两张外观相同、技能重名的卡片。

**彻底删除容器补充。** 这次遍历服务于"目录索引只声明了 `plugins/` 下部分包"的来源；删掉它会让其余包无法被发现。边界规则保留了这一场景。

**以 checkout 相对路径作为套件键。** 在结构上不会碰撞，但它改变了持久化的 `sourceId/suiteId` 键，而安装态、数据目录、挂载注册表与预设资源 id 都在用它。那次迁移是与本缺陷分开的决定，已在上文记为待办。

## Consequences

caveman 来源现在产出带二十二项技能的一个套件、一个安装键，没有重复的技能身份。

插件内部的包不再能被隐式安装；想发布它的仓库需要把它写成目录索引条目，这是声明路径，依然可用。

升级后每个来源都会重新发现一次，因为索引版本变了。被丢弃的记录是缓存，不是状态。

同名兄弟套件的耦合仍然存在：将来出现两个不同根、共用清单名的来源，仍然需要上文记录的身份决定。

## Testing

用独立 profile 链接本仓库做浏览器验证：caveman 来源只渲染一张卡，标注 `技能 22 · Hooks 4 · 快捷指令 1 · 专家 3`；技能页显示 `全部 22 / 套件 22`；`state.json` 只有一个键 `caveman/caveman`；持久化索引报告一个套件加一条跳过注记。临时扫描夹具覆盖了保留场景（声明了 `plugins/alpha`，未声明的兄弟 `plugins/beta`）与跳过场景（根套件内部的 `plugins/gamma`）。

## Related

- [Source-owned discovery indexes](../architecture/2026-11-12-source-owned-discovery-indexes.md) 拥有索引生命周期，以及本次升级的版本化记录。
