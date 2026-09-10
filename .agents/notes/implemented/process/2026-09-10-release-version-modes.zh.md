# Agent Note: 两种发版模式 —— 自动的 conventional-commit 版本推导 + 显式版本指定

Status: implemented

## Problem

版本号完全由 conventional-commit 类型决定。一旦提交类型与实际要发的版本不一致就会失效：一批 `feat:` 提交要按 patch 发（0.6.2）、只有 `fix:` 的批次想发 minor、或想跳号。唯一的杠杆是改 `.release-please-config.json` 里的 `bump-patch-for-minor-pre-major`，而它会翻转*之后每一次*发版的规则——为了修一次发版，把下一次发版配置坏掉。

## Decision

`npm-publish.yml` 保留自动路径，并新增一个手动输入：

- **自动（默认）**：push 到 `main` 时由 release-please 依据上次发版以来的 conventional commits 推导版本（`feat:` → minor，`fix:`/`perf:` → patch，breaking → major）。无需改任何配置。
- **显式指定**：`workflow_dispatch` 接受 `version` 输入。workflow 先在 `main` 上创建一个空提交，提交信息带 `Release-As: X.Y.Z` 页脚，再运行 release-please，候选 PR 随即被重算为该确切版本，与提交类型无关；输入留空则保持自动行为。

action 自带的 `release-as` 输入刻意不使用：在 `config-file`（manifest）模式下 release-please 会忽略它——0.6.2 发版的 run 收到 `release-as: 0.6.2` 却仍打印 `updating from 0.6.1 to 0.7.0`，换成页脚后同一候选版本被正确重算为 0.6.2。页脚还能就地更新已打开的 Release PR，因此两种模式共用一个 PR；空提交不改任何文件，`paths-ignore` 会跳过它本会触发的 push 事件。

两条路径汇聚到同一个 Release PR 分支，因此手动 dispatch 会更新 release-please 已提出的版本；合并该 PR 仍是唯一必做的人工步骤，tag / GitHub Release / npm 发布保持自动。

运行手册（[docs/release/release-process.md](../../../../docs/release/release-process.md)）记录两种模式，以及 bot 分支上 run 的 `action_required` 批准步骤。

## Alternatives considered

- **`bump-patch-for-minor-pre-major: true`** 是此前的杠杆。否决：它是全局且持久的——在有人记得改回来之前，每一次功能批次都会发成 patch，这正是 0.6.0 被误算成 0.5.4 的原因。
- **`Release-As:` 提交页脚** 无需改 workflow，但每次强制发版都要在 `main` 上多一个提交，且纯 `.github/**` 改动带不了它（这些路径被发版触发忽略）。
- **手改 `package.json` + `.release-please-manifest.json`** 与工具对抗：两个文件都归 release-please 所有，手改 manifest 会让下一次自动推导失准。

## Consequences

- 在功能提交上强制发 patch 现在是一条命令，而默认规则保持 semver 诚实。
- 显式输入也可能产出低于提交所依据的版本（例如 9 个 feat 发 0.6.2）——这是人类的有意决定，在 Release PR 中可复核。
- 版本选择可审计：Release PR 显示确切版本，workflow run 记录输入值。
