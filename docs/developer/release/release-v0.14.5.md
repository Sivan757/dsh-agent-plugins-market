# 发版材料：v0.14.5

> 基准：`dsh-agent-plugins-market-v0.14.4`（2026-11-11）之后一个 `fix:`、五个 dependabot 升级与一个 `chore(deps)`；无 `feat:`、无 `BREAKING CHANGE`，自然算出 **0.14.5**，未使用指定版本模式。
>
> **状态：已发布（2026-11-11）。** dev → main 走 PR #187（merge commit `913eb01f`），Release PR #188（`bd7cb49a`）合并于 `4b64bb07`；tag `dsh-agent-plugins-market-v0.14.5`、GitHub Release、npm `latest = 0.14.5` 均已确认；`dev` 已收敛到 `4b64bb07`。

---

## 一、发布内容

| 提交                    | 内容                                                                                                                           |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `0f9fd80`               | `fix(catalog)`：来源 URL 末尾斜杠改为单次扫描，消除 CodeQL `js/polynomial-redos`                                               |
| `658439d6` … `0653a246` | 五个 dependabot 升级合并：mdast-util-to-markdown 2.2.1、eslint 10.14.0、zustand 5.0.16、shiki 4.6.0、dependency-cruiser 18.7.2 |
| `ec06673`               | `chore(deps)`：minimatch override 到 11.0.7，关闭 GHSA-g3hv-75wg-m249                                                          |

### 1. CodeQL 告警 #16（`js/polynomial-redos`）

`parseRemoteRepository` 与 `deriveSourceIdCandidates` 的末尾斜杠正则会在每个起始位置重试，长斜杠串上是二次复杂度；来源 URL 来自市场数据，长度不受本仓库控制。改为单次扫描 `trimTrailingSlashes`，并新增 20 万斜杠用例。合并到 `main` 后 CodeQL 重扫，告警状态转为 `fixed`，代码扫描 open 数为 0。

### 2. minimatch（GHSA-g3hv-75wg-m249）

eslint 10.14 仍声明 `^10.2.6`，修补版本 11.0.1 需要跨大版本。`pnpm-workspace.yaml` 增加 `minimatch: 11.0.7` override：minimatch 11 用非递归匹配器替换了被报告的正则引擎，eslint 使用的公共 API（`Minimatch` 类与 `dot: true`）未变；仓库 lint 与全量测试覆盖既有模式。override 只作用于开发树，不随包发布（tarball 中不含 `pnpm-workspace.yaml`）。

### 3. zod（GHSA-mrhx-c7xc-m3w5）

不修复：宿主系列精确钉 `4.4.3`，且插件 schema 会进入宿主 `ProjectionDefinition`，单副本是宿主 `ZodType` 契约要求。dependabot 告警 #39 已按 `.github/SECURITY.md` 的接受风险 dismiss，备注指向该文档；宿主把系列移到 `4.6.6` 后应移除 override 与 audit 忽略项。

## 二、发版前核实

- `v0.14.4..dev` 区间：一个 `fix:`、五个 dependabot 合并、一个 `chore(deps)`；`build(deps)` 与 `chore` 不参与版本判定，自然版本 0.14.5。
- Release PR #188 三处一致：`package.json` `0.14.5`、`.release-please-manifest.json` `{".": "0.14.5"}`、CHANGELOG `## [0.14.5]`。

## 三、验证证据

- `check:refactor` ✅ · 全量测试 **2627 项 / 288 文件** ✅ · `pnpm install --frozen-lockfile` 一致 ✅
- 宿主对齐 **0.2.2-rc.1**（`next` 通道，46 个包）✅
- PR #187 的 CI：quality、windows、CodeQL、Analyze、Dependency review、Docs site 全绿后合并 ✅
- Release PR #188：三个 bot run 停在 `action_required`，批准后 quality / windows / CodeQL 全绿 ✅
- 已发布产物复核（`npm pack dsh-agent-plugins-market@0.14.5`）：**452 个文件**，解包 **8 078 711 字节**；`lib/packages/market-catalog/src/scanning/paths.js` 含 `trimTrailingSlashes`、旧正则已消失；tarball 不含 `pnpm-workspace.yaml`（override 不随包）✅

## 四、发布流程

- [x] 推送 dev（`8b1f64d2..ec06673d`）✅
- [x] PR #187 CI 全绿、状态 CLEAN 后合并（`913eb01f`）✅
- [x] Release PR #188 自然算出 0.14.5；批准 bot run 后全绿 ✅
- [x] 合并 #188 → tag `dsh-agent-plugins-market-v0.14.5`（`4b64bb07`）、GitHub Release、OIDC 发布 npm ✅
- [x] npm 校验：发布日志 `✅ Published package dsh-agent-plugins-market@0.14.5`；`dist-tags.latest = 0.14.5`（传播延迟约 6 分钟，复查命中）✅
- [x] `dev` 快进收敛到 `4b64bb07`，与 `main`、`origin/dev` 三者同点 ✅

## 五、遗留与提请注意

- **dependabot #49 minimatch**：`main` 锁文件已解析 `11.0.7`，GitHub 需下一次依赖图扫描才把告警标为 fixed（撰写时仍 open）。
- **zod 接受风险**：见 `.github/SECURITY.md` 与 `pnpm-workspace.yaml` 的 override 注释；关闭需要宿主发布把系列移到 `4.6.6`。
- 本次同时更新了 `.github/SECURITY.md` 的 override 说明（minimatch 只提升开发树，不交付使用者）。
