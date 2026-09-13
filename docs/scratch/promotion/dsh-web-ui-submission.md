# 向 dsh-web-ui 社区插件索引申请收录 dsh-agent-plugins-market

收录渠道：https://github.com/zhu1090093659/dsh-web-ui —— `docs/plugins.md`「社区插件索引登记」。数据源：`packages/dsh-community-plugins/community.json`（创意工坊商店 + dsh-market.com 的唯一来源，只收录链接不搬代码，维护者审核合并）。

## 1. 追加到 community.json 的条目（建议追加到列表末尾，与其他条目格式一致）

```json
{
  "id": "dsh-agent-plugins-market",
  "name": "插件市场（Claude Code 生态桥）",
  "nameEn": "Agent Plugins Market",
  "author": "Sivan757",
  "description": "把 Claude Code / Codex / Cursor / Kimi 插件市场生态接入 DSH：任意 git 市场仓库加为源，一键安装 suite，skills / MCP / hooks / 斜杠命令 / 子代理在运行时注入会话，Web GUI 内置市场页面。零转换、零拷贝，${CLAUDE_PLUGIN_ROOT} 自动替换，Claude Code 技能原样可用。",
  "descriptionEn": "Bring the Claude Code / Codex / Cursor / Kimi plugin-marketplace ecosystem into DSH: add any git marketplace repo as a source, install suites with one click, and skills / MCP servers / hooks / slash commands / subagents are injected into sessions at runtime, with a market page right inside the Web GUI. Zero conversion, zero file copying; ${CLAUDE_PLUGIN_ROOT} is substituted so Claude Code skills work verbatim.",
  "repo": "https://github.com/Sivan757/dsh-agent-plugins-market",
  "npm": "dsh-agent-plugins-market",
  "category": "tools"
}
```

说明：

- `category` 选 `tools`（与已有的 dsh-plugin-hub 等插件管理类条目一致；现有分类为 agent / integration / knowledge / security / tools / ui / utility）。
- `repo` 用仓库根 URL；`npm` 填 npm 发布名，创意工坊会展示一键安装命令。
- 提交前在 dsh-web-ui 仓库内跑 `node scripts/community-index`（CI 门禁同款校验）。

## 2. PR 标题

```
docs(community): register dsh-agent-plugins-market in the community plugin index
```

## 3. PR 描述（可直接使用）

```markdown
### 注册插件

- **id**: `dsh-agent-plugins-market`
- **npm**: [dsh-agent-plugins-market](https://www.npmjs.com/package/dsh-agent-plugins-market)
- **repo**: https://github.com/Sivan757/dsh-agent-plugins-market
- **category**: tools
- **license**: MIT

### 简介

dsh-agent-plugins-market 把 Claude Code / Codex / Cursor / Kimi 的插件市场生态接入 DeepSeek Harness：把任意 git marketplace 仓库（`.claude-plugin/marketplace.json`、`.codex-plugin`、`.cursor-plugin`、`.kimi-plugin`、agent-plugins.org v1.0.0 等）加为源，即可一键安装 suite，其 skills、MCP servers、hooks、斜杠命令与子代理在运行时注入 DSH 会话——零转换、零文件拷贝，`${CLAUDE_PLUGIN_ROOT}` 自动替换，Claude Code 生态技能原样可用。Web GUI 内置完整市场页面（源管理、搜索、插件详情、预览）。

与 dsh-web-ui 生态互补：dsh-web-ui 提供 Web GUI 的插件与皮肤生态，本插件把外部海量 agent 插件生态（skills / MCP / hooks）引入 DSH 会话运行时。

### 变更

- [ ] `packages/dsh-community-plugins/community.json` 追加条目（1 条）
- [ ] `node scripts/community-index` 校验通过
- [ ] `node scripts/market-build` 重新生成 `market/dist` 并提交（`market:check` 一致）

### 收录原则确认

- 索引只收录链接与元数据，不搬运代码，版权归原作者 ✅
- 仓库为本人维护的活跃上游，MIT License ✅
```

## 4. 操作步骤

1. fork `zhu1090093659/dsh-web-ui`，在分支上编辑 `packages/dsh-community-plugins/community.json` 追加上述条目；
2. 本地 `node scripts/community-index` 校验；
3. `node scripts/market-build` 重新生成 `market/dist` 并一并提交（repo 的 `market:check` 门禁要求生成物与索引一致；如果不想在本地跑全套构建，可在 PR 里说明并请维护者代跑）；
4. 提 PR 到 `zhu1090093659/dsh-web-ui` 的 `main`，等待维护者审核合并；合并后条目自动出现在创意工坊商店与 dsh-market.com。

## 5. 收录之外的加分推广

- dsh-web-ui README 里"社区"章节 + `docs/plugins.md` 都欢迎生态互联，可在 PR 里顺带提议在 README「相关项目」互链（我们 README 已可回链 dsh-web-ui）。
- 该仓库维护者活跃、有明确准入流程，PR 描述里强调互补性（Web GUI 生态 vs agent 运行时注入生态）能提高合并概率。
