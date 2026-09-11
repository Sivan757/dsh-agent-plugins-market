# Agent Note: Force the host dependency baseline to one release line before it can ship

Status: implemented

## Problem

发布产物携带的是打 tag 那个 commit 上的 `package.json`，所以落后的宿主 pin 等于发出一份过期的契约。同一次漂移产生了两类失效：

1. **prerelease 范围排除下一条宿主发布线。** `^0.1.2-rc.1` 只匹配 `0.1.2-*` 的 prerelease 与 `0.1.2` 本身——semver 只在 `major.minor.patch` 相同的比较器上解析 prerelease 标识。宿主推进到 `0.1.5-rc.2` 后，所有消费方的 peer 解析都指向一条没人运行的线。
2. **动态引入的宿主包从未被声明。** `src/runtime/lsp-mounts.ts` 通过 `import(...)` 挂载 `@deepseek-ai/dsh-lsp-stdio`，而这个包不在任何依赖段里，因此没有任何地方为它定版，"它不存在"的唯一痕迹是 `host-missing` 诊断。

两者都没有被任何检查发现：`check:refactor` 读的是工作树，而工作树自洽——package.json、锁文件、`pnpm-workspace.yaml` 一致地停在同一个过期版本上。

## Decision

`scripts/check-host-alignment.mjs` 解析宿主发布线，并在任何一项与它不一致时失败。

**基线是解析出来的，不是存下来的。** 脚本向 registry 查询 manifest 声明的、或源码引入的每个 `@deepseek-ai/dsh-*` 包的 `next` dist-tag，并要求整个家族收敛到同一个版本——家族是同步发版的，出现分歧属于错误而非投票。默认刻意不用 `latest`：dsh 家族发布在 `next`，而 `latest` 落后好几个 minor。`--host-version` 显式指定基线并跳过网络；`--channel` 选择其他 dist-tag；`node_modules/.cache/` 下五分钟缓存让提交路径保持轻快，`--offline` 宁可拒绝也不猜。

**五条规则，对应配置漂移的五种方式：**

| 规则                                    | 检查内容                                                                             |
| --------------------------------------- | ------------------------------------------------------------------------------------ |
| `peer-stale` / `dev-stale`              | 每个已声明的宿主包 peer 为 `^<baseline>`、dev 为 `<baseline>`                        |
| `peer-missing` / `dev-missing`          | 源码引入的每个宿主包都已声明，且每个 peer 都有 dev 镜像                              |
| `optional-undeclared`                   | **只**经 `import(...)` 到达的包必须是可选 peer——静态 import 携带编译期契约，保持必需 |
| `cordis-mirror`                         | `@deepseek-ai/cordis` 在 peer 与 dev 中携带同一个范围，它自成 4.x 线                 |
| `exclusion-missing` / `exclusion-stale` | `pnpm-workspace.yaml` 的 `minimumReleaseAgeExclude` 对每个已对齐的包都接受该基线     |

`@deepseek-ai/dsh-client-*` 豁免 peer 规则：它们是宿主提供的 bundle external，只通过 devDependencies 钉版，从来不是可安装能力。

**三道门禁，因为漂移可能在三个时点被引入。** `.githooks/pre-commit`（由 `prepare` 经 `core.hooksPath` 注册，新克隆无需 hook 管理器即可获得）在漂移的提交存在之前就拦下它。`prepack` 在每次 `pnpm publish` / `npm pack` 执行，覆盖真实发布路径。`npm-publish.yml` 在 `release-please` job 里、release-please-action **之前**执行门禁，使漂移的 `main` 不会变成 tag 与一个没有 npm 产物的 GitHub Release——那是 release-please 不会回头重做的状态。`--fix` 重写 pin、补齐缺失声明、归一化本仓库自己拥有的逃生舱条目，然后提示必须用 `pnpm install` 刷新锁文件。

## The 0.1.2-rc.1 → 0.1.5-rc.2 alignment this produced

重新对齐 pin 需要三处适配：

- `@deepseek-ai/dsh-client-ui-primitives` 不再声明其浏览器依赖（harness `f39a37a523`，"keep browser dependencies out of production installs"），而它的 `lib/index.js` 仍然 import 它们；宿主 web app 在打包时提供，因此本仓库自行声明在 Vitest `inline` 下加载该模块所需的十六个包。
- `@deepseek-ai/dsh-session` 的 session header 迁移到 `version: 3`。
- `surfaceOp` 的 replace 形状变为 `{ op, startSeq, endSeq }`。

## Alternatives considered

- **仓库内基线文件**（`host-baseline.json`）供门禁读取。否决：它正是那个会过期的字段的第二份真相来源，还得再为它配一道门禁。registry 已经回答了这个问题，离线场景由 `--host-version` 覆盖。
- **Renovate / Dependabot。** 否决：它们按自己的节奏开版本 PR，不知道 dsh 家族是以 `next` 为唯一发布线同步发版，也不处理 prerelease 的 peer 范围语义与 `minimumReleaseAgeExclude` 逃生舱，而且无法让一次发布失败。
- **把 peer 范围放宽到跨 prerelease 线**（`>=0.1.2-rc.1 <0.2.0`）。否决：这等于宣称与本仓库从未构建过的宿主版本兼容，并掩盖门禁存在的意义本身。钉住已测线是本仓库既有的成文约定。
- **Husky 或 `simple-git-hooks`。** 否决：为一个 hook 引入一个新依赖和一套 hook 管理器。`core.hooksPath` 加 `prepare` 无依赖地达到同样的终态，且 hook 文件留在仓库里可被评审。
- **在 pre-commit hook 里自动修复。** 否决：静默重写 `package.json` 与 `pnpm-workspace.yaml` 会改动作者仍在编辑的工作树。hook 改为带着 `fix:host-alignment` 命令失败，让重写成为作者的显式动作。
- **只在 `npm-publish` job 设门禁。** 否决：该 job 在 release-please 已经创建 tag 与 GitHub Release 之后才跑，失败会留下一个没有 npm 产物的已发布 release。给 `release-please` job 设门禁则从源头阻止 tag。
- **让 `@deepseek-ai/dsh-client-ui-primitives` 在 devDependencies 里留在 0.1.2-rc.1**，好让它的浏览器依赖继续传递进来。否决：这就是本次改动要消除的漂移，只是逐个包地保留而已。

## Consequences

- 宿主换线现在表现为一次失败的提交或失败的发布 run，消息里带着确切的期望版本；而不是一份无人察觉、直到消费方报 peer 解析失败才暴露的过期 tarball。
- 门禁在缓存窗口内首次运行需要网络。它以失败关闭（退出码 2）并在消息里点名 `--host-version` 逃生口，而不是静默通过。
- 对齐现在是两步习惯：`pnpm run fix:host-alignment`，再 `pnpm install`。漏掉第二步会留下过期的锁文件，由 CI 的 `pnpm install --frozen-lockfile` 兜住。
- 门禁只能在本仓库动作时触发。若宿主线在上次发布之后才推进，已发布的 tarball 会一直保留旧范围直到下一次发布——发布前检查够不到更远。
- `--fix` 只归一化本仓库自己的包所需的逃生舱条目；pnpm 为传递依赖写入的条目原样通过，包括它在反复更新中合并出的 `a || b` 版本列表。

## Deferred

`scripts/check-host-alignment.mjs` 没有单元测试。它被三道门禁在每次提交、打包、发布中执行，但某条规则坏掉会表现为误通过而不是断言失败；该脚本读取固定的仓库路径，要测试它得先让根路径可注入。
