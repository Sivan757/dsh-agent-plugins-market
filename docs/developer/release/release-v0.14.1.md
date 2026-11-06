# 发版材料：v0.14.1

> 基准：`dsh-agent-plugins-market-v0.14.0`（2026-11-04）之后的提交。只有 `fix:`、`docs:` 与 `build(deps-dev):`，无 `feat:` 与新依赖，自然算出 **0.14.1**，未使用指定版本模式。
>
> **状态：已发布（2026-11-04）。** dev → main 走 PR #171（merge commit `4dd6f2c7`），Release PR #172（`eba3a145`）合并于 `f9c2a021`；tag `dsh-agent-plugins-market-v0.14.1`、GitHub Release、npm `latest = 0.14.1` 均已确认；`dev` 已收敛到 `f9c2a021`。

---

## 一、这次的核心改动：支持下限改到实测基线

宿主支持窗口原本是 `>=0.2.0-rc.2 <0.3.0-0`，那个下限写在 2026-10-17，此后一次没动。本仓库只在 `0.2.1-rc.5` 上构建和测试，流水线从未跑过 `0.2.0-rc.2`——比 CI 验证的一切都旧的下限，是一句没有证据的承诺。

| 项       | 改动                                                                                                                                             |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| 下限     | `0.2.0-rc.2` → **`0.2.1-rc.5`**（25 个 peer 与 6 个自供依赖同步）                                                                                |
| 上限     | 保持 `<0.3.0-0`——宿主一个 minor 会搬动本插件挂载的 seam                                                                                          |
| 基线通道 | 保持 `next`——能力包的 `latest` 仍是首次发布占位 `0.0.1-rc.1`，锚点包的 `latest` 与 `next` 虽同为 `0.2.1-rc.5`，但切换条件是宿主发出第一个 stable |

窗口常量移到 `scripts/host-support-window.mjs`，门禁与三处仓库级测试都从它读，不再各自复述范围；`.d.mts` 提供类型声明，测试项目可以直接 import。

## 二、顺带删掉的 workaround

旧下限养着一处绕行：仅用于开发的 `@deepseek-ai/dsh-hooks-claude-code` 把 `@deepseek-ai/dsh-hook-protocol` 声明为**精确 peer**，而 semver 把旧窗口解析到下限 `0.2.0-rc.2`——与 `0.2.1-rc.5` 属于不同 tuple——所以根目录的 `.pnpmfile.cjs` 把那条 peer 边改写成 dependency 边，维持一份嵌套副本。旧记录写明了退场条件：下限升到桥接那一行时删除钩子。

新下限就是那一行：两侧都是 `0.2.1-rc.5`，`pnpm install` 只解析出一份副本。因此删除 `.pnpmfile.cjs`、驱动它的 `pnpmfile-hook.test.ts`，锁文件里的 `pnpmfileChecksum` 也随之消失。`hook-protocol-lockfile.test.ts` 改为守终态：只有一份协议版本、位于声明下限、没有能藏住第二份副本的钩子。

## 三、依赖折叠

三个 dependabot PR 重定向到 `dev` 后本地合并，锁文件由 ort 自动合并（核对无宿主版本回退：`0.2.1-rc.5` 571 处、`rc.4` 0 处）：

| 包                | 版本                  |
| ----------------- | --------------------- |
| typescript-eslint | 8.72.0 → **8.72.1**   |
| @codemirror/view  | 6.43.14 → **6.43.15** |
| simple-icons      | 16.35.0 → **16.36.0** |

`#164`、`#167` 已作废（dev 已是 `0.2.1-rc.5`，超过它们的目标 rc.4）。

## 四、验证证据

- `check:refactor`（typecheck 四项 + lint + format + 契约 + architecture + reuse）✅
- 全量测试 **2541 个通过 / 277 个文件** ✅（比 0.14.0 少 7 个，正是被删掉的 `pnpmfile-hook.test.ts`）
- 宿主对齐 **0.2.1-rc.5**（`next` 通道，37 个包）✅ · build ✅
- 已发布产物：`0.14.1` tarball **450 个文件**，解包 8 020 566 字节
- 代码扫描告警 **0**（0.14.0 遗留的两条 `js/incomplete-sanitization` 随本次合并关闭）· 密钥告警 0

## 五、发版后的待办

- **dependabot `zod`**（high，runtime）：已记录在案的接受风险，宿主家族精确钉 `4.4.3`，等宿主换基线后自动关闭。
- **dependabot `minimatch`**（medium，development）：两个父包都声明 `^10.2.x`，升到修补版 `11.0.1` 需要 override，会与其 v10 用法冲突；建议随 eslint 主线升级消解。
- **宿主发出 stable 版本时**：同一次改动里把门禁默认通道切回 `latest`，并把下限提到那个 stable。
