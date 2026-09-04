# LSP 运行面支持设计（dsh-agent-plugins-market）

状态：设计稿（待评审）日期：2026-08-29基线：DSH 0.1.1-rc.2（源码含 `packages/lsp` 三包，**未随 rc.2 npm 分发**）；market 插件 0.1.1-rc.2

---

## 0. 问题陈述

claude-plugins-official 提供 10 个 LSP 插件（typescript-lsp、pyright-lsp、rust-analyzer-lsp、gopls-lsp、clangd-lsp、php-lsp、swift-lsp、csharp-lsp、jdtls-lsp、lua-lsp），市场里一个都不显示。根因已定位：

**Claude Code 的 LSP 声明是 marketplace/manifest 内联字段，而 market 的发现器只认目录文件。**

- CC 侧：条目在 `.claude-plugin/marketplace.json` 内联 `lspServers` 键（或插件 `.claude-plugin/plugin.json` 顶层同名键）；插件目录本身只有 README/LICENSE。
- market 侧：`src/catalog/surfaces.ts` 的 `discoverLspEntries()` 只扫描 `.claude-plugin/lsp/*.json` 与反域 `<reverse.dns>/lsp/` 目录；`manifests.ts` 的 manifest 解析不读取 `lspServers` 键。
- 因此 typescript-lsp 在扫描阶段 `surfaces.lsp === 0`，详情页 LSP 区为空，卡片不显 LSP 标签。

同时，DSH rc.2 的宿主侧现状必须在设计中如实对待：

| 组件                                          | 源码                      | npm（0.0.1-rc.x） | rc.2 安装实例        |
| --------------------------------------------- | ------------------------- | ----------------- | -------------------- |
| `@deepseek-ai/dsh-lsp`（`ctx.lsp` seam）      | ✅ packages/lsp/lsp       | rc.1              | ❌ 未安装            |
| `@deepseek-ai/dsh-lsp-stdio`（stdio 宿主）    | ✅ packages/lsp/lsp-stdio | rc.5              | ❌ 未安装            |
| `@deepseek-ai/dsh-tool-lsp`（`lsp` 模型工具） | ✅ packages/lsp/tool-lsp  | rc.1              | ❌ 未安装            |
| `@deepseek-ai/dsh-tool-call-timeout-policy`   | ✅                        | —                 | ✅（tools 列表可见） |

结论：**市场展示层（Phase 1）在 rc.2 上即可完整交付；运行挂载（Phase 2）在同一插件内实现、feature-detect 宿主能力，宿主三包就位后零代码变更自动激活。**

---

## 1. 事实基础（已核实）

### 1.1 Claude Code `lspServers` 契约（marketplace.json 实测提取）

```jsonc
{
  "name": "typescript-lsp",
  "source": "./plugins/typescript-lsp",
  "lspServers": {
    "typescript": {
      "command": "typescript-language-server",
      "args": ["--stdio"],
      "extensionToLanguage": {
        ".ts": "typescript",
        ".tsx": "typescriptreact",
        ".js": "javascript",
        ".jsx": "javascriptreact",
        ".mts": "typescript",
        ".cts": "typescript",
        ".mjs": "javascript",
        ".cjs": "javascript"
      }
    }
  }
}
```

10 个条目 schema 完全一致：`command` + `args?` + `extensionToLanguage`；仅 jdtls-lsp 额外带 `startupTimeout: 120000`（CC 专有扩展，DSH 侧忽略——见 §3.1 降级表）。

### 1.2 DSH LSP 链路（源码事实）

```
lspServers 表 ──映射──> dsh-lsp-stdio Config.servers
                        （command/args/extensionToLanguage/env/initializationOptions/configuration
                         + maxMessageBytes/maxStderrBytes/maxDocumentBytes/shutdownTimeoutMs/killGraceMs）
lsp-stdio ──registerProvider()──> ctx.lsp（extension 独占路由表）
tool-lsp ──模型工具 `lsp`：operation ∈ goToDefinition | findReferences | goToImplementation | hover
          file_path + line/character（1-based UTF-16）+ workspaceRoot 来自 session header.cwd
tool-call-timeout-policy ──> 默认 60s 预算（tool-lsp timeoutMs）
```

- seam 与工具语义：`ctx.lsp.query()` 按 `finalExtension(filePath)` 路由；同 runtime 内扩展独占（两个 provider 不可都认 `.ts`）；只读四操作，无 JSON-RPC 逃逸口；瞬态 didOpen/didClose，无诊断/重命名/格式化。
- tool-lsp 渲染：`path:line:character` 分组定位列表，`maxLocations` 默认 100、`maxResultChars` 默认 16000；UI presenter `{ card: 'generic', kind: 'search' }`。

