# 宿主版本兼容性矩阵方案（GitHub Actions，发布前验证）

- 状态：**提案 v2**（v1 经独立第三方评审修订；评审方：codex gpt-5.6-luna @ reasoning effort max，2026-09-05，评审全文见会话记录）
- 日期：2026-09-05
- 目标：每次版本发布前，把 `dsh-agent-plugins-market` 装进多个 dsh 宿主版本，验证「能正常启动 + host 面功能正常」，全流程无人值守、**无需 LLM/模型凭证**。

## 修订记录（v1 → v2）

依据评审问题清单修订，关键变化：

1. [Blocker] 启动命令改为 `dsh --profile compat`（`dsh web` 是 `--profile web` 的硬编码别名，v1 草案实际会启动错误 profile）。
2. [Blocker] tarball 用 `npm pack` 精确文件名，heredoc 内通配符不展开。
3. [Blocker] 新增稳定名 `host-compat-gate` 聚合 job；发布门 = 该 job 被配置为 `main` 的 required check（branch protection 是仓库设置动作，workflow 文件配不了）。
4. [Blocker] build/pack 独立成 job 产 artifact，矩阵 job 只装宿主跑探针；补 concurrency / timeout / max-parallel / pnpm cache，action 版本对齐仓库现行 `@v7`/`@v6`/`@v7`。
5. [Major] 矩阵轴语义重定义：PR 门只测「显式支持下限 + 当前稳定版」；`latest/next/alpha` 移动渠道降到 schedule/advisory。
6. [Major] 探针从「端点存在」升级为「功能可证」：预置 local fixture，断言具体 `suiteIds` 与 `scanNotes`。
7. [Major] 探针包含 token→cookie 认证交换兜底；「无需凭证」表述改为「无需 LLM 凭证」；失败 artifact 上传前脱敏。
8. [Major] 明确探针非只读（写入隔离临时状态），修正措辞与清理责任。
9. [Major] §5 补 minimumReleaseAge 事实修正、E1/E2/E3 规范冲突（待用户拍板）、nightly 通知路径等运维缺口。

## 1. 结论与依据

**可复用性调研证据**（P1 要求可审计）：

| 范围                             | 内容                                                              | 结果                         | 日期       |
| -------------------------------- | ----------------------------------------------------------------- | ---------------------------- | ---------- |
| 本仓库 `.github/workflows/`      | quality / npm-publish / codeql / docs-pages                       | 均不做宿主兼容验证           | 2026-09-05 |
| `~/workspace/dsh-*` 本地兄弟仓库 | 各仓 `.github/workflows`                                          | 无宿主版本矩阵               | 2026-09-05 |
| dsh 插件生态公开仓库             | `docs/research/dsh-plugin-registration-ecosystem.md` 所列同类插件 | **未验证**（未逐仓核对远端） | —          |

结论按证据表述为：**仓库内与本地已知仓库未发现可复用方案，需自研**；不做「生态内不存在」的断言。自研可行的前提是 dsh CLI 内置三个无人值守验证入口：

| 入口     | 命令                                       | 验证什么                                                                                |
| -------- | ------------------------------------------ | --------------------------------------------------------------------------------------- |
| 配置组合 | `dsh --profile <p> --dump-config`          | profile 能否组装、cordis.patch.yml 的 `insert` 能否落进 layer 栈（退出码非 0 即失败）   |
| 无头启动 | `dsh --profile <p> web --no-open --port 0` | 全量 Cordis 启动 + 插件 `apply()` 真实执行（skills provider、路由挂载、可选 peer 降级） |
| 功能探针 | HTTP `/api/agent-plugins/*`                | 插件 HTTP 面可用，catalog 扫描产出可断言结果                                            |

**本机已实测 / 待 CI 复测**（dsh 0.1.2-rc.1，无 LLM 凭证）：

