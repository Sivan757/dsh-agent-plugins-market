# 发版材料：v0.8.1

> 基准：`dsh-agent-plugins-market-v0.8.0`（2026-09-24）之后 dev 上的 4 个提交，全部为 `fix:`，release-please 按 semver 自动算出 **0.8.1**。
>
> **状态：已发布（2026-09-24）。** `dev` → `main` 走 PR #75（merge commit `3bc8f7d`），Release PR #76（`58ea50a`）合并于 `192d018`；tag `dsh-agent-plugins-market-v0.8.1`、GitHub Release、npm `latest = 0.8.1` 均已确认。`main` 与 `dev` 已收敛。

---

## 一、门禁

- [x] `pnpm run check:refactor` ✅（158 模块 0 违规）
- [x] `pnpm run test` ✅ **823 个测试全绿**
- [x] `pnpm run build` ✅ · `pnpm --dir docs-site exec astro build` ✅ 4 页
- [x] `pnpm run check:host-alignment` ✅ 基线 **0.1.7-rc.1**（`next`），20 个包全部符合
- [x] Release PR #76 的 quality / windows×2 / CodeQL / Analyze / Dependency review 全绿后合并 ✅
- [x] npm 校验：`dist-tags.latest` = `0.8.1`；tarball 227 个文件，宿主 peer 钉 `^0.1.7-rc.1` ✅
- [x] 收敛：`main` 与 `dev` 均在 `192d018` ✅

## 二、提交时间规范

4 个提交中 3 个落在周四 14:00–18:00 禁用窗口（12:27 那个在允许窗口内），推送前全部顺延到 18:00:00–03（`filter-branch` 按 hash 显式 pin 日期），`git diff` 确认内容零变化。

## 三、发布流程

- [x] 提交时间改写 → `git push --force-with-lease origin dev` ✅
- [x] PR #75（dev → main）CI 全绿后合并 ✅
- [x] release-please 自然运行开出 **0.8.1**（纯 `fix:`，无需强制版本），三处核对一致（title / `.release-please-manifest.json` / CHANGELOG / `package.json`）✅
- [x] bot PR 的三个 run 手动 approve（`gh api -X POST .../actions/runs/<id>/approve`）后全绿 ✅
- [x] 合并 #76 → tag（指向 `192d018`）、GitHub Release、OIDC 发布 npm ✅
- [x] 收敛：`main` 与 `dev` 均在 `192d018` ✅

## 四、0.8.1 内容

市场设置卡片在新 Plugins 页面入口上的四处修正：设置直接渲染在入口 surface 上；表单动作按钮靠左排布，与官方插件页一致；market 命名空间经由入口 `Config` schema 投影；`plugins.item` 的 summary 与 page 两种视图都有应答。
