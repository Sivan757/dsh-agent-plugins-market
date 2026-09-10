# Agent Note: 统一布局优先级

Status: implemented

## Problem

套件清单遵循布局注册表，marketplace 路径却单独提升 Claude Code 和 Codex 的优先级。同一来源包含多个方言时，不同发现方式可能采用不同的布局优先级。

## Decision

从 `PLUGIN_LAYOUTS` 按声明顺序直接派生 marketplace 路径，各布局的索引别名保持相邻并按顺序排列。没有专属索引的布局不添加路径；根 `marketplace.json` 不代表某个方言，仍作为最后回退。套件清单顺序保持不变。

仍采用第一个能产出套件的 marketplace；空索引或无效索引允许回退。本决策补充[布局注册表决策](2026-09-09-layout-registry.zh.md)，后者继续负责来源身份与项目作用域，仅 marketplace 顺序在此细化。

## Alternatives considered

**保留两套顺序并解释。** 两套优先级仍保留了用户要求消除的歧义。

**把套件清单改为旧 marketplace 顺序。** 会不必要地改变现有套件身份。从现有注册表派生索引顺序即可消除重复策略。

## Consequences

Universal 索引现在优先于 Claude Code，Cursor 和 Kimi 索引优先于 Codex。含有多个可产出套件索引的来源，刷新后可能展示不同的套件列表。无需修改宿主或迁移数据。集成测试覆盖逐级优先顺序、Codex 别名、根共享索引回退，以及无效和空索引。