- 已实测：`dsh web --no-open --port 0` 正常启动；对 `http://127.0.0.1:<port>/api/agent-plugins/overview` 裸 curl 返回 200 与完整 sources JSON。
- 待 CI 复测：评审依据 `dsh-client-connection` 源码认为 API 需先 `GET /?token=...` 完成 303 跳转换取签名 Cookie，无 Cookie 应 401。与本机裸 curl 200 矛盾——可能 browser-trust fence 只拦带浏览器指纹的请求，**结论以 CI 环境实测裁定**。探针实现上先完成 token→cookie 交换再调 API（成本一行，兼容两种行为）。
- 措辞修正：启动仍需可写的 `$DSH_HOME/.credentials.yaml`（web 会话签名密钥），所以验收条件是「无需 **LLM** 凭证」，不是「无需任何凭证」。

## 2. 兼容面拆解

插件对宿主版本的依赖面有三层，矩阵按此设计断言：

1. **Host 面**：`apply(ctx, config)` 依赖 `@deepseek-ai/cordis`、`dsh-skill`、`dsh-mcp-client`、`dsh-hooks-claude-code`（optional）、`webServer` 等宿主服务。已知断裂先例：0.1.1→0.1.2 `MarkdownText` 需要 `labels`。
2. **Client 面**：单文件 CJS bundle 依赖 `window.__ModuleLoader__` 契约与 `dsh.client.inject` 列出的官方客户端模块。**HTTP 探针不覆盖此面**（见 §5.6）。
3. **装配面**：`package.json` 的 `dsh.bundle.patch` / `dsh.client.inject` 字段、`cordis.patch.yml` 的 insert 语法、profile bundles 列表。

## 3. 矩阵设计

### 3.1 轴（v2 语义重定义）

评审指出 `latest/next/alpha` 是 **npm 移动渠道**，不是支持下限。两套轴分开：

- **PR 必需门（硬）**：显式钉住的两个版本——
  - 受支持下限：当前为 **dsh 0.1.2-rc.1**（与 `peerDependencies` `^0.1.2-rc.1` 一致；下限抬升随 peer 抬升同步改此值）；
  - 当前稳定版：npm `latest` 解析结果。
- **schedule / workflow_dispatch 渠道轴（advisory）**：`next`、`alpha`（以及随时校准的 `latest`）。宿主渠道漂移导致的失败**不阻塞发布**，但必须留痕。

每次运行把解析出的实际版本（`dsh -V`、各官方包版本、OS、Node）写进 job summary，让「代码回归」与「宿主渠道漂移」两类失败可区分。

**alpha 特殊性**：npm `alpha`（如 0.1.2-alpha.5）不满足 `^0.1.2-rc.1` 的 semver 范围，peer 解析可能直接失败——这不是「预期宿主断裂」而是 peer 合约表达的问题。alpha 轴的判定政策见 §7 决策点 D2；在 D2 拍板前 alpha 轴只 advisory 且结果旁标注「peer 范围外」。

- **Node**：22（engines `>=22` 主力线）；24 待 advisory 轴验证后再考虑入硬门。
- **OS**：仅 ubuntu-latest；macOS 后续按需。

### 3.2 触发点与发布门

```yaml
on:
  pull_request:
    branches: [main] # 覆盖 release-please 的 Release PR
  schedule:
    - cron: '0 3 * * *' # 夜间 advisory：渠道轴漂移留痕
  workflow_dispatch:
    inputs: # v2 补输入：手动验证任意 dsh 版本
      dsh_version:
        description: '额外验证的 dsh 版本/dist-tag（可空）'
        required: false
        default: ''
```

发布门结构（评审 Blocker 修正）：

1. 矩阵之上加一个**稳定名聚合 job** `host-compat-gate`（`needs: [build, compat]`，只汇总结果）；
2. **仓库设置动作**：把 `host-compat-gate` 配成 `main` 的 required status check。workflow 文件做不到这件事，落地步骤 §6 列为独立一步；
3. **不做**：把门放 tag 触发的 `npm-publish.yml`——merge Release PR 即自动 tag + publish，tag 时已晚；
4. **运维风险留痕**（评审补充）：release-please 用 `GITHUB_TOKEN` 创建的 Release PR 可能触发 GitHub 的 approval-required 工作流规则，check 是否出现、能否阻塞合并，需在首次真实 Release PR 上验证（§6 步骤 5）。

