# DSH 插件开发规范（DeepSeek Harness Plugin Development Standard）

- 版本：1.0.0 · 运行时基线：**本机实际运行的 dsh CLI 0.1.1-rc.2**（全局安装）
- 参考实现：本仓库 `dsh-agent-plugins-market` v0.5.2（已发布的成熟 DSH 插件）
- 受众优先级：**AI Agent 执行优先，人类复核友好**。条款为祈使句，用 MUST / SHOULD / MAY（RFC 2119 语义）；多数小节附「依据」，指向真实文件或命令供人抽查。
- 配套脚手架：独立项目 [`dsh-plugin-scaffold`](../../../dsh-plugin-scaffold/)（`~/workspace/dsh-plugin-scaffold`，从零起步复制即用）；其根目录 `AGENTS.md` 是本规范的**自包含执行投影**（复制出去后无需携带本文即可执行）。

## §0 使用方式

**Agent：**

1. 开工前按序阅读：§8（执行协议）→ §3（分层约束）→ §2（包结构）→ 当前任务相关章节。
2. 新项目：复制独立脚手架仓库 `~/workspace/dsh-plugin-scaffold/` 全部内容到新仓库根，按其 `README.md` 改名并走完五步验收。
3. 已有项目：将 `AGENTS.md` 对齐到仓库根，并核对 §3 禁边是否有 dep-cruiser 落点。
4. 本文与现实冲突时：停下来向用户报告，不要静默绕过，也不要私自改规范（P6）。

**人（复核者）：** 每个 MUST 都能落到三类证据之一——参考实现中的对应文件、CI 里的检查脚本、或附录 A 的 rc.2 实测结论。

---

## §1 系统上下文（C4-L1）：DSH 插件是什么

一个 DSH 插件是**一个 npm 包**，被装进某个 dsh profile，由全局 dsh 进程加载为一条 Cordis 插件行：

```text
npm/GitHub 市场 ──(pnpm add / dsh plugin add)──▶ profile(node_modules + bundles)
global dsh CLI(rc.2) ──读 profile──▶ Cordis runtime ──apply(ctx)──▶ 插件 host 面(Node)
Web GUI(浏览器) ──window.__ModuleLoader__──▶ 插件 client 面(单文件 CJS bundle)
```

**MUST**

- 把自己当宿主进程里的客人：不修改 harness 自身文件、全局配置、其他插件的私有数据；一切持久化写在 `$DSH_HOME` 下自己的命名空间目录里。
- 任何时刻清楚当前代码跑在 Node host 还是浏览器 client；跨面共享的只有 `contracts` 层纯数据类型。

> 依据：README Quick start；package.json `dsh` 字段；cordis.patch.yml。

## §2 容器视图（C4-L2）：包结构与装载链

### 2.1 package.json

**MUST**

- `exports` 双入口：`.`（host，构建产物 `lib/index.js`）与 `./client`（浏览器 bundle）。
- `dsh.bundle.patch` 指向包内 `cordis.patch.yml`，后者用 `insert: [{id, name}]` 把插件行插入 profile layer 栈。
- `dsh.client.inject` 列出 client 面要 `require()` 的官方客户端模块（常用：`dsh-client-connection / -runtime / -locale / -ui-settings / -ui-theme`）。注意：inject 列表不含 ui-primitives，但它可以直接 require（附录 A）。
- `peerDependencies` 声明 `@deepseek-ai/cordis` 及用到的官方能力包；可选能力加 `peerDependenciesMeta.optional` 并优雅降级。
- 构建产物（`lib/`、`client/`）由 `prepack` 生成；是否随 git 提交属于发布策略（参考实现选择提交，让 GitHub 安装免构建），SHOULD 用 ADR 记录该选择。

### 2.2 Host 入口（src/index.ts）

**MUST**

- 函数式插件：named exports `name` / `inject` / `apply(ctx, config)`，无 default export。
- `inject` 只声明硬依赖；可选服务一律 `ctx.get('xxx') !== undefined` 判空后使用。
- 未在 `inject` 声明的服务，禁止以 `ctx.serviceName` 属性访问。

### 2.3 Client bundle

**MUST**

- 单文件 CJS（tsdown，`platform: browser`），React/ReactDOM/官方 `dsh-client-*` 保持 external。
- 产物满足 Web app module-loader 契约：`window.__ModuleLoader__.load({ id, factory })` 包装；CSS 内联注入 `document.head`（loader 在普通函数作用域 eval，`import './style.css'` 会语法错误）。参考 `scripts/normalize-client-banner.mjs`。
- Client 禁止 import 任何 host 模块或 `node:*`。

> 依据：package.json；tsdown.config.ts；scripts/normalize-client-banner.mjs；cordis.patch.yml。

## §3 组件分层与架构约束（C4-L3 + 适应度函数）

### 3.1 六层职责表

