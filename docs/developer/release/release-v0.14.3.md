# 发版材料：v0.14.3

> 基准：`dsh-agent-plugins-market-v0.14.2`（2026-11-06）之后的两个 `fix:` 提交，无 `feat:`、无 `BREAKING CHANGE`、无新依赖，自然算出 **0.14.3**，未使用指定版本模式。
>
> **状态：已发布（2026-11-09）。** dev → main 走 PR #183（merge commit `0222017f`），Release PR #184（`14c7baf5`）合并于 `eea27127`；tag `dsh-agent-plugins-market-v0.14.3`、GitHub Release、npm `latest = 0.14.3` 均已确认；`dev` 已收敛到 `eea27127`。

---

## 一、发布内容

两个 `fix:`，逐一对应一个已公开答复「将随 v0.14.3 发布」的 issue，版本号必须兑现这句话。

| 提交 | 内容 |
| --- | --- |
| `821501bd` | `fix(catalog)`：Codex MCP server 表接受一致的 `type` 键。此前只认一种拼写，另一种被判为 unsupported，整个 server 被丢弃 |
| `6aaeb4dc` | `fix(bundle)`：市场路由按宿主声明的 authorities 放行。请求信任栅栏此前只接受 loopback `Host`，反向代理部署即便已声明域名，每条市场路由仍返回 403，包括 Web 客户端每 2.5 秒轮询的无会话扩展读取 |

第二个修复的口径：`Host` 检查改为镜像宿主 `/api` 栅栏——loopback 分类器、任一 `trustedHosts` 条目（精确 `host:port`、无端口时匹配任意端口、WHATWG 规范化）、或监听绑定地址；`sec-fetch-site` 与 `Origin` 比较不变；取不到宿主服务的上下文退回 loopback-only；部署未声明的名字一律拒绝，#156 的 DNS 重绑定防护因此保持有效。

两处都带 Agent Note 与集成测试。

## 二、发版前核实

- **`e51d59cc`（MCP 挂载启动预算 30 秒）已随 0.14.2 发布**：`git merge-base --is-ancestor e51d59cc dsh-agent-plugins-market-v0.14.2` 为真，因此不在本次范围内，版本判定不受影响。
- 起始版本：npm `latest = 0.14.2`，与 `origin/main` 的 `package.json` 一致；本次提交在 `v0.14.2..dev` 区间内恰好 2 个。
- Release PR #184 由 release-please 自然算出 `0.14.3`，`package.json` / CHANGELOG / `.release-please-manifest.json` 三处一致，CHANGELOG 两行都指向对应提交。

## 三、验证证据

- `check:refactor`（typecheck 四项 + lint + format + 契约 + architecture + reuse）✅
- 全量测试 **2621 个通过 / 287 个文件** ✅
- 宿主对齐 **0.2.2-rc.1**（`next` 通道，46 个包）✅ · prettier ✅ · architecture 320 模块 0 违规 ✅
- PR #183 的 CI：quality、windows、CodeQL、Analyze、Dependency review、Docs site 全绿后合并 ✅
- 已发布产物复核：`0.14.3` tarball **412 个文件**，解包 **8 076 940 字节**；25 个宿主 peer 与自供依赖同为 `>=0.2.2-rc.1 <0.3.0-0`

## 四、发布流程

- [x] 推送 dev（`e51d59cc..6aaeb4dc`）✅
- [x] PR #183 CI 全绿、状态 CLEAN 后合并 ✅
- [x] Release PR #184 自然算出 0.14.3；bot 的三个 run 停在 `action_required`，`gh api .../approve` 批准后全绿 ✅
- [x] 合并 #184 → tag（指向 `eea27127`）、GitHub Release、OIDC 发布 npm ✅
- [x] npm 校验：`dist-tags.latest` = `0.14.3`（第 3 次复查命中，传播延迟约 2 分钟）✅
- [x] `dev` 快进收敛到 `eea27127`，与 `main`、`origin/dev` 三者同点 ✅

## 五、遗留与提请注意

- **PR #182 是 #181 的第二份实现**：`fix/request-trust-deployment-authorities`，由外部贡献者 `mzzsfy` 提交，改动同样 12 个文件、同样的问题。本次发布落在 `6aaeb4dc`（issue 答复里点名的提交），#182 仍需一个独立决定：合并会让两套栅栏逻辑并存，关闭则要给出理由与致谢。
- **代码扫描告警 1 条**（`js/polynomial-redos`，`packages/market-catalog/src/scanning/paths.ts:216`，warning，挂在 `main`），不属本次范围。
- **依赖告警 2 条**：`zod`（high，修补 4.6.6）、`minimatch`（medium，修补 11.0.1），均在 `pnpm-lock.yaml`，不属本次范围。