### 3.3 与本地门的关系

`check:refactor` 继续负责纯代码质量；本矩阵只回答「换宿主还能不能跑」，两者互补、不合并。

## 4. workflow 草案 v2

````yaml
# .github/workflows/host-compat.yml
name: host-compat

permissions:
  contents: read

concurrency:
  # PR 间互斥取消；schedule 与 PR 不同 group，避免夜间任务被 PR 挤掉
  group: host-compat-${{ github.event.pull_request.number || github.ref }}
  cancel-in-progress: ${{ github.event_name == 'pull_request' }}

jobs:
  build:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v7
      - uses: pnpm/action-setup@v6 # 版本经 packageManager 字段钉住
      - uses: actions/setup-node@v7
        with:
          node-version: 22
          cache: pnpm
      - name: Build & pack # 只做一次，矩阵共享同一 tarball
        run: |
          pnpm install --frozen-lockfile
          pnpm run build
          TARBALL="$(npm pack --silent)"   # 精确文件名，杜绝 heredoc 内通配符不展开
          test -f "$TARBALL"
      - uses: actions/upload-artifact@v4
        with:
          name: plugin-tarball
          path: dsh-agent-plugins-market-*.tgz
          retention-days: 7

  compat:
    needs: build
    runs-on: ubuntu-latest
    timeout-minutes: 20
    strategy:
      fail-fast: false
      max-parallel: 2
      matrix:
        include:
          - dsh: '0.1.2-rc.1' # 受支持下限（随 peer 抬升同步维护）
            gate: true
          - dsh: 'latest' # 当前稳定版
            gate: true
          # 渠道轴（next/alpha）由 schedule/dispatch 附加；PR 上不跑
    env:
      DSH_HOME: ${{ runner.temp }}/dsh-home # 隔离；每个 cell 全新，自带清理语义
    steps:
      - uses: actions/checkout@v7
      - uses: actions/download-artifact@v4
        with: { name: plugin-tarball }
      - uses: actions/setup-node@v7
        with: { node-version: 22 }
      - name: Install host
        run: npm i -g @deepseek-ai/dsh@${{ matrix.dsh }}
      - name: Create compat profile
        run: |
          mkdir -p "$DSH_HOME/profiles/compat"
          TARBALL="$(ls "$GITHUB_WORKSPACE"/dsh-agent-plugins-market-*.tgz | head -1)"
          test -f "$TARBALL"
          cat > "$DSH_HOME/profiles/compat/package.json" <<EOF
          {
            "name": "dsh-profile-compat",
            "private": true,
            "dependencies": {
              "dsh-agent-plugins-market": "file:$TARBALL"
            }
          }
          EOF
          (cd "$DSH_HOME/profiles/compat" && pnpm install --no-frozen-lockfile)
          # 官方 peer 是否需要手钉宿主同版本，以 §6 步骤 3 实测为准（D1 未决前不预设进 dependencies）
      - name: Record resolved versions
        run: |
          {
            echo "## dsh@${{ matrix.dsh }}"
            echo '```'
            dsh -V
            npm ls -g @deepseek-ai/dsh --depth=0 || true
            echo '```'
          } >> "$GITHUB_STEP_SUMMARY"
      - name: Layer 1 — compose check
        run: |
          dsh --profile compat --dump-config | tee compose.txt
          grep -q dsh-agent-plugins-market compose.txt
      - name: Layer 2 — headless boot + functional probe
        run: node scripts/compat-probe.mjs --profile compat --fixture "$GITHUB_WORKSPACE/tests/fixtures/cc-marketplace"
      - name: Upload failure evidence
        if: failure()
        uses: actions/upload-artifact@v4
        with:
          name: host-compat-evidence-${{ matrix.dsh }}
          path: |
            compose.txt
            probe-log.txt
          retention-days: 7
        # probe 脚本负责写盘前脱敏：抹去 ?token=、cookie、.credentials.yaml 内容、home 绝对路径

  host-compat-gate:
    # 稳定名聚合 job：branch protection 只盯这个名字，矩阵改名不影响 required check
    needs: [build, compat]
    if: always()
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - name: Aggregate gate
        run: |
          if [[ "${{ contains(needs.*.result, 'failure') || contains(needs.*.result, 'cancelled') }}" == "true" ]]; then
            echo "host-compat gate failed"; exit 1
          fi
          echo "host-compat gate passed"
