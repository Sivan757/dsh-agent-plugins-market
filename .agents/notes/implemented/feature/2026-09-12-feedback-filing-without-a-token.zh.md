# Agent Note：反馈优先用 gh 命令提交，不再本地暂存

Status: implemented

## 问题

`report_market_issue` 在有 `GITHUB_TOKEN` / `GH_TOKEN` 时通过 GitHub REST API 提交，否则向 `data/feedback/` 追加一条 JSONL 记录。本地暂存解决不了任何问题：没人读它，它永远到不了维护者手里，而「没有 token」是用户无法处理的实现状态。这个工具还绕开了这些用户通常已经登录好的 `gh` 命令。

## 决策

`submitFeedback` 按以下顺序提交：装有并已登录 `gh` 时执行 `gh issue create --repo Sivan757/dsh-agent-plugins-market ...`；有 token 时走 REST API；两者都不可用时不提交任何东西——工具用平台浏览器（与 MCP OAuth 那一程同一个 opener）打开预填好的 `issues/new` 页面，并把完整 issue 文本与该 URL 一起返回，工具描述要求模型把两者都交给用户。本地 JSONL 暂存被删除。60 秒限流只在真正创建了 issue 后才推进。

gh 不存在、未登录、网络失败一律同等处理（返回 undefined 或抛错），以便调用方继续回退；失败文本随返回的 reason 一起给出。外部效果可注入，因此测试不会触达 CLI、网络或浏览器。

## 已考虑的替代方案

**保留本地暂存作为「永不丢失」的回退。** 否决：没人读的文件不是回退；预填页面把报告放到人类会真正提交的地方。

**强制要求 gh，否则失败。** 否决：无头与 CI 环境有 token 但没有 gh，两者都没有的用户也应有可用路径。

**只在服务端打开页面，不把文本交回。** 否决：浏览器可能不可用（无头宿主）或被忽略，而用户仍需要文本才能自行提交。

## 后果

一次提交现在可能以用户点最后一下结束。结果通过 `location`、`issueText` 与 `reason` 区分三条路径，并指示模型转达后两者。`feedbackEnabled` 与工具的注册契约不变。

## 验证

`tests/feedback-tool.test.ts` 覆盖 gh 路径、预填页面路径（URL、已打开页面、完整 issue 文本）、只在真实提交后推进限流，以及注入离线端口后拒绝空标题。
