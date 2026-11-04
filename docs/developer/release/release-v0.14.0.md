# 发版材料：v0.14.0

> 基准：`dsh-agent-plugins-market-v0.13.0`（2026-10-26）之后的提交。共 228 个提交：58 个 `feat:`、69 个 `fix:`、4 个 `perf:`，其余为 docs / chore / test / refactor，无 breaking change。0.x 线上的 minor 升级，自然计算得 **0.14.0**，未使用指定版本模式。
>
> **状态：已发布（2026-11-04）。** dev → main 走 PR #169（merge commit `5c4a9bd1`），Release PR #170（`081657c3`）合并于 `784020bb`；tag `dsh-agent-plugins-market-v0.14.0`、GitHub Release、npm `latest = 0.14.0` 均已确认；`dev` 已收敛到 `784020bb`。

---

## 一、本次发布的内容

这一版是三次演示走查之后的收敛，核心是**套件内容改动能立刻刷新宿主**。

| 主题 | 提交 | 内容 |
| --- | --- | --- |
| AI 辅助 | `feat(ai)` ×4、`refactor(ai)`、`fix` ×2 | 市场推荐安装的套件、预设管理器给出建议、失败连接器与语言引擎自己解释原因；随后**编辑器里的「AI 起草」整体移除**，只保留扩展预设与市场两个面 |
| 走查四问 | `feat` ×2、`fix` ×1 | 八个面一律给出全部/套件/用户三个条件；输出风格按**文件**读取（套件 `output-styles/`、工作区 `.claude/output-styles/`），钩子注入交给钩子面；设置页只读用户级，系统提示词在管理器与设置页看同一份详情 |
| 核心刷新 | `fix(extensions)` | **默认选择跟随目录**：安装套件或技能后，运行中的会话在下一次目录刷新即生效，不需要手动切一次扩展预设 |
| 界面一致性 | `feat`、`fix`、`refactor` ×2 | 卡片由同一个构建器生成；管理器列出每一个面；两处设置页不再自相矛盾 |

## 二、核心修复：默认选择跟随目录

会话的选择原本是**启动时拍下的 id 快照**，目录变更时刷新的是同一份快照，于是新装的套件不在其中，既不授予也不注入；手动切一次预设之所以有效，是因为切换会重算一份新选择。

修法：不指名预设的选择**跟随实时目录**——刷新时把目录现在提供的行并入已提交的选择并提交，一次提交同时完成授予、注入与面板显示。边界三条：预设选择**不**跟随（预设是一个选择）；从旧版资源过滤器捕获的选择**冻结**（那些开关本来就是读者的）；提交放在维护槽之外（提交会等待它自己所在的那次维护）。

验证：真实 agent、真实会话状态、真实 apply 路径的集成测试覆盖授予与注入、预设不跟随、旧版捕获保持原样。

## 三、验证证据

- `check:refactor`（typecheck 四项 + lint + format + 契约 + architecture + reuse）✅
- 全量测试 **2548 个通过 / 278 个文件** ✅
- 宿主对齐 **0.2.1-rc.5**（`next` 通道，37 个包）✅ · build ✅ · docs-site ✅
- 已发布产物复核：`0.14.0` tarball **450 个文件**，解包 8 017 483 字节
- 代码扫描告警 0 · 密钥扫描告警 0
- 未处理的依赖告警 1 条：`zod`（high，`< 4.6.6`），这是**已记录在案的接受风险**——宿主家族精确钉 `4.4.3`，见 `.agents/notes/implemented/process/2026-10-26-dependency-security-alerts.md` 与 `.github/SECURITY.md`；本地无法修，升级需等宿主换基线

## 四、发版流程

1. 本地门禁：`check:refactor`、`check:host-alignment`、`pnpm run test`、`pnpm run build` 全部通过。
2. 版本判定：58 个 `feat:` → 0.x 线上的 minor → **0.14.0**，并向维护者报备后执行。
3. dev → main PR #169：quality / windows / Docs site 通过后合并 `5c4a9bd1`。
4. Release PR #170 由 release-please 自然算出 0.14.0；`package.json`、`.release-please-manifest.json`、CHANGELOG 三处一致；bot 作业经 `actions/runs/<id>/approve` 批准后 quality / windows / Analyze / CodeQL / Dependency review 全部通过。
5. 合并 Release PR → 自动打 tag、建 GitHub Release、发布 npm。registry 传播约 3 分钟，`latest` 随后变为 0.14.0。

## 五、发版后的待办

- **5 个 dependabot PR**（#164–#168，dev 依赖升级）待处理：按既有流程重定向到 `dev` 后合并。
- **`zod` 告警**：等宿主基线越过 `4.6.6` 后自动关闭。
- **`subagent-catalog` 的 Windows 失败**（角色目录被换成普通文件后仍发布目录，违反 fail-closed）：既有问题，需单独一轮修复并在 Windows 上验证。
- **issue #69**（项目目录下的 `.agents` 未被扫描）：功能存在但受 `scanProjectLayouts` 门控、默认关闭；是否改默认值是产品决定。