````

### 4.1 探针脚本 `scripts/compat-probe.mjs`（v2 规格）

**定位修正（评审 #13）**：探针**不是只读**——boot 写 profile/credentials，功能段 POST 添加 source 会保存 state。正确表述：一切写入都落在本次 job 全新的临时 `DSH_HOME` 与插件自身命名空间内，job 结束即随 runner 丢弃；脚本以 `finally` 保证子进程树清理。

1. **启动**：`spawn('dsh', ['--profile', profile, 'web', '--no-open', '--port', '0'])`（v2 修正：绝不用 `dsh web` 别名）。每阶段独立 timeout + `AbortController`；失败或超时升级 SIGKILL，对进程组清理（`detached: true` + `process.kill(-pid)`），并等待真实退出，防 MCP/LSP 子进程残留。
2. **认证交换（兜底实现）**：解析 stdout 启动 URL（含 `?token=`）；先 `GET /?token=...`（`redirect: 'manual'`）取 `Set-Cookie`，带 Cookie 调 API。若实测证明裸调即可 200，此交换也无害。token/cookie 仅存内存，**不进日志、不进 artifact**。
3. **Layer 2a 端点探活**：`overview` / `mcp-status` / `lsp-status` / `config` 各 GET，断言 200 + JSON 类型。评审指出 mcp/lsp-status 只投影已安装启用的 suite，200+object 只证「空状态可序列化」——定位为**启动可证**，功能证明靠 2b。
4. **Layer 2b 功能断言（v2 新增，硬门）**：POST 添加 local source 指向 `tests/fixtures/cc-marketplace`，等待 catalog ready 后拉 overview，断言：该 source 出现且 `cloned: true`；已知 `suiteIds` 齐全；`scanNotes` 无该 fixture 的 error 级诊断。评审确认 fixture 含 skills/commands/LSP 声明可支撑 discovery 断言；MCP/hooks/commands 的**安装启用级**验证列为后续增强（需各自 fixture），本期不做。
5. **证据落盘**：各阶段输出写 `probe-log.txt`，写盘前脱敏（token、cookie、credentials 内容、home 绝对路径），供失败时 artifact 上传。

### 4.2 失败时的证据

compose check 失败 → `compose.txt`（layer 栈缺行）；boot 失败 → probe-log 里 dsh 启动日志；探针失败 → 各端点状态码 + overview JSON（含 `scanNotes`）。分别对应装配面 / 启动 / 功能。

## 5. 风险与实施时需现场核实的点（v2 修订）