### 1.3 市场插件既有挂载范式（复用对象）

`src/runtime/mcp-mounts.ts` 已给出完整模板：

- 动态导入宿主包：`await import('@deepseek-ai/dsh-mcp-client')`，失败降级为诊断文本而非崩溃；
- `ctx.plugin(Pkg, config)` 挂载子插件实例 + `handle.await()` / `handle.dispose()`；
- key 去重（derived serverName 占位表）、reconcile 序列队列、有界重试 `[1.5s, 5s, 15s, 45s, 120s]`、disposeAll 兜底；
- per-suite enable 开关（`activeSurfaces`）。 `commands-mounts.ts` 补充了 `ctx.commands?.register` 缺失时的静默降级模式。LSP 挂载逐条对齐这两个先例。

### 1.4 市场展示层现状

- `SuiteSurfaceCounts.lsp` 与卡片 `surfaceLsp` 标签、详情页 LSP 区已存在，只是数据源只覆盖目录型声明。
- `LspPreview { name, content }` 合同已定，详情页以 `<pre>` 展示 JSON 文本。
- **`SurfaceOverrides`/`SUITE_SURFACE_KEYS` 不含 `lsp`**——安装面开关需要补齐。

---

## 2. 目标与非目标

### 目标

1. claude-plugins-official 全部 10 个 LSP 插件在市场中被发现、计数、展示（内联 lspServers + 目录型两种声明）。
2. 详情页给出结构化 LSP 预览（服务器表、命令、扩展映射），不只是裸 JSON。
3. 已安装启用的 LSP suite 在宿主具备 LSP 能力时自动挂载为 `lsp-stdio` 子插件实例，模型获得 `lsp` 工具。
4. 宿主能力缺失时一切照常工作，只在详情页给出可操作的安装指引诊断。
5. `lsp` 成为第五个可按 suite 开关的运行面。

### 非目标

- 不实现语言服务器安装器/版本管理（沿用 mcp 凭证同级的用户自备语义）。
- 不扩展 DSH seam 语义（诊断、rename、格式化、workspace symbol 属 DSH 上游决策）。
- 不做多 provider 冲突仲裁 UI（v1 依赖 seam 的独占语义 + 确定性排序，见 §3.4）。
- 不支持 CC 专有的 `startupTimeout` 透传。

---

## 3. 设计

### 3.1 发现层：`lspServers` 内联声明（Phase 1 核心）

**manifests.ts** 增补一个读取函数，与 `declaredSkillsPath` / `declaredMcpServers` 完全同构：

```ts
/** The winning manifest's inline `lspServers` table, or undefined. */
export async function declaredLspServers(root: string): Promise<Record<string, unknown> | undefined>
```

**suite-scanner.ts** `readSuite()` 增补第二数据源：marketplace 条目级 `lspServers`（`SuiteHint` 扩展为携带 `lspServers?: Record<string, unknown>`；`suiteRoots()` 从 entry 提取传入）。CC 的声明在 marketplace 条目上而非插件 manifest 里，因此 entry 级提取是 typescript-lsp 的主路径；manifest 级 `declaredLspServers` 兜底覆盖"自持 plugin.json 内联 lspServers"的仓库。

**surfaces.ts** `countSurfaces()` / `discoverLspEntries()` 签名扩展，接受合并后的内联表：

```ts
// 返回值扩展：目录项 name=path 的现状不变，新增结构化内联项
export interface LspEntry {
  name: string
  path: string
  /** 内联 lspServers 声明（目录型文件无此字段） */
  inlineServers?: Record<string, LspServerSpec>
}
```

内联条目合成虚拟名 `lsp-servers`（或直接展开为逐 server 条目，见 §3.3 UI 取舍）。计数语义：`surfaces.lsp` = 目录条目数 + 内联 server 数（typescript-lsp 计 1）。

### 3.2 规范化层：`LspServerSpec` + 校验（新增 `src/catalog/lsp-spec.ts`）

```ts
/** 一个规范化的语言服务器声明（CC lspServers 条目的市场侧投影）。 */
export interface LspServerSpec {
  key: string // lspServers 表键名，如 "typescript"
  command: string
  args: string[]
  extensionToLanguage: Record<string, string> // 规范化为小写带点
  env?: Record<string, string>
  initializationOptions?: unknown
  configuration?: unknown
}
```

fail-closed 校验（对齐 validateMcpJson 惯例，错误进 `suite.errors`，不炸发现）：

