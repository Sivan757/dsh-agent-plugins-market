# 发版材料：v0.8.3

> 基准：`dsh-agent-plugins-market-v0.8.2`（2026-09-28）之后的提交，含 2 个 `fix:`，release-please 按 semver 自动算出 **0.8.3**。
>
> **状态：已发布（2026-09-28）。** dev → main 走 PR #85（merge commit `9bb9545`），Release PR #86（`a23ff92`）合并于 `1f7e1dc`；tag `dsh-agent-plugins-market-v0.8.3`、GitHub Release、npm `latest = 0.8.3` 均已确认。

---

## 一、发布内容

三条 open 的代码扫描告警全部关闭，这是本次发布的实质内容：

| 告警 | 规则 | 修复 |
| --- | --- | --- |
| `src/application/mcp/mcp-redaction.ts` | `js/polynomial-redos`（high） | `${NAME}` 匹配从正则改为单游标扫描。旧正在 `"${{".repeat(50000)` 上实测 10.9 秒，而该值来自接口返回值与日志行；新实现微秒级返回。行为不变：名称仍必需（`${}` 不算引用）、第一个花括号名称仍然优先、未闭合的 `${` 仍不匹配 |
| `scripts/normalize-client-banner.mjs` ×2 | `js/bad-code-sanitization`（medium） | 该脚本用 `JSON.stringify` 之后插值构造产物源码，样式表与包名任一字节都可能提前结束字符串字面量。样式表改为 base64 传输、页面内解码；包名改为按模块标识校验 |

同时折叠五个 dependabot 升级：smol-toml 1.9.0、astro 7.3.5、eslint 10.11.0、@codemirror/state 6.7.6、@types/node 22.20.4（一个统一的锁文件）。

## 二、验证证据

- **CodeQL 自证**：PR 合并引用的分析上传报告为 **0 条结果**；合并到 main 后 main 上的分析复跑，三条告警状态转为已关闭。当前 open 的代码扫描告警与依赖告警都是 **0**。
- **新增回归**：`tests/mcp-redaction.test.ts` 增加边界用例（`${}`、`${}}`、`${`、`$ {A}`、`${}${A}`）与 15 万字符恶意输入；`tests/client-banner.test.ts` 用夹具驱动横幅脚本，覆盖导入替换、含 `</script>`／引号／反斜杠／行分隔符样式表的逐字节送达、无样式表分支、非法包名拒绝、产物中不留 CSS 文本。
- **真实构建往返**：51 376 字节样式表进、51 376 字节出，逐字节相同。
- **已发布产物复核**：`0.8.3` tarball 237 个文件，`lib/application/mcp/mcp-redaction.js` 含扫描实现，`client/client.js` 中 `import './style.css'` 已被替换。
- 门禁：`check:refactor` + `check:reuse` ✅ · 894 测试 / 101 文件 ✅ · build ✅ · docs-site ✅ · 宿主基线 0.1.7-rc.2（21 个包）✅ · prettier ✅，均在隔离 worktree 的已提交 tip 上验证。

## 三、发布流程

- [x] PR #85 CI 全绿后合并到 main ✅
- [x] release-please 自动开出 **0.8.3** 的 Release PR #86，三处核对一致 ✅
- [x] bot PR 的三个 run 手动 approve 后全绿 ✅
- [x] 合并 #86 → tag（指向 `1f7e1dc`）、GitHub Release、OIDC 发布 npm ✅
- [x] npm 校验：`dist-tags.latest` = `0.8.3` ✅
- [x] 五个 dependabot PR 关闭并注明折叠原因（提交时间按规范改写后，头提交不再是 dev 的祖先，GitHub 无法自动标记合并）✅

## 四、发布后观察

发布步骤日志显示 `✅ Published package dsh-agent-plugins-market@0.8.3`，但发布后约 5 分钟内在 registry 上仍查不到该版本；次日复查时 `dist-tags.latest` 已是 `0.8.3`，版本存在于版本列表中。这是 registry 传播延迟，并非发布失败，产物内容也已逐项复核。流程文档中可补一句：发布后立刻查不到新版本时，先按传播延迟处理，隔一段时间复查再判断。