| 层          | 目录              | 职责                                      | 允许 import                     |
| ----------- | ----------------- | ----------------------------------------- | ------------------------------- |
| Model       | `src/model`       | 领域类型 + 持久化状态结构                 | （无）                          |
| Catalog     | `src/catalog`     | 外部源检出、格式解析、扫描校验            | model、`node:*`                 |
| Application | `src/application` | 深模块接缝：外部内容 × 用户状态 = 快照    | model、catalog                  |
| Runtime     | `src/runtime`     | 注入面挂载 / 对账 / 清理                  | model、application、`node:*`    |
| Contracts   | `src/contracts`   | 浏览器安全 wire DTO + 集中 route builders | model                           |
| Client      | `src/client`      | React UI（features + 共享控件）           | contracts、经 inject 的官方模块 |

Host 入口（`index.ts` / `routes.ts` / `context.ts`）**留在 `src/` 根**作组装点，不强行归层（ADR-0001 结论）。

### 3.2 禁边 = 适应度函数（CI 强制）

`.dependency-cruiser.cjs` 五条起步规则：client↛host/`node:*`、catalog↛application/client/runtime、runtime↛client/routes、contracts↛runtime/application 等。**MUST**

- `check:architecture` 进入质量门与 CI。
- 需要新增跨层引用时，先改规则并写明理由，不允许加 ignore 注释绕过。

### 3.3 扩展轴分离

「外部格式方言」（layout dialect）与「运行时 surface」是两条独立扩展轴。**MUST**：新增/修改对外部格式的支持只落在 catalog + `tests/fixtures`；runtime mounts 与 client **永不**解析外部源格式。

### 3.4 读模型唯一接缝

凡涉及「发现内容 × 用户状态」的推导（概览、详情、启用集、状态投影），**MUST** 收敛到一个 application 深模块；消费方直连它，禁止各自重算。兼容 facade 必须带测试与显式删除条件，条件满足立即删除。

### 3.5 内容与状态分离

外部来源内容（发现结果，可随时重建）与用户所有物（安装状态、启用开关）是两类事实，**MUST** 分开建模与存储；只有用户动作能改变后者。

### 3.6 生命周期可逆性

一切副作用（服务注册、事件监听、定时器、子进程、HTTP 路由、DOM）**MUST** 挂在 `ctx.effect(fn, label)` 或返回 disposer 的官方 API 上，保证 stop/update/undefine 全量回收。

> 依据：docs/adr/0001-catalog-centered-modular-refactor.md；.dependency-cruiser.cjs；docs/design/engineering-refactor-plan.md。

## §4 运行时能力与注入面（rc.2 实测）

可用能力以全局安装为准：`/opt/homebrew/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/`（约 200 个官方包）。常见注入面：

| Surface | 用法 | rc.2 注意事项 |
| --- | --- | --- |
| Skills | `ctx.skills.registerProvider(control => provider)`；`control.invalidate()` 失效缓存 | 需 dsh-skill；rank 参考 project 250 / user 450 |
| MCP | 每个有效 server 挂一个 `@deepseek-ai/dsh-mcp-client` 子实例 | `${ENV}` 引用先过凭证服务；缺失 → 阻塞启动并报 `needs-credentials`，禁止静默起废进程 |
| Hooks | `@deepseek-ai/dsh-hooks-claude-code` 桥映射拦截点 | 仅映射子集 |
| Commands / Subagents | `commands/*.md` 注册 slash 命令；`agents/*.md` 注册 `agent-*` skill | 命令注册是**进程级**，不是 session-cwd 级 |
| HTTP 路由 | `ctx.inject(['webServer', 'loader'], …)` + effect 清理 | 变更路由仅同源 POST；body 设上限 |

**MUST**

- 接口类型上没有、但运行时实例上存在的能力（rc.2 实例：`ctx.sessions.refresh` / `ctx.workspaces.refresh`）：守卫调用（`typeof x === 'function'`）并注释原因；禁止裸调。
- 可选 peer 缺失：功能降级为逐单元诊断信息，不得使宿主崩溃。

## §5 安全基线

全部 **MUST**：

1. 外部进程只用 `execFile`（无 shell）；clone `depth 1`、pull `--ff-only`、设超时。
2. 用户可配置的可移植路径必须 `./` 开头，解析后仍在插件根内；拒绝 symlink 逃逸。
3. 敏感值（token/key）write-only：内存解析，绝不写入状态/覆盖 JSON；一切状态与详情投影对敏感字段脱敏。
4. 第三方输入的任何失败（坏 manifest、非法 skill、未知 transport、挂载失败）收敛为该单元的 diagnostic，不冒泡。
5. 变更型 HTTP 路由：仅同源 POST，body ≤ 64KiB。
6. UI 最外层包 ErrorBoundary，渲染失败降级为提示卡片。

> 依据：README「Security model」；src/runtime/mcp-redaction.ts、mcp-credentials.ts。

## §6 测试与质量门

