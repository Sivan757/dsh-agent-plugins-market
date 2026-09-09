# market_agent 无法运行 Claude 方言 agent 卡片（实测报告）

- 日期：2026-09-08（本机实测，未修改任何代码）
- 方法：在 dsh 会话内调用 `market_agent`（`action: run`），证据取自子会话日志 `~/.dsh/sessions/<project>/<runId>/session.jsonl.zstd`；卡片统计脚本解析 `.sources/**/agents/*.md` 的 frontmatter。
- 与本项目的关系：`market_agent`（`src/runtime/agent-role-router.ts`）是 `feat(workspace)`（`ad924ec`）新引入的 subagent 入口，本报告记录它在真实市场数据上的可用性边界。

---

## 0. 结论速览

1. **模型指定功能本身生效**：`provider` + `model` frontmatter 会被真实下发给子代理（跨 provider 亦生效），证据是子会话 `request/header.config` 与 `request/context`。
2. **但 394/437 张市场 agent 卡片无法被 `market_agent` 运行**：它们的 `tools:` 使用 Claude Code 大写工具名（`Read`/`Bash`/`Grep`…），host 的 `tools.restrict()` 直接抛错，spawn 失败。
3. **另有 324 张卡片因 `model: sonnet|opus|haiku` 被拒绝**：`resolveAgentModel()` 要求裸 id 在已注册 provider 中唯一命中，Claude 别名一律报 `is not advertised`。
4. 这不是意外，而是 `docs/guides/agent-roles.md:17` 的既有设计（"Claude Code tool names and model aliases are not automatically translated"）。但它在产品层面形成"能扫描、能安装、能在面板里列出、**但点不亮**"的落差：本插件的定位是零转换原地注入，agent 卡片却是唯一一类装上就跑不了的 surface。

---

## 1. 实测证据

### 1.1 对照组：模型指定生效

用两个最小探针 persona（`~/.dsh/agent-plugins/user/agents/`，测试后已删除）走 `market_agent` 真实 spawn：

| 探针 frontmatter | 子会话 `request/header.config` | 子会话 `request/context` | 结果 |
| --- | --- | --- | --- |
| `provider: workbuddy` / `model: hy3` | `{"provider":"workbuddy","model":"hy3"}` | `{"provider":"workbuddy","model":"hy3","contextWindow":192000}` | 正常返回 |
| `provider: openai` / `model: gpt-5.6-luna` | `{"provider":"openai","model":"gpt-5.6-luna","maxTokens":256000,"reasoningEffort":"medium"}` | `{"provider":"openai","model":"gpt-5.6-luna","contextWindow":1000000}` | 配置生效，上游 502/503 |

两次都不同于父会话默认的 `deepseek-official/deepseek-v4.1-flash-expires-on-0910`，说明是**真覆盖**而非继承；跨 provider 亦生效。子代理自报的 `model:` 一律是 `unknown`（模型不自知），故判定必须以会话日志为准。

### 1.2 `tools:` 方言导致 spawn 失败

```
market_agent action=run role=["codex-plugin","codex","agents","codex-rescue"]
→ Error: tools.restrict() names unknown global tool "Bash"; known global tools: ask_user_question, bash, …
```

`codex-rescue` 卡片 frontmatter 为 `provider: workbuddy` / `model: hy3` / `tools: Bash`（`~/.dsh/agent-plugins/.sources/codex-plugin/plugins/codex/agents/codex-rescue.md:10-11`）。注意报错来自 `subagents.start()` 内部：`resolveAgentModel()` 已经先执行完成，说明**该卡片的模型解析是成功的，失败与模型无关**。

### 1.3 Claude 模型别名导致拒绝

```
market_agent action=run role=["claude-plugins-official","code-simplifier","agents","code-simplifier"]
→ Error: agent model "opus" is not advertised; configure provider and model explicitly
```

---

## 2. 影响面（本机已安装源实测）

扫描 `.sources/**/agents/*.md` 共 437 张卡片，其中 427 张 frontmatter 可解析：