1. **profile 最小依赖集（含 E3 规范冲突，待拍板 D1）**：v1 假设官方 peer 包手钉进 profile dependencies；评审指出这违反规范 E3（profile node_modules 只放插件与其依赖），且本机 web profile 实用 `nodeLinker: hoisted` + `autoInstallPeers: false` + 大量额外包，不能证明三依赖即最小闭包。v2 基线改为：只装插件包，依赖 pnpm auto-install-peers 解析 peer，用 `pnpm why` + `require.resolve` 核查没有第二份 Cordis/官方 runtime 被加载；若实测必须手钉，按 P6 走「更新 E3 规范 + ADR」后再改。
2. **minimumReleaseAge（评审 #10 事实修正）**：本仓库 `pnpm-workspace.yaml` 只有 `minimumReleaseAgeExclude`，没有全局 `minimumReleaseAge`；且 compat profile 是独立 pnpm 工程（`--no-frozen-lockfile`），workspace 策略不自动约束它。风险仍存在但机制不同于 v1 表述：夜间装刚发布的 dsh 版本时，主要风险是包刚发布未同步/rate limit，属环境性红灯，应在 runbook 中归类为可重试故障。profile lockfile 生成后留存（artifact）供复现。
3. **E1/E2 运行时基线冲突（待拍板 D3）**：规范 E1 写「本机 dsh 0.1.1-rc.2」，实机已是 0.1.2-rc.1。本方案所有本机实测均基于 rc.1，评审确认 workspace 源码 checkout 仍不作 API 依据（E2 维持）。按 P6 报告：规范基线需要一次显式更新，或本文档声明 as-of 基线为 rc.1。
4. **alpha 轴政策（待拍板 D2）**：见 §3.1。
5. **Release PR check 可见性**：见 §3.2 第 4 条，首次真实 Release PR 上验证。
6. **Client 面（浏览器）验证缺席**：HTTP 探针不覆盖 `__ModuleLoader__` bundle 装载、React 渲染、CSS 注入。评审建议把浏览器 smoke 提为发布前必需 job——**本方案维持阶段化**：第一期门只宣称覆盖 host/API 面（文档与 gate 命名如实表述，不宣称「功能全部正常」），Playwright job 作为第二期单独评审后再定是否入硬门。理由：client 面断裂先例（MarkdownText labels）可被现有 render 冒烟测试部分拦截，且浏览器矩阵的维护成本需先论证。
7. **nightly 运营缺口（评审补充，落地前须定）**：失败通知路径（当前仓库无任何 workflow_run/issue 机制）、责任人、重试策略、issue 去重；`next`/`alpha` 漂移类失败与代码回归的分类标注；cron 为 UTC，写清对应北京时间。
8. **runner 环境事实**：GitHub-hosted runner 的 npm 全局 prefix 权限、`ubuntu-latest` 镜像漂移、Actions 分钟数消耗（评审确认：1 build + N matrix + 1 gate，粗估每轮 15–25 分钟计费）——首轮 PR 实测后回填本文档。

## 6. 落地步骤（v2）

1. 写 `scripts/compat-probe.mjs`（§4.1 规格；解析/断言纯函数部分配 vitest 单测）。
2. 写 `.github/workflows/host-compat.yml`（§4 草案；action 版本与 quality.yml 对齐）。
3. 本地手跑一遍等价流程（pack → 临时 DSH_HOME → install → dump-config → boot → probe），实测裁定：peer 是否必须手钉（D1 输入）、API 认证交换是否必要、全新 DSH_HOME 首启行为。
4. 提 PR 观察首轮矩阵结果，回填 §5.8 的 runner 环境事实。
5. **仓库设置动作（人工）**：branch protection 将 `host-compat-gate` 配为 `main` required check；下一个真实 Release PR 上验证 check 出现并阻塞合并。
6. 启用 schedule 前先定 §5.7 的通知与失败分类，否则 schedule 先不开（避免无人认领的夜间红灯）。
7. 文档同步：本文档 v2 事实 + README（双语）Development/CI 小节 + release runbook 加入 host-compat 门 + Agent Note（双语，记录矩阵轴语义与 D1–D3 决策）；CI 行为本身非安装者可感知，不用 `feat:`/`fix:` 提交。

## 7. 待用户拍板的决策点

- **D1（E3 冲突）**：compat profile 允许手钉官方 peer 包（违反现行 E3，需修规范 + ADR），还是坚持纯插件安装、依赖 auto-install-peers（可能装出双份官方包）？方案基线取后者，实测后回填。
- **D2（alpha 政策）**：alpha 轴定位为「peer 范围外的探索性观察」仅 advisory（基线），还是把 peer 范围扩到 alpha 线？
- **D3（E1 基线漂移）**：规范 E1 的 rc.2 基线何时更新为 rc.1？（影响所有后续 API 调研的锚点）