- 质量**门**命令序列 SHOULD 合为一个脚本（参考 `check:refactor`）：`typecheck → lint → format:check → test(契约优先) → check:architecture`。
- 外部格式解析 **MUST** fixture 先行：每种 dialect 一组 fixtures（含恶意与边界样本），测试只跑 fixtures，不跑网络。
- React 组件至少 render 冒烟测试；wire DTO 与路由有契约测试。
- vitest 经验值：多文件共享 fixture / 全局 React 状态时 `fileParallelism: false`（串行全量秒级完成）。
- ESLint 基线：`@typescript-eslint/no-explicit-any: error`；未用变量报错（`^_` 豁免）。

## §7 工程治理

- Conventional Commits 分类铁律：**只有安装者可感知的变化才用 `feat:` / `fix:`**；内部重构/测试/CI/文档一律非升级类型。自查句式：「这条 commit 写进 CHANGELOG 丢不丢人？」（scoped 的 `fix(ci)` 也算违规——照样 bump。）
- 发布走 release-please 自动化；版本策略与回滚政策（先 `npm deprecate` 后考虑 unpublish）SHOULD 固化为 ADR。
- 文档义务：`CONTEXT.md` 领域词汇表随概念演进更新（保护概念边界，如「catalog source ≠ layout dialect」）；每个重大决策写成 ADR（模板：scaffold `docs/adr/0000`）。
- 双语仓库 SHOULD 维持「另一语言主体 + 一段对方语言摘要」纪律；标识符/API 名保留原文。

## §8 Agent 硬约束（执行协议）

**环境事实（开工前核对，不凭记忆假设）：**

- **E1** 运行时基线 = 本机全局 dsh CLI `0.1.1-rc.2`（`/opt/homebrew/bin/dsh`）；官方运行时包全部在其 `node_modules/@deepseek-ai/` 下。
- **E2** API 调研只认 E1 目录的实际 lib 与 `.d.ts`；workspace 里的 deepseek-harness 源码 checkout 与运行环境版本不同步，**禁止**作为 API 依据。
- **E3** profile 的 node_modules 只放插件与其依赖；不要把官方运行时包装进 profile。

**流程规则：**

- **P1** 动手前先搜已有方案（开源实现、仓库既有代码、官方包），评估复用后再自研。
- **P2** 能力不确定时先查类型定义/实际导出再写调用；接口类型缺失的运行时能力守卫调用（§4）。
- **P3** 每次改动收尾跑满质量门并如实报告本地实测输出。
- **P4** 验证与审查只报告本地实际状态；**未经用户明确批准不 commit、不 push**。
- **P5** commit 类型遵守 §7 分类铁律。
- **P6** 发现规范与运行时现实冲突：停下报告、等决策；不静默绕过、不私改规范。

**DoD（完成的定义）**

- [ ] 质量门全绿，且结果来自本地实跑
- [ ] 新增外部格式有 fixtures；新增约束有 dep-cruiser 或测试落点
- [ ] 副作用全部可逆；每条降级路径有诊断
- [ ] 三件套同步：CONTEXT.md 词汇、ADR（若有决策）、README 行为变化

## §9 从零起步

复制独立脚手架仓库 [`dsh-plugin-scaffold`](../../../dsh-plugin-scaffold/)（`~/workspace/dsh-plugin-scaffold`）全部内容到新插件仓库根 → 按其 `README.md` 完成改名与五步验收 → 第一个重大选择写 `docs/adr/0001-*.md`。

---

## 附录 A：rc.2 已验证事实与已知缺口

**已验证：**

- Client bundle 由 `window.__ModuleLoader__.load({ id, factory })` 装载；CSS 必须内联注入 head。
- Client `dsh.client.inject` 表不含 `dsh-client-ui-primitives`，但可直接 `require('@deepseek-ai/dsh-client-ui-primitives')`。
- Host `ctx.sessions` / `ctx.workspaces` 的 `refresh` 在 rc.2 接口类型上不存在、运行时实例存在 → 守卫调用。
- `settings.section` 槽位仅新版 Web 壳提供；legacy 壳需 page-mode 回退分支（探测后二选一，不重复渲染）。

**已知缺口（截至 rc.2，遇到时先查有无新版本再走私有路径）：**

- 客户端行菜单槽位 `sidebar.workspaces.session.actions` 不存在；行操作需经 session-context-menu extensions 桥，并自行创建共享 registry 对象防加载顺序问题。
- 会话 unarchive 无官方 API，只能走私有 registry 路径（守卫 + 注释说明）。
- 无 per-session 工具作用域：项目维度 MCP 无法挂载；命令注册进程级、非 session-cwd 级。

## 附录 B：API 调研入口

1. 全局运行时：`/opt/homebrew/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/<pkg>/`（E2 唯一依据）。
2. 会话内动态插件：Cordis Inspect Providers（Service / Event / Slot / Tool 合同查询）。
3. 分层样例：本仓库 `src/{model,catalog,application,runtime,contracts,client}`。
