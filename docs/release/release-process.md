# 发版流程

> 策略层（版本号规则、提交纪律）见 `docs/adr/0002-versioning-and-release-policy.md`。

## 自动化现状

release-please 内嵌在 `.github/workflows/npm-publish.yml`（无独立 workflow 文件），负责开 Release PR、打 tag、创建 GitHub Release；同一 workflow 的第二个 job 负责发布 npm（OIDC trusted publishing）。

- 触发：push 到 main（`paths-ignore` 排除 `.github/**`、`docs/**`、`docs-site/**`、`CHANGELOG.md`、`.release-please-*`、README 等，纯文档/CI 提交不触发）+ `workflow_dispatch`
- Release PR：head 固定为 `release-please--branches--main--components--dsh-agent-plugins-market`，base 为 main
- GitHub Release 正文由 release-please 从 CHANGELOG 自动生成，无需人工撰写

## 版本号的两种模式

| 模式 | 触发方式 | 版本来源 |
| --- | --- | --- |
| **自动**（默认） | push 到 main | 上次发版以来的 conventional commits：`feat:` → minor，`fix:`/`perf:` → patch，`feat!`/`BREAKING CHANGE:` → major |
| **指定** | 手动 `gh workflow run npm-publish -f version=X.Y.Z` | 传入的 `version` 原样生效（release-please 的 `release-as` 输入） |

指定模式用于「提交类型与目标版本不一致」的场合：例如一批 `feat:` 提交仍要按 patch 发（`version=0.6.2`），或想跳号发 minor/major。输入留空即回到自动模式。

## 发版步骤

1. **确认待发内容**：`git status` 干净、`check:refactor` + `pnpm run test` 全绿，并核对自上次 tag 以来的提交类型。
2. **推送 main**：把待发提交推送到 main（需用户确认）。
3. **决定版本模式**：自动模式等 release-please 自行计算；需要指定版本时执行 `gh workflow run npm-publish -f version=X.Y.Z`（推送触发的 run 与手动 run 都会开/更新同一个 Release PR）。
4. **核对 Release PR**：`chore(main): release dsh-agent-plugins-market X.Y.Z`；核对 package.json version、CHANGELOG 小节、`.release-please-manifest.json` 三处一致且版本符合预期，quality / CodeQL 为绿。注意 bot 分支上的 run 可能停在 `action_required`，需 `gh api repos/<owner>/<repo>/actions/runs/<id>/approve --method POST` 批准。
5. **合并 Release PR**：人工合并（唯一必做的人工步骤）。
6. **确认自动发布**：合并后的 main push 再次运行 npm-publish.yml，自动完成打 tag `dsh-agent-plugins-market-vX.Y.Z`、创建 GitHub Release、npm 发布（远端会再跑一遍 `check:refactor` + `test`）。
7. **发后动作**（可选）：手动在自动正文后追加 Highlights / 升级说明；公告投放 README / docs-site / 社区渠道；`npm view dsh-agent-plugins-market dist-tags` 抽查并安装 `@latest` 冒烟。

## 经验教训

- 执行任何远程写操作（`npm publish`、`git push`、`git tag`）前，必须经过用户确认。
- 版本号不会因「提交里没有 feat」而自动降级：移除 `bump-patch-for-minor-pre-major` 后，`feat:` 一律升 minor；要发 patch 就用指定模式。
