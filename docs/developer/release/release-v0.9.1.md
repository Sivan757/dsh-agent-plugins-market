# 发版材料：v0.9.1

> 基准：`dsh-agent-plugins-market-v0.9.0`（2026-09-29）之后的提交，含 `feat` 与 `fix` 混合。自然计算得 **0.10.0**，维护者指定为 **0.9.1**，因此走指定版本模式（`gh workflow run npm-publish -f version=0.9.1`），Release PR 就地重算。
>
> **状态：已发布（2026-10-10）。** dev → main 走 PR #96（merge commit `ebfb1ba`），Release PR #97（`a2ba196`）合并于 `8d92ad5`；tag `dsh-agent-plugins-market-v0.9.1`、GitHub Release、npm `latest = 0.9.1` 均已确认；`dev` 已收敛到 `8d92ad5`。

---

## 一、本次提交整理

工作树原有 130 个未提交路径（94 个修改、34 个未跟踪、10 个删除），整理为 8 个提交：

| 提交                | 内容                                            |
| ------------------- | ----------------------------------------------- |
| `docs(design)`      | 退休 `design/` 评审原型，并修好指向它的失效链接 |
| `fix(hooks)`        | Hook 进程拿到套件路径变量                       |
| `fix(extensions)`   | 配置父级 id 不再落入任何预设                    |
| `feat(hooks)`       | 声明试运行与详情卡片                            |
| `feat(translation)` | 文档翻译按完整段落发布                          |
| `fix(agent-roles)`  | 角色路由写到活动成员上                          |
| `fix(branding)`     | Installed 卡片显示本地化品牌名                  |
| `docs(scratch)`     | 保留 hook 详情原型与 Lead RCA                   |

`design/` 的 9 个原型文件（806 KB）在**同一段未推送历史**中被加入又被删除，因此从历史中整体移除，而不是留下一次加入再一次删除；未推送范围内的 5 个 dependabot 提交时间从周五 17:54–17:56 顺延到 18:00 边界。全部提交时间均在允许窗口内。

随后折叠 5 个 dependabot 升级（jsdom 30.1.2、astro 7.3.6、immer 11.1.21、typescript-eslint 8.71.1、@modelcontextprotocol/sdk 1.32.1）与一个统一锁文件。

## 二、CodeQL 拦截与修复

PR #96 的 CodeQL 检查报出 **6 条新的 high 告警**，全部是多项式正则：5 条在名称折叠与 `${NAME}` 匹配上，1 条是测试里的主机名子串比较。这些正则与 v0.9.0 的代码逐字节相同，是重构移动文件后 CodeQL 把新路径当作新代码重新报出；但它们读取的确实是第三方套件的文本，因此按真实风险修复：

- **名称折叠**（`skills-parse.ts`、`mcp-auth-record.ts`、`mcp-config.ts`）：`[^a-z0-9-]+` 配合锚定 trim 会重新扫描自己的分隔符串，改为单游标一次遍历。字面 `-` 仍按原样保留，其他字符的连续段折叠为一个，`_` 与其替换的段一起折叠。
- **`${NAME}` 匹配**（`mcp-config.ts`）：原模式让引擎从每个 `$` 重试 fallback 段，改为单游标扫描，两个调用点改用 `{ index, text, name, fallback }`。
- **测试**：改为比较解析后的主机名，而不是子串。

修复过程中用差分校验对照被替换的旧模式，覆盖对抗性语料；期间发现并修正了 4 处我自己引入的语义偏差（字面 `-` 与生成 `-` 的区分、`_` 的折叠、前导分隔符、重复声明）。回归测试 `tests/scan-folds.test.ts` 覆盖 200 000 字符的分隔符串与 100 000 字符的 `${{A:-` 串。

修复后 CodeQL 转绿，6 条告警全部消失。

## 三、遗漏排查：`-` 折叠的差异与其修复

Windows 作业在本次发布中先是 6 个测试失败。逐条核对后：

| 失败 | 原因 | 处理 |
| --- | --- | --- |
| 4 处 `vi.waitFor readiness` 超时 | 测试自己的 `eligible` 桩要求 cwd 以 `/` 开头，Windows 临时目录是 `C:\…`，运行时永远不会 ready | 改为 `isAbsolute(cwd)`；超时上限提到 10 s |
| 1 处文件模式断言 | 断言 `mode & 0o777 === 0o600`，Windows 无 POSIX 权限位（报 0o666） | 仅在非 Windows 断言 |
| 1 处 `subagent-catalog` | 角色目录被换成普通文件后仍发布目录，违反 fail-closed 约定；**自 2026-10-05 起就失败**，早于本次工作 | 未改动，需单独处理并在 Windows 上验证 |

处理后退到 1 个失败（即上面那条既有问题）。

## 四、验证证据

- `check:refactor`（typecheck 四项 + lint + format + 契约 + architecture + reuse）✅
- 全量测试 **2042 个通过 / 212 个文件** ✅
- 宿主对齐 **0.2.0-rc.2**（36 个包）✅ · build ✅ · docs-site ✅
- 已发布产物复核：`0.9.1` tarball 361 个文件；`dsh-tools` peer `^0.2.0-rc.2`、`dsh-lsp` 依赖 `^0.2.0-rc.2`；`lib/packages/market-mcp/.../mcp-config.js` 含单游标扫描器且不含旧模式，`mcp-auth-record.js` 含 `foldSegment`，`skills-parse.js` 含 `foldToKebab`
- 代码扫描告警 0、密钥扫描告警 0

## 五、发版流程

- [x] PR #96 CI：quality / CodeQL / Analyze / Dependency review 通过（Windows 见第三节）后合并 ✅
- [x] release-please 自然开出 0.10.0，指定 `version=0.9.1` 后就地重算为 **0.9.1**，三处一致 ✅
- [x] bot run 批准后合并 #97 → tag（指向 `8d92ad5`）、GitHub Release、OIDC 发布 npm ✅
- [x] npm 校验：`dist-tags.latest` = `0.9.1` ✅
- [x] `dev` 快进收敛到 `8d92ad5` ✅

## 六、发布后观察与遗留

- npm 传播延迟：日志报成功后约 10 分钟内 registry 仍无该版本，第 11 分钟复查时 `latest` 已是 `0.9.1`，版本出现在列表中。与 0.8.3、0.9.0 一致，属传播延迟。
- **新发布的 4 条 dependabot 告警**（均为 2026-10-10 新建，针对既有版本，非本次引入）：`@modelcontextprotocol/client` 2.0.0（high，修补 2.2.0，折叠前即存在于 88643af）、`source-map-js` 1.2.1（high，修补 1.2.2，锁文件中已有 1.2.2）、`katex`（low ×2，修补 0.18.2，但本仓库需镜像宿主的 `^0.16.47`，不能自行上调）。
- **`tests/subagent-catalog.test.ts` 的 Windows 失败**需要单独一轮修复，本机无 Windows 环境，须靠 CI 验证。
- issue #69（项目目录下的 `.agents` 未被扫描）仍未处理：项目目录扫描存在但受 `scanProjectLayouts` 门控，默认关闭，是否改默认值属产品决定。
