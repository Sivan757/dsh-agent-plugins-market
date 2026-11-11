# 发版材料：v0.14.4

> 基准：`dsh-agent-plugins-market-v0.14.3`（2026-11-09）之后一个 `fix:` 与一个 `docs:` 记录；无 `feat:`、无 `BREAKING CHANGE`、无新依赖，自然算出 **0.14.4**，未使用指定版本模式。
>
> **状态：已发布（2026-11-11）。** dev → main 走 PR #185（merge commit `a686087a`），Release PR #186（`a3bcfcc1`）合并于 `7e8a210e`；tag `dsh-agent-plugins-market-v0.14.4`、GitHub Release、npm `latest = 0.14.4` 均已确认；`dev` 已收敛到 `7e8a210e`。

---

## 一、发布内容

| 提交      | 内容                                                                  |
| --------- | --------------------------------------------------------------------- |
| `f1d63d7` | `fix(presets)`：扩展预设里项目级 `AGENTS.md` 的详情一直停在「加载中」 |

原因：预设窗口里指令文件行的 `detail` 地址没有携带会话，详情据此按「无会话」语义读取链条；服务端对无会话的读取只作答用户级并过滤项目行，entry id 永远找不到，界面停在加载态且没有重试。

改法：地址带上列出该行时的会话（与 MCP/LSP 行一致）；链条已作答却缺该文件时显示新增的 `epInstructionMissing`（中英成对），不再永久加载。

测试：`extension-instructions-inventory` 新增 2 例（地址携带 / 不携带会话），`client-extension-preset-details` 新增 2 例（按会话读链条、缺行报错）；修复前先红。

## 二、发版前核实

- 负责人已在桌面 profile 用同一提交的本地构建验证：项目级 `AGENTS.md` 打开即显示详情，不再停在加载态。
- `v0.14.3..dev` 区间共 2 个提交：一个 `fix:`、一个 `docs:` 发版记录；`docs:` 不参与版本判定，自然版本为 0.14.4。
- Release PR #186 三处一致：`package.json` `0.14.4`、`.release-please-manifest.json` `{".": "0.14.4"}`、CHANGELOG `## [0.14.4]`。

## 三、验证证据

- `check:refactor`（四项 typecheck + lint + format + 契约 + architecture + reuse + 其余静态门禁）✅
- 全量 `pnpm run test`：**2625 项 / 288 文件** ✅ · `pnpm run build` ✅
- 宿主对齐 **0.2.2-rc.1**（`next` 通道，46 个包）✅
- PR #185 的 CI：quality、windows、CodeQL、Analyze、Dependency review、Docs site 全绿后合并 ✅
- Release PR #186：三个 bot run 停在 `action_required`，`gh api .../approve` 批准后 quality / windows / CodeQL 全绿 ✅
- 已发布产物复核（`npm pack dsh-agent-plugins-market@0.14.4`）：**452 个文件**，解包 **8 078 118 字节**；`lib/packages/market-bundle/src/application/extension-inventory.js` 含会话地址行、`client/client.js` 含 `epInstructionMissing`；宿主 peer 窗口 `>=0.2.2-rc.1 <0.3.0-0` ✅

## 四、发布流程

- [x] 推送 dev（`1e5bd47d..f1d63d75`）✅
- [x] PR #185 CI 全绿、状态 CLEAN 后合并（`a686087a`）✅
- [x] Release PR #186 自然算出 0.14.4；批准 bot run 后全绿 ✅
- [x] 合并 #186 → tag `dsh-agent-plugins-market-v0.14.4`（`7e8a210e`）、GitHub Release、OIDC 发布 npm ✅
- [x] npm 校验：发布日志 `✅ Published package dsh-agent-plugins-market@0.14.4`；`dist-tags.latest = 0.14.4`（传播延迟约 7 分钟，复查命中）✅
- [x] `dev` 快进收敛到 `7e8a210e`，与 `main`、`origin/dev` 三者同点 ✅

## 五、遗留与提请注意

- **5 个 dependabot PR 待折叠**：#176 `mdast-util-to-markdown` 2.2.1、#177 `eslint` 10.14.0、#178 `zustand` 5.0.16、#179 `shiki` 4.6.0、#180 `dependency-cruiser` 18.7.2，base 均为 `main`。
- **代码扫描告警 1 条**：`js/polynomial-redos`（warning）在 `packages/market-catalog/src/scanning/paths.ts:216`。
- **依赖告警 2 条**：`zod`（high，修补 4.6.6）、`minimatch`（medium，修补 11.0.1）。
- 桌面 profile 在本次验证期间装的是本地构建的冻结件；发布确认后已切回 registry 的 `0.14.4`，重启应用后运行的就是正式版本。
