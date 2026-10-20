# Agent Note: 设置开关默认开启，并且不再带实验性标签

Status: implemented Date: 2026-10-19

## Problem

设置卡里有两行被门禁拦着。Agent 预设管理器在用户找到开关之前一直是关闭的，而且这一行与翻译行都带着「实验性 / Experimental」标签，读起来像在警告一个插件其实已经交付的功能。翻译行的默认值还跟随界面语言推导：`resolveMarketSettings` 接收语言偏好，`interfaceLanguageTranslates` 回答字段缺席的情况，于是中文默认开启、英文默认关闭。

从未打开设置页的用户因此看不到预设入口，而界面语言还决定了翻译到底跑不跑。

## Decision

两个开关默认开启，两行都不带标签。

- `packages/market-contracts/src/contracts/settings.ts` 里的 `MARKET_SETTINGS_DEFAULTS.translationEnabled` 与 `MARKET_SETTINGS_DEFAULTS.agentPresetsEnabled` 为 `true`，由 `packages/market-bundle/src/platform/settings-schema.ts` 的命名空间 schema 向宿主声明。
- 跟随语言的翻译默认值被移除。`resolveMarketSettings(section)` 只接收一个参数，字段缺席时回答常量；`interfaceLanguageTranslates` 已删除。`resolveTranslationTarget` 仍决定译文写成的语言，且与是否显示译文无关。
- `translationEnabled` 在 schema 里仍不声明默认值。该字段在用户写入之前不进入解析后的设置段，这正是「未触碰的字段」与「存了 false」得以区分的依据，供已自定义标记与「恢复默认」使用。缺席由常量回答。
- 卡片不再给这两行渲染标签。`FieldHead` 只保留覆盖标记，两个语言键从两份字典中删除，浏览器也不再读取 `locale.preference` 去解析默认值。
- 存下的 `false` 对两个字段仍然优先，与其他每个开关一致。

## Alternatives considered

- **保留跟随语言的默认值，只翻转预设开关。** 否决：需求点名了两行，而在一个其余字段都统一的命名空间里，让一个字段拥有自己的推导规则，正是这份契约要避免的第二套「缺席是什么意思」。
- **保留标签，只把开关默认打开。** 否决：标签标记的是需要主动开启。功能已对所有人开启时，它会去标注一个用户已经拥有的能力，并与所在的那一行自相矛盾。
- **既然默认值是常量，就在 schema 里为 `translationEnabled` 声明默认值。** 否决：不声明仍能区分未触碰字段与用户设置过的字段，而这个区别支撑着已自定义标记与恢复路径。常量回答缺席，不必把值物化进解析结果。
- **删掉这两个开关。** 否决：两者都仍是用户的选择。预设入口保持可选，翻译也仍会消耗用户未必想要的模型额度。
- **删掉节点侧的 locale 管线。** 否决：市场自己的文案仍跟随 `locale.preference`，被移除的只是默认值推导那一处读取。

## Consequences

- 任一种界面语言的全新安装，无需打开设置页就会翻译套件、技能、命令、专家、MCP 与 LSP 文本，并显示 Agent 预设管理器入口。
- 英文安装现在默认会因翻译消耗模型额度。关掉它只需一个开关，翻译缓存的重置入口也仍然存在。
- 存下的 `false` 对两个字段仍然优先，回答过这个问题的用户保留自己的答案。
- 卡片与指南里的实验性措辞已移除；没有任何代码路径再为决定设置默认值去读语言。
- [翻译默认值记录](../../archived/feature/2026-10-05-translation-default-follows-language.md)已归档：它以语言推导默认值的决定在此被反转。

## Testing

`packages/market-bundle/test/settings-namespace.test.ts` 断言缺席设置段下两个默认值都为开。`packages/market-bundle/test/integration/translation-gate-consistency.test.ts` 断言开关对任一种界面语言都解析为开、存下的布尔值优先，同时目标语言仍跟随语言。`packages/market-bundle/test/integration/client-plugin-card.test.ts` 断言两行都不渲染标签，`client-translation-settings.test.ts` 覆盖浏览器侧偏好，`packages/market-ui/test/client-agent-presets-gate.test.ts` 覆盖预设门禁。

## Related decisions

[设置与配置卡片沿用宿主](../architecture/2026-09-13-settings-and-card-ride-the-host.md) 拥有默认值放在哪里、卡片如何绑定。