- `command` 非空字符串；`args` 字符串数组（缺省 `[]`）；
- `extensionToLanguage` 为非空对象，键规范化为小写带点扩展，值非空 language id；
- 未知字段忽略并记一条诊断（宽容）；`startupTimeout` 等已知 CC 专有键忽略不告警。

### 3.3 展示层

**contracts/market.ts**：

```ts
/** 一个 LSP 服务器的结构化预览（详情页）。 */
export interface LspServerPreview {
  key: string
  command: string
  args: string[]
  extensions: Record<string, string>
  /** 目录型声明时的源文件相对路径；内联声明无。 */
  sourcePath?: string
}
```

`SuiteDetail.lsp` 从 `LspPreview[]` 扩展为：

```ts
lsp: { servers: LspServerPreview[]; raw: LspPreview[] }
```

`raw` 保留现有目录型文件的 `<pre>` 展示；`servers` 是新增结构化区。**兼容性**：`detail.lsp.length` → `detail.lsp.servers.length + detail.lsp.raw.length`；SuiteDetail.tsx 渲染两个小节（结构化 server 表 + 原始 JSON 折叠）。远程 suite（未 clone）维持空数组惯例。

**详情页诊断条**（宿主无 LSP 能力时，挂载注册表回报）：

> 此套件声明了语言服务器，但当前 DSH 安装未携带 LSP 组件。将 DSH 升级到携带 `@deepseek-ai/dsh-lsp` / `dsh-lsp-stdio` / `dsh-tool-lsp` 的版本后，启用该套件即可为会话提供 `lsp` 工具（goToDefinition / findReferences / goToImplementation / hover）。

### 3.4 运行挂载层（Phase 2，同仓实现，宿主 feature-detect）

新增 `src/runtime/lsp-mounts.ts`，逐条对齐 mcp-mounts 先例：

```ts
export interface LspMountDiagnostic {
  suiteId: string
  serverKey: string
  reason: string
  code?: 'mount-failed' | 'unmount-failed' | 'seam-conflict' | 'host-missing'
}

export class LspMountRegistry {
  reconcile(enabledSuites: Suite[]): Promise<LspMountDiagnostic[]>
  disposeAll(): Promise<void>
}
```

**映射**（`LspServerSpec` → `dsh-lsp-stdio` Config）：

```ts
{
  servers: {
    [serverKey]: {                       // mount 键内含 suiteId 隔离（见下）
      command, args, env, initializationOptions, configuration,
      extensionToLanguage
    }
  }
}
```

CC 契约与 dsh-lsp-stdio Config 字段几乎一一对应，零转换损耗；忽略项仅为 `startupTimeout`。

**provider id 命名与冲突**：seam 的 provider id 全局唯一且 extension 独占。市场挂载用 **`${suiteId}/${serverKey}`** 作 provider id（天然去重，两个市场的 typescript-lsp 同启也不冲突 id）。**extension 冲突**遵循确定性规则：先到先得（reconcile 顺序 = enabled suites 稳定序），冲突方以 `code: 'seam-conflict'` 报诊断并在 UI 呈现，提示用户按套件开关取舍。这与 DSH seam "独占是有意的 MVP 边界，deployment-configured selector 留作扩展"的决策对齐——市场不做自己的 selector。

**挂载机制**：一个 suite 的全部 server 合并为**一个** `lsp-stdio` Config（一次 `ctx.plugin(lspStdioPkg, { servers })` 挂载），suite 粒度 reconcile/dispose，避免碎 mount。动态导入 `@deepseek-ai/dsh-lsp-stdio`：

- 导入失败 → 该 suite 一条 `{ code: 'host-missing', reason: '宿主未安装 @deepseek-ai/dsh-lsp-stdio…' }` 诊断，**不进重试调度**（包不存在不是瞬态故障——与 mcp 凭证缺失不同类）；
- `ctx.plugin` 挂载失败（含 `resolveExecutable` 找不到 command、extension 冲突、Config 校验失败）→ `mount-failed` 诊断，进既有 RETRY_SCHEDULE（`resolveExecutable` 在 load 时解析，用户 npm i -g 后重试即可恢复，重试有真实收益）；
- 失败粒度是整个 suite 挂载（Config 级），诊断中列出受影响 serverKey。

**工具可用性**：`lsp` 模型工具由宿主 `tool-lsp` 插件提供，市场不注册、不复制其 prompt/语义。市场唯一责任是保证 provider 在 `ctx.lsp` 就位。**组合前提**：宿主 profile 必须挂 `tool-lsp`（+ `tool-call-timeout-policy`、`lsp` seam），否则 provider 注册成功但模型无工具。市场在 `host-missing` / 诊断文案中同时提示这一组合要求。

