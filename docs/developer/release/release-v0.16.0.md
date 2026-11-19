# 发版材料：v0.16.0

> 基准：`dsh-agent-plugins-market-v0.15.3`（2026-11-17）之后的 8 个提交：1 个 `feat:`、2 个 `fix:`、4 个 `docs:`、1 个 `chore(deps):`。release-please 自然算出 **0.16.0**。
>
> **状态：已发布（2026-11-19）。** dev → main 走 PR #204（merge commit `97aa090d`），Release PR #205（`379c17f9`）合并于 `49f9f96f`；tag `dsh-agent-plugins-market-v0.16.0`、GitHub Release、npm `latest = 0.16.0` 均已确认；`dev` 已收敛到 `49f9f96f`。

---

## 一、解除发布阻塞：宿主基线 0.2.2-rc.3 → 0.2.2-rc.5

`next` 通道在 2026-11-18 发布了 rc.5 之后，所有发布流水线都停在 **Verify host dependency alignment**，Release PR 根本没机会生成。这一版先修这条。

| 项 | 内容 |
| --- | --- |
| 修复行数 | 44 行：36 个精确 dev 镜像、peer 支撑窗口范围、6 条仍写 rc.3 的 `minimumReleaseAgeExclude` |
| 支撑窗口下限 | `HOST_SUPPORT_FLOOR` 改为 `0.2.2-rc.5`，只改这一处，仓库测试自动跟随 |
| 删除的绕行 | `@deepseek-ai/dsh-home-paths` 的 override。它当初钉死 `0.2.1-rc.3`，因为 `dsh-agent-instructions` 精确 peer 那个版本；rc.5 下该包改成精确 peer `0.2.2-rc.5`，前提消失，而这条 override 反而会违反它本来要满足的 peer。锁文件里不再有任何 `0.2.1-rc.3` |
| 一处类型适配 | `dsh-attachment` rc.5 声明 `AttachmentError extends HarnessError`，而 `@deepseek-ai/dsh-error` 是本包在类型期解析不到的 peer，旧的 `as Error` 断言不再成立；改用 `instanceof` 检查，运行时取值不变 |

**兼容性说明**：支撑窗口下限随构建基线一起抬高，钉在 rc.5 以下宿主的消费方会看到本插件不兼容。这是有意的：下限必须是 CI 实际构建与测试的版本，比它更旧的下限是一句没有证据的承诺。

## 二、与宿主的图标和字体对齐

用户反馈图标与字体和宿主不一致。两处都是可验证的偏差，不是观感问题。

**图标**：扩展预设字形画在 28 格画布上并且硬编码描边 1.5，在它实际渲染的 16px 下算出来只有 **0.86px**；宿主每个图标在同样尺寸下都是 **1.3px**（`ICON_MEDIUM_STROKE`）。复用清单里早就写着这个字形"使用已发布的 ICON_MEDIUM_STROKE 权重"，但代码并没有。现在描边宽度直接从导出的常量换算到自己的画布，宿主将来改权重这里会跟着走，测试也改为绑定该常量而不是 1.5。

**字体**：二十三次声明带着字面的 `ui-monospace` 字体栈。宿主的代码类文本读的是 `--ds-font-family-code`，`base.css` 由读者配置的等宽字体推导出它；字面栈忽略了这个设置，一律渲染平台默认。全部改为该 token，包括 CodeMirror 主题，因此代码与路径文本和 harness 其余部分同字体，用户的字体选择也能生效。

验证方式：解码已发布产物的内嵌样式表，`--ds-font-family-code` 出现 **31** 次、`ui-monospace` 出现 **0** 次。

## 三、其余内容

| 提交                               | 内容                                                                                     |
| ---------------------------------- | ---------------------------------------------------------------------------------------- |
| `52bcc3cc`                         | 组合器入口里显示预设名称                                                                 |
| `b370f2ca`                         | 修复创作输入，并给初始桥接命名                                                           |
| `d2f45815`、`48376209`、`c7ab86a2` | README：两段录制的演示替换页面截图、以技能管理器开头并点明它安装的仓库、缩短中文价值陈述 |

## 四、验证证据

- `check:refactor` 全链（typecheck 四项目 + lint + format + 契约 + architecture + reuse + exports + duplication + modules + package + css + single-renderer + doc-links）✅
- 全量测试 **2684 个通过 / 296 个文件** ✅ · 宿主对齐 **0.2.2-rc.5**（44 个包）✅ · 构建 ✅
- PR #204 的 CI：quality、windows、CodeQL、Analyze、Docs site 全绿、状态 CLEAN 后合并 ✅
- 已发布产物复核：`0.16.0` tarball **420 个文件**，解包 **8 154 957 字节**；24 个宿主 peer 与自供依赖同为 `>=0.2.2-rc.5 <0.3.0-0`；`dsh-home-paths` 保持区间而不是旧 override 的钉死值

## 五、过程中的一次 Windows 失败

同一提交 `050cfb37` 上并行跑了两次 Windows，一次失败一次通过（296 个测试文件全过，是 **1 个 unhandled error** 让进程退出 1：`TypeError: Cannot read properties of undefined (reading 'selection')`，位置 `ExtensionPresetEntry.tsx:55`）。该行自 2026-10-08 起未改动，本发布范围也没碰这个文件，属于既有缺陷：`data?.intendedSelection ?? data?.state.selection` 在 `data` 存在而 `state` 缺失时会抛错。重跑该 job 后通过，本版不修它，留作后续。

## 六、遗留

- `ExtensionPresetEntry.tsx:55` 的缺省保护（`data?.state?.selection`）是一个一字符级的加固，能避免接口返回缺字段时崩掉会话入口，建议单独修。
- Dependabot PR #191–#195 仍未处理，其中 jsdom 30 → 31 属跨主版本。
- 工作树里有一个不属于任何提交的未跟踪目录 `docs/scratch/role-scoped-capabilities/`。
