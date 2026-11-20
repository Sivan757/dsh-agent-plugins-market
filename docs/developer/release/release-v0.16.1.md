# 发版材料：v0.16.1

> 基准：`dsh-agent-plugins-market-v0.16.0`（2026-11-19）之后的 15 个提交：2 个 `feat:`、7 个 `fix:`、3 个 `chore:`、2 个 `docs:`、1 个 `build:`。release-please 自然算出 **0.17.0**，按维护者指定锚定为 **0.16.1**。
>
> **状态：已发布（2026-11-20）。** dev → main 走 PR #207（merge commit `795e6c14`），Release PR #208（`63c58893`）合并于 `b79f5d13`；tag `dsh-agent-plugins-market-v0.16.1`、GitHub Release、npm `latest = 0.16.1` 均已确认；`dev` 已收敛到 `b79f5d13`。

---

## 一、版本为什么是 0.16.1 而不是 0.17.0

区间里有 2 个 `feat:`，按 ADR-0002 应升 minor。维护者决定把它们放进一个 patch：两个提交改变的是既有界面的呈现方式（对话框统一外壳与圆角标度、推荐排序与超时命名），不是读者需要主动选择才生效的新能力。

做法是指定版本模式：`gh workflow run npm-publish -f version=0.16.1` 在 main 上生成一个带 `Release-As: 0.16.1` 的空提交，release-please 把已打开的 Release PR 就地重算为 0.16.1，`package.json`、CHANGELOG、`.release-please-manifest.json` 三处一致。

代价写在这里：CHANGELOG 的 0.16.1 段落里含一个 `### Features` 小节。下一个真正新增可选能力的版本不应再这样折叠。

## 二、提交整理

两个提交的时间戳落在其父提交之前，破坏单调性：

| 提交                                                           | 原时间      | 改为  |
| -------------------------------------------------------------- | ----------- | ----- |
| `8b0741be` chore(process): link the host's skills              | 11-19 18:00 | 18:45 |
| `2c238307` fix(presets): the chip reads its session projection | 11-19 18:05 | 18:50 |

起因是 dependabot PR #206 的合并提交落在 18:40，而它后面的两个提交仍是 18:00/18:05。用 `filter-branch --env-filter` 只改写 `origin/dev..dev` 这 10 个未推送提交；改写前后 `git write-tree` 完全相同（`9ce3f75e`），`origin/dev` 仍是祖先，因此是普通推送而不是强推。

整理后全区间 0 条时间违规，单调递增。

## 三、Windows：两次红、一个真缺陷

第一次 Windows 红：`dialog-shell.test.ts:51` 报 `a surface builds its own dialog chrome: expected [ Array(1) ] to deeply equal []`。

根因是**测试自己**的平台假设：它用 `join()` 遍历 `packages/market-ui/src`，再用 `endsWith('ui/DetailModal.tsx')` 把自己排除掉。`join()` 在 Windows 返回反斜杠，排除永远不匹配，于是 `DetailModal.tsx` 被当成违规项——它在 macOS 上永远绿，在 Windows 上每次红。

修法是把遍历结果统一成 `/` 分隔（`path.split(sep).join('/')`），`readFileSync` 在两个平台都接受正斜杠，同一文件里的两处后缀比较因此在哪都读得出同一个意思。

## 四、内容

| 类别 | 内容 |
| --- | --- |
| 修复 | 窗口应答缺会话状态时拒绝而不是在渲染中抛错（`ca061ebb`，见下）；组合器芯片用会话投影回答预设点击（`20fe785d`、`2c238307`）；扩展字形的光学重量与节点分离（`3a18cb7a`、`a4f94132`、`240d8854`）；文档走宿主发布的技能名（`daab45eb`） |
| 特性 | 对话框统一外壳与圆角标度（`5c22a72d`）；推荐排序与超时命名（`cc5edc2d`） |
| 过程与依赖 | 宿主技能改为链接而非复制（`8b0741be`）；`dsh-atomic-write` 与 `dsh-home-paths` 移到 peer（`0a77899c`）；bot 更新归并到 dev（`1faaa3f6`）；`@deepseek-ai/cordis` 4.0.5 → 4.1.0（#206） |

`ca061ebb` 值得单说：`readWindow` 用 `json().catch(() => ({}))` 解码后把结果**当作完整 payload** 返回，一个 200 但响应体不可解析的情况会得到 `{}`，它以完整类型抵达组合器入口，`data?.state.selection` 在渲染时解引用缺失的 `state`。跨平台 Windows 跑里表现为 296 个测试文件全过、1 个 unhandled error 让进程退出 1。现在读写两条路径都经过同一个 fetch 边界守卫，缺 `state`、缺 `library` 或缺 `resources` 的答案走既有失败路径。

## 五、验证证据

- `check:refactor` 全链 ✅ · `pnpm install --frozen-lockfile` ✅ · 构建 ✅
- 本地全量 **2712 个测试**通过 ✅
- Windows CI：**300 个测试文件通过、1 跳过（302）**，quality 与 windows 均绿 ✅
- 宿主对齐 **0.2.2-rc.5**（44 个包）✅
- PR #207 CI：CodeQL、Analyze、Dependency review、Docs site、quality、windows 全绿、CLEAN 后合并 ✅
- 已发布产物：`0.16.1` tarball **422 个文件**，解包 **8 165 876 字节**；**26 个宿主 peer**（原 24，`dsh-atomic-write` 与 `dsh-home-paths` 已从 dependencies 移入 peer），窗口 `>=0.2.2-rc.5 <0.3.0-0`

## 六、发布流程中的一次混乱

指定版本重算会强制更新 Release PR 分支，旧 commit 上的三个 check run 被取消。我在重算前后各批准了一次 bot run，导致新 commit 的 quality 与 windows 被并发组取消，GitHub 把 `cancelled` 显示成 `fail`。重跑这两个 run 后全绿。下次应当在重算完成之后只批准当前分支 head 的 run。

## 七、遗留

- 工作树里仍有一个不属于任何提交的未跟踪目录 `docs/scratch/role-scoped-capabilities/`。
- 待处理 issue #203（宿主包被声明为运行时依赖）与 #200（审批策略未告知就变更）；本次已把其中两个包移到 peer，其余需单独判断。
- 依赖告警 0、代码扫描告警 0、无待处理 PR。