**超时/生命周期**：全部沿用宿主默认（tool-lsp 60s 工具预算、lsp-stdio shutdown/kill grace），市场零新增计时器。挂载实例生命周期 = suite enable/disable，由 reconciler 统一驱动。

### 3.5 安装面：`lsp` 成为第五开关

- `model/types.ts`：`SuiteSurfaceKey` 增 `'lsp'`；`SUITE_SURFACE_KEYS` 尾插；`effectiveSurfaces()` 增 `lsp: overrides?.lsp !== false`。
- `reconciler.ts`：`RuntimeReconciler` 增 `LspMountRegistry` 成员，`reconcile()` / `dispose()` 并入（独立 try/catch，对齐既有三面）；`RuntimeDiagnostics` 增 `lsp` 槽。
- 挂载过滤：`suite.activeSurfaces?.lsp === false` 的 suite 不参与 wanted 集。
- 存量 state.json 兼容：`SurfaceOverrides` 是 Partial，缺省即启用，无需迁移。

### 3.6 验证

单测（vitest，对齐现有 surfaces/mounts 测试布局）：

1. **发现**：claude-plugins-official fixture → typescript-lsp 被发现，`surfaces.lsp === 1`；marketplace 条目级与 manifest 级两路径各自覆盖；非法 lspServers fail-closed 进 errors。
2. **规范化**：lsp-spec 校验表（空 command / 空映射 / 非法扩展名 / 大小写规范化）。
3. **挂载**：fake `ctx.plugin` + 动态导入注入 → 正确 Config 形状、provider id 命名、suite 粒度挂载、host-missing 不重试、mount-failed 重试上界、activeSurfaces.lsp=false 过滤、extension 冲突次序确定性。
4. **合同**：SuiteDetail.lsp 新形状的类型测试与现有消费者更新。

手工验收：

```bash
# 在携带 LSP 组件的 DSH 构建下（源码 checkout）：
# 1. 市场添加 claude-plugins-official 源 → typescript-lsp 卡片显示 LSP 1
# 2. 安装启用 → 详情页 server 表可见；会话中询问 lsp 工具 → 四操作可用
# 3. 关闭 lsp 开关 → ctx.lsp 路由表释放，工具返回 no provider
```

---

## 4. 分阶段交付

| 阶段              | 内容     | 前置条件                                         | 交付物                                                    |
| ----------------- | -------- | ------------------------------------------------ | --------------------------------------------------------- |
| **P1 发现与展示** | §3.1–3.3 | 无（rc.2 即可）                                  | 10 个 CC LSP 插件可见、可数、可读详情；`lsp` 开关落 state |
| **P2 运行挂载**   | §3.4–3.5 | 宿主含 LSP 三包的 DSH 版本 + profile 挂 tool-lsp | 启用套件即得 `lsp` 工具；无宿主能力时降级诊断             |

P1/P2 同仓同批实现，P2 的行为由 feature-detect 决定，无宿主升级时不激活——**不存在需要用户记忆的开关**。

---

## 5. 风险与权衡

1. **rc.2 用户装了市场插件也没有 `lsp` 工具**（三包未随 npm 分发）。缓解：诊断文案明确指向宿主升级；P1 价值独立成立（可见性/选型信息本身就是市场职能）。
2. **`detail.lsp` 合同变更是 breaking change**。缓解：本插件 client 与 server 同仓同发，无第三方消费者承诺该字段形状（市场 HTTP API 属插件私有面）；CHANGELOG 标注。
3. **extension 独占导致多语言套件同启时后者静默失效**。缓解：seam-conflict 诊断直达详情页；UI 明示"后启用者让位"规则。
4. **市场规模外的 LSP 声明方言**（如 agent-plugins.org v1 若未来接纳 lspServers）。设计已内联/目录双轨，v1 若有自己的键名再加第三适配，不影响本结构。
5. **与 grep/read 的定位重叠**。调研（OpenCode lsp-hover/definition/references/diagnostics 工具集、Zed diagnostics 注入、lsp-vs-grep 评测）一致结论：LSP 提升精确定位与省 token，但模糊探索 grep 仍占优——DSH tool-lsp 的 prompt 定位（"precision aid"）已正确处理，市场不额外加 prompt。

---

## 6. 上游生态对齐备注

- CC 官方 LSP 插件曾被报告全部缺 `.lsp.json`（issue #379，PR #378 修复），说明该生态的声明方式经历过迁移——市场发现器应对"仅 README 的 lsp 目录"保持零计数、零告警，避免噪声。
- OpenCode/Zed/Serena 的模型面工具名与 DSH 四操作集不同属正常产品差异；市场不做任何工具名映射，一切以 DSH seam 为准。
