# Agent Note 中文规则

[English](README.md) | 中文

这里只放一种设计文档。**Agent Note** 记录影响本代码库的决策或提案——代码与文档承载不下的*为什么*和*放弃了什么*。本文件定义 Agent Note 的存放位置、何时撰写与[文件格式](#文件格式)。规则沿用 DeepSeek Harness 语料库（`deepseek-harness/.agents/notes/`）并适配本仓库：那里的机械校验门禁（`verify-agent-note-format`、`verify-archived-agent-notes`、i18n 配对门禁）在本仓库不存在，格式靠纪律与评审维护，直到补上门禁。

## 布局与命名

每个 Agent Note 有两个轴，都编码在**路径**里——`{lifecycle}/{class}/yyyy-mm-dd-topic-title.md`：

- **生命周期**（顶层目录）即状态，随状态变化移动：
  - **`proposed/`** — 尚未实现（或只部分实现）的提案。
  - **`implemented/`** — 决策已落地。文件记录决定了什么、放弃了什么，并**与实际交付保持同步**：代码后续移动文件、重命名模块或修改键/默认值时，同一变更内更新对应事实（仅路径、名称、结构——不改决策本身）。见 [implemented/AGENTS.md](implemented/AGENTS.md)。
  - **`rejected/`** — 提案已被考虑并否决。仅当其理由能阻止一个有诱惑力的错误时保留；否则整篇删除。
- **类别**（嵌套目录）是决策的*种类*——见[类别划分](#类别划分)。

文件名中的日期是**首次提出**该主题的日期（依 git 历史）。Agent Note 之间的交叉引用使用相对 markdown 链接（`[topic](../../implemented/architecture/2026-…-….md)`）——不用裸文本或编号——使链接在目录间移动后仍然成立。

活跃生命周期树就是工作清单：浏览目录或搜索仓库。不建集中式 `INDEX.md`——树与搜索承担发现职责，索引是第二个必然过期的缓存。低未来价值的 implemented 记录移入独立的冻结 [`archived/`](archived/AGENTS.md) 树。

## 类别划分

每个 Agent Note 恰好归属封闭集合中的一个类别；新增类别需同步更新本节并在各生命周期下建目录。

| 类别             | 覆盖范围                                                                       |
| ---------------- | ------------------------------------------------------------------------------ |
| `feature`        | 新的用户侧或模型侧能力。                                                       |
| `bug-fix`        | 修复缺陷，或关闭 postmortem 暴露的缺口。                                       |
| `simplification` | 移除代码、行为或表面积，不新增能力。                                           |
| `architecture`   | 关于**交付源码**的结构性决策——`src/` 各层如何关联、运行时词汇是什么。          |
| `process`        | 代码**周边**的工具、政策或流程——发版流程、门禁、CI、包管理器——不涉运行时行为。 |
| `testing`        | 测试基建与测试策略。                                                           |

`architecture` / `process` 的分界：**architecture** 关于我们交付的源码；**process** 关于周边工具与工作流。（刻意不设 `refactor`——它与 `simplification` 重叠，后者的判别式"可观察行为是否变化？"已覆盖。）

## 归档与删除

当已落地的决策完结、其理由不太可能再指导未来工作时，归档该 implemented note。当其备选方案、所有权边界、负面保证、持久化或线上语义、安全规则或重新引入条件仍有用时，保持活跃。proposed 永不归档：过时的提案走否决。rejected 仅在能阻止一个可能的错误时保留；否则中英文一起删除。使用 `dsh-archive-agent-notes` 的校准工作流，而非字数、年龄或配额。

归档路径为 `archived/{class}/yyyy-mm-dd-topic-title.md`；刻意不含 `implemented`，因为只有 implemented 能入档。归档变更移动完整的中英文对、在两个文件的 `Status: implemented` 下一行插入相同的 `Archived: YYYY-MM-DD`、修复或删除入站链接——这是归档时唯一允许的内容改动。本仓库没有封存校验器——冻结靠本规则与评审执行：归档后的文件永不编辑、移动、翻译、重排或删除，也不再作为当前行为的依据。活跃文档在刻意引用历史时仍可链入归档 note。

## 何时撰写

每个非平凡变更必须在同一 PR 内新增或更新至少一个 Agent Note。非平凡指：改变行为、架构、跨文件共享的契约、流程或工具、测试策略、落盘/线上/配置格式，或任何维护者可能合理重访的决策。面向未来的大型工作从 `proposed/` 起步；已定的决策从 `implemented/` 起步。按决策选择类别目录（见[类别划分](#类别划分)）。

更新已拥有该决策的 note 即满足规则，不新建重复。每篇新 note 触发对覆盖同一决策的活跃 note 的 supersession 审计——在同一变更内完成完全或部分接替的归类。纯机械或局部、不改变行为/契约/结构/流程/理由的编辑豁免。Agent Note 永不原地改成*另一个决策*：用新 note 接替并互相链接，除非旧 note 之后被完全合并。

被完全接替的 implemented note 可合并进当前持有者后删除，前提是持有者保留其全部独特理由、备选方案、后果与必要验证，并修复所有入站链接。部分接替不满足条件：两篇保留并互链，仍为事实的内容保持更新。

## 文件格式

### 头部块

每个 Agent Note 的前三行严格为：

```markdown
# Agent Note: <title>

Status: <status>
```

后接空行。`Status:` 取三种形式之一，且必须与所在生命周期目录一致：

- `Status: proposed`
- `Status: implemented`
- `Status: rejected — <一句话理由>`

Status 不带日期与括号注记：文件名持有首次提出日期，git 持有其余一切；"经修订接受"属于正文内容。否决理由是唯一带内容的 status，因为被否决的 Agent Note 中，结论就是读者要的事实。

### 正文骨架

每篇 Agent Note 以 `## Problem` 开篇——动机，须脱离方案独立成立。复用节使用以下规范名且不作他用；真正定制的技术节（schema 细节、挂载生命周期、线上契约）可自由置于必备节之间。

#### `proposed/`

```markdown
## Problem

## Proposal

…定制节…

## Alternatives considered

## Acceptance criteria

## Risks
```

`## Proposal` 描述意图中的变更，在未落地前可以合法使用将来时——计划、迁移步骤与开放问题都属于这里。`## Acceptance criteria` 说明什么可观察状态算完成。`## Risks` 覆盖可能出的问题与明知要放弃的东西。

#### `implemented/`

```markdown
## Problem

## Decision

…定制节…

## Alternatives considered

## Consequences
```

`## Decision` 用现在时描述已交付的现实，全文按 [implemented/AGENTS.md](implemented/AGENTS.md) 与之保持同步。`## Consequences` 记录权衡付出的代价**与**换来的东西。提案时代的标题在这里是规格腔：implemented note 中不出现 `## Proposal`、`## Plan`、`## Migration plan`、`## Acceptance criteria`。`## Testing`、`## Deferred`、`## Related` 在陈述现在时事实时可用。

#### `rejected/`

被否决的 Agent Note 是冻结的提案：保留提案时期的全部节（含 `## Acceptance criteria` 或 `## Plan`），结论写在 `Status:` 行。仅头部块、`## Problem` 开篇、`## Proposal` 节与下文的备选方案强制要求适用。

### Alternatives considered — 强制

每篇 Agent Note 都有 `## Alternatives considered` 节：每个真实备选方案及其落败原因，每个方案一段以加粗开头的段落。记录决策而不记录它击败了什么，等于邀请重新争论——这正是 Agent Note 要防止的失败。备选方案来自真实审议过程记录，绝不事后编造。

### 生命周期间移动

在生命周期目录间移动文件，意味着同一变更内更新 `Status:` 行并重新满足目标目录的骨架。具体地，`proposed/` → `implemented/` 把 `## Proposal` 改写为现在时的 `## Decision`，将 `## Acceptance criteria` 与 `## Risks` 并入 `## Consequences`（或对已锁定行为的部分用现在时的 `## Testing`），删去计划、留下交付事实。`proposed/` → `rejected/` 只在 `Status:` 行补理由并冻结文件。

### 中文对应文件

`.zh.md` 对应文件逐节镜像英文版结构；机器可读的头部记号（`# Agent Note: ` 与 `Status:` 行）保持英文原样。本仓库没有配对门禁——镜像与 `README.zh.md`、`locales.ts` 遵循同一双语纪律维护。
