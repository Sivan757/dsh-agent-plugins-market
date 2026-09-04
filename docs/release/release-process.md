# 发版流程

> 策略层（版本号规则、提交纪律）见 `docs/adr/0002-versioning-and-release-policy.md`。

## 自动化现状

release-please 内嵌在 `.github/workflows/npm-publish.yml`（无独立 workflow 文件），负责开 Release PR、打 tag、创建 GitHub Release；同一 workflow 的第二个 job 负责发布 npm（OIDC trusted publishing）。

- 触发：push 到 main（`paths-ignore` 排除 `.github/**`、`docs/**`、`docs-site/**`、`CHANGELOG.md`、`.release-please-*`、README 等，纯文档/CI 提交不触发）+ `workflow_dispatch`
- Release PR：head 固定为 `release-please--branches--main--components--dsh-agent-plugins-market`，base 为 main
- GitHub Release 正文由 release-please 从 CHANGELOG 自动生成，无需人工撰写

## 发版步骤

1. **推送 main**：确认待发提交已合入并 `git push origin main`（需用户确认）。
2. **核对 Release PR**：npm-publish.yml 运行后，release-please 开出/更新 `chore(main): release dsh-agent-plugins-market X.Y.Z` 的 PR；核对其中 package.json version、CHANGELOG 小节、`.release-please-manifest.json` 三处一致，且 quality / CodeQL 为绿。
3. **合并 Release PR**：人工合并（这是唯一必做的人工步骤）。
4. **确认自动发布**：合并后的 main push 再次运行 npm-publish.yml，自动完成打 tag `dsh-agent-plugins-market-vX.Y.Z`、创建 GitHub Release、npm 发布（远端会再跑一遍 `check:refactor` + `test`）。
5. **发后动作**（可选）：手动在自动正文后追加 Highlights / 升级说明；公告投放 README / docs-site / 社区渠道；`npm view @deepseek-ai/dsh-agent-plugins-market dist-tags` 抽查并安装 `@latest` 冒烟。

## 经验教训

- 执行任何远程写操作（`npm publish`、`git push`、`git tag`）前，必须经过用户确认。
