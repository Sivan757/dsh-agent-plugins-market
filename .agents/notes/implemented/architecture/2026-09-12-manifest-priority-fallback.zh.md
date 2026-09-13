# Agent Note：清单按优先级逐级回退

Status: implemented

## 问题

布局识别只读取第一个存在的清单文件，然后停下。若最高优先级清单无法解析、或未通过 v1 校验，整个 checkout 什么都加载不到——即使旁边就放着一份完整的低优先级清单。一个坏文件会让整来源不可用。

## 决策

`readManifest` 会遍历该目录携带的全部清单（`detectManifests`），从高到低返回第一个能解析且通过校验的候选。被拒绝的候选会给出诊断；当低优先级清单胜出时，这些诊断作为该套件的回退说明上报，而不是让套件失败。所有候选都失败时仍然拒绝该套件。

两处既有行为不变：未声明受识别 agent-plugins `$schema` 的根 `plugin.json` 仍按 Claude 兼容清单宽松读取，缺失的组件声明由 `.claude-plugin/plugin.json` 补齐；Marketplace 索引本来就采用第一个能产出套件的索引。

## 已考虑的替代方案

**最高优先级清单无效也继续用它。** 否决：旁边放着完整声明却让来源不可用。

**合并所有清单的声明。** 否决：方言身份会变得含糊，而促使合并的那种缺口已由根/插件组件补充覆盖。

## 后果

同一个仓库现在可能以不同于其最显眼清单的布局被识别；原因会出现在 `SourceOverview.scanNotes` 中。兼容性报告中的抽样结论不变，因为各抽样仓库胜出的清单都是有效的。`detectManifest` 仍返回最高优先级候选，供 `repoName` 之类的身份用途使用。

## 验证

`tests/layouts.test.ts` 覆盖 v1 清单被 schema 校验拒绝、下层 Claude 清单胜出、回退说明，以及全部候选无效时的拒绝；`tests/real-layouts.test.ts` 与 `tests/compat-report.test.ts` 确认抽样仓库保持已记录的结论。
