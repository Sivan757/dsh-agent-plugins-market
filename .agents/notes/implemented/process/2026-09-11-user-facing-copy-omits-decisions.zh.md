# Agent Note: 面向用户的文案不展示决策与多余提示

Status: implemented

## Problem

本仓库面向用户的界面曾携带内部取舍的理由。例如代理角色编辑器会告诉读者：`tools` / `disallowedTools` 仍保存在 frontmatter 中但不生效，因为它们写的是 Claude Code 工具名——这句话讲的是本插件为何不再翻译外来工具方言，而不是读者能做什么。这类文案要求插件使用者记住一个实现决策、把注意力花在我们的推演上，并且在该决策被重新审视的那一刻就过期。这种泄漏也没有停止线：README、使用指南、文档站、`src/client/locales.ts` 中的面板文案和代码注释各自决定要暴露多少推理过程。

## Decision

面向用户的文档与注释只说明用户能得到什么、可以做什么。它们不呈现决策信息——内部选择的理由、被否决的方案、放弃了什么——也不携带无人索要的提示。覆盖范围包括中英文 README、`docs/`、`docs-site/`、`src/client/locales.ts` 中的面板文案以及代码注释。理由存放在面向开发者的 Agent Notes 与 ADR 中。

首次落地删除了 `src/client/locales.ts` 两张语言表中的 `personaToolsHint`，以及 `src/client/features/personas/RoleMetadataFields.tsx` 中渲染它的段落。

## 边界

改变读者行为的提示保留：哪种声明实际生效、某个控件会做什么、报错要求读者做什么。解释内部机制为何如此、或说明我们选了什么放弃了什么的语句删掉。同一次修改里 `personaModelHint` 得以保留正因如此——它告诉读者只有 `provider` + `model` 成对声明才生效，而被删掉的那句解释的是一个 Claude Code 字段的命运。

## Alternatives considered

**改写解释而不是删除。** 否决，因为有问题的正是理由本身：句子再紧凑，仍然要求插件使用者记住一个只对贡献者有意义的实现决策。

**把解释留在面向用户的文档里，只清理界面。** 否决，因为文档与面板同样是面向用户的。文档的读者是在安装和运行插件，而不是在重建执行器为何停止转换 Claude 工具名。

## Consequences

面向用户的界面更短，并停留在读者的任务上。代价是理由退到 `.agents/notes/` 与 `docs/adr/` 一步之外，贡献者需要去那里查阅而不能再就地读到。这条边界也依赖判断——一个能省下一轮答疑的提示，看起来可能就像没人索要的提示——因此由评审把关，而非门禁。它约束新增和改动到的文案：README 与 `docs/guides/agent-roles*.md` 中仍在解释 `tools` / `disallowedTools` 决策的用户可见文字尚未重写。

## Related

[代理角色经宿主 continuation 接缝委派](../architecture/2026-09-10-agent-role-delegation-via-host-continuation.md) 拥有本次要求不进入用户可见文案的 `tools` / `disallowedTools` 已发布行为。[README 信息结构](2026-09-08-readme-information-structure.md) 此前已约束 README 呈现什么，并按用户要求移除了仓库与发布版本差异提示；本记录把这一立场推广到所有面向用户的界面，因此部分取代该记录的文案规则，其结构决策保持有效。两条记录均保持活跃并互相链接。