| 维度                               | 数量         | 后果                                                           |
| ---------------------------------- | ------------ | -------------------------------------------------------------- |
| 声明 `tools:`                      | 394          | **全部**含至少一个 Claude 大写工具名 → `tools.restrict()` 抛错 |
| `model: sonnet` / `opus` / `haiku` | 303 / 16 / 5 | `resolveAgentModel()` 报 `is not advertised`                   |
| `model: inherit`                   | 52           | 可用（继承父会话）                                             |

Claude 工具名出现次数（含带参形式 `Bash(git:*)`、`Agent(ns:name)`）：`Read` 376、`Glob` 295、`Grep` 295、`Write` 264、`Bash` 206、`WebFetch` 121、`Edit` 118、`WebSearch` 106、`Task` 30、`Agent` 25、`TodoWrite` 21，以及 `LS`/`NotebookRead`/`KillShell`/`BashOutput`/`AskUserQuestion`/`Workflow`/`TaskUpdate` 各 1–3。

---

## 3. 根因定位

- 本插件把 frontmatter 的 `tools` / `disallowedTools` 原样透传为 host 的 `toolFilter`：`src/runtime/agent-role-router.ts:156-163`。
- host 侧 `tools.restrict()` 只接受已注册的全局工具名（小写 `bash`、`read`、`grep`…），未知名字直接抛错：`deepseek-harness/packages/core/tools/src/index.ts:1082`。
- 模型侧 `resolveAgentModel()` 只接受"已注册 provider 唯一命中的裸 id"或 `provider/model`：`src/runtime/agent-role-router.ts:77-103`；Claude 别名 `sonnet|opus|haiku` 不是任何 provider 的 model id，因此必然失败（`tests/agent-role-router.test.ts:60` 显式断言了这一点）。
- 单测通过是因为用例只用了 DSH 小写名（`tools: read, grep`，`tests/agent-role-router.test.ts:38`），真实市场数据全部是 Claude 方言，测试数据与生产数据不同源。

---

## 4. 建议方向（未实施，待决策）

三条路线，代价递增：

1. **文档化现状**（零代码）：在面板/文档明示"仅接受 DSH 工具名与已注册模型 id"，用户自行建 user 面板副本改写。代价：394 张卡片继续不可用，与本插件"零转换注入"的卖点冲突。
2. **加方言翻译层**（推荐）：在 `parseAgentRole()` 后加映射表，`Bash→bash`、`Read→read`、`Agent|Task→subagent`、`WebSearch→web_search`、`TodoWrite→todo_write`、`Bash(cmd:*)→bash`、`Agent(ns:name)→subagent`；模型别名按"provider 显式指定时映射到该 provider 的默认/命名模型，否则报错"处理。无法映射的名字（`NotebookRead`、`TaskUpdate`）从 allow 列表剔除（收窄权限方向失败，不是提权）。需要 Agent Note + 更新 `docs/guides/agent-roles.md`。
3. **只映射工具名，模型别名维持报错**：最小改动，但 324 张卡片仍需手改模型。

---

## 5. 复现步骤

```sh
# 1) 模型指定生效（探针 persona 不含 tools 行）
cat > ~/.dsh/agent-plugins/user/agents/zz-model-probe-a.md <<'EOF'
---
name: zz-model-probe-a
description: probe
provider: workbuddy
model: hy3
---
Do not call any tool. Reply: probe ok
EOF
# 会话内：market_agent action=run role=zz-model-probe-a prompt="probe"
# 校验：
zstd -dc ~/.dsh/sessions/<project>/<runId>/session.jsonl.zstd | grep -o '"config":{[^}]*}'

# 2) Claude 工具名失败
# 会话内：market_agent action=run role=["codex-plugin","codex","agents","codex-rescue"] prompt="…"

# 3) Claude 模型别名失败
# 会话内：market_agent action=run role=["claude-plugins-official","code-simplifier","agents","code-simplifier"] prompt="…"
```

测试用探针 persona 已删除，`~/.dsh/agent-plugins/user/agents/` 现为空。
