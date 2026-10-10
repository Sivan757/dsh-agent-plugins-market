# 发版材料：v0.9.0

> 基准：`dsh-agent-plugins-market-v0.8.3`（2026-09-28）之后的 15 个提交 —— 1 个 `feat:`、11 个 `fix:`、2 个 `chore:`、1 个 `docs:`，无 `BREAKING CHANGE`。release-please 按 semver 自然算出 **0.9.0**（`feat:` 升 minor），本次未使用指定版本模式。
>
> **状态：已发布（2026-09-29）。** dev → main 走 PR #87（merge commit `67338dd`），Release PR #88（`86b5641`）合并于 `88643af`；tag `dsh-agent-plugins-market-v0.9.0`、GitHub Release、npm `latest = 0.9.0` 均已确认；`dev` 已收敛到 `88643af`。

---

## 一、GitHub 存留问题清理

发版前逐类清点，结果如下。

| 类别                   | 发版前   | 发版后           |
| ---------------------- | -------- | ---------------- |
| 未合并 PR              | 0        | 0                |
| 代码扫描告警（CodeQL） | 0        | 0                |
| 依赖告警（dependabot） | **2**    | **0**            |
| 密钥扫描告警           | 0        | 0                |
| 未处理 issue           | 1（#69） | 1（#69，详见下） |

两条依赖告警都指向 main 上的锁文件，而 dev 上已由宿主 rc.2 对齐时刷新的锁文件越过修补版本——本次合并把该锁文件带上 main，告警随之关闭：

| 包           | main 当时版本 | 修补版本 | dev 版本   | 公告                                                    |
| ------------ | ------------- | -------- | ---------- | ------------------------------------------------------- |
| `undici`     | 8.10.0        | 8.10.2   | **8.11.2** | WebSocket permessage-deflate 解压未处理错误导致拒绝服务 |
| `ip-address` | 10.5.0        | 10.5.1   | **10.7.2** | NAT64 本地用途段未被识别，可绕过信任边界（SSRF）        |

**issue #69 保留未处理**：报告者在项目根目录放 `.agents/commands` 但未被识别。代码层面项目目录扫描是存在的（`packages/market-catalog/src/scanning/source-catalog.ts` 的 project 维度），只是受插件设置 `scanProjectLayouts` 门控，默认 `false`（`packages/market-contracts/src/contracts/settings.ts`）。是否改默认值属于产品决定，不属于本次发版范围。

## 二、发布内容

- **凭据引用按其指向的凭据读取**（本次唯一的 `feat:`）：凭据引用在客户端按它命名的凭据呈现，服务表单在新建与编辑之间共用同一份实现。
- **用户自写的 MCP 声明以其裸键挂载**：手写条目与挂载后的服务名一致，不再出现两份不同的名字。
- **客户端 MCP 面板收敛到宿主的控件与卡片形态**：折叠分组取折叠行的形状、只有展开行上色、折叠分组内的密钥保持折叠。
- **宿主发布线升至 `0.2.0-rc.2`**（`chore(host)`）：全部 pin 与锁文件一并替换。

## 三、验证证据

- `check:refactor`（typecheck 四项 + lint + format + 契约 + architecture）✅
- 全量测试 **906 个通过 / 101 个文件**（另 1 个文件按设计跳过；`check:refactor` 内的契约套件为 2 个文件）✅
- `check:reuse` ✅ · 宿主对齐 **0.2.0-rc.2**（21 个包）✅ · build ✅ · docs-site 4 页 ✅
- 以上均在隔离 worktree 的已提交 tip（`de556b6`）上跑完，再由 PR #87 的 quality / windows / CodeQL 复核。
- **已发布产物复核**：`0.9.0` tarball 237 个文件；`@deepseek-ai/dsh-tools` peer 为 `^0.2.0-rc.2`，`@deepseek-ai/dsh-lsp` 依赖为 `^0.2.0-rc.2`，`@deepseek-ai/dsh-mcp-client` dev 镜像为 `0.2.0-rc.2`。

## 四、发布流程

- [x] PR #87（dev → main）CI 全绿、状态 CLEAN 后合并 ✅
- [x] release-please 自动开出 **0.9.0** 的 Release PR #88，`package.json` / CHANGELOG / `.release-please-manifest.json` 三处一致 ✅
- [x] bot PR 的三个 run 停在 `action_required`，手动批准后全绿 ✅
- [x] 合并 #88 → tag（指向 `88643af`）、GitHub Release、OIDC 发布 npm ✅
- [x] npm 校验：`dist-tags.latest` = `0.9.0` ✅
- [x] `dev` 快进收敛到 `88643af` ✅

## 五、发布后观察

发布步骤日志报成功后，registry 上约 5 分钟内仍显示旧版本（`latest = 0.8.3`），第 5 次复查时已变为 `0.9.0`。与 0.8.3 那次一致，属于 registry 传播延迟而非发布失败；确认新版本前先按此预期等待数分钟再判断。
