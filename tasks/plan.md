# 实施计划：中文本地化修复 / 会话间通信 / 项目级功能开关

- 日期：2026-10-03　负责：技术经理（Lead，glm-5.3）
- 分派模型池（用户指定优先级）：local/deepseek-flash → local/space-bunny-free → local/qwen3.8-flash（代 qwen3.9 Flash，见开放问题）→ local/glm-5.3-flash
- 任务跟踪：DSH 任务看板（卡片见下表；本文件是唯一计划文档）
- 截图资产：docs/scratch/task-assets-2026-10-03/{zh-mode-english-strings,composer-toggles-mock}.webp
- 参考资料存档：docs/scratch/claude-cross-session-messaging.md

## 任务总览与分派

| #   | 任务                                             | 看板卡片 | 执行模型               | 依赖      | 规模 |
| --- | ------------------------------------------------ | -------- | ---------------------- | --------- | ---- |
| T1  | 中文模式下英文串修复（图一）                     | 8cf87428 | local/deepseek-flash   | 基线提交  | S    |
| T2  | 会话间通信设计 spike（参考 Claude Code）         | d0c414ff | local/space-bunny-free | 基线提交  | M    |
| T3  | 项目级 surface 开关 + 会话框附近图形控制（图二） | d437a44f | local/qwen3.8-flash    | T1 验收后 | L    |

分派原则：flash/free 模型做实现，Lead（glm-5.3）做评审与验收兜底；产出不合格时换 glm-5.3-flash 重跑该卡。

## 任务定义

### T1 中文模式下英文串修复

问题：应用处于中文模式时，插件相关 UI 仍渲染英文（见图一截图）。验收：

- 截图中每个非专有名词的英文串在 zh 模式下显示中文；专有名词（Claude Code、MCP、LSP、技能/来源名等）不翻译
- 所有新增文案走 src/client/locales.ts 成对 zh/en key（AGENTS.md 双语规范）
- check:quick + test:contract 通过；client 变更后 pnpm run build 成功验证：typecheck / lint / test:contract / build + Lead 对照截图复核。

### T2 会话间通信设计 spike

问题：对齐 Claude Code 的 cross-session messaging 能力（ListAgents/SendMessage/空闲通知/跨机器）。范围：纯设计，不写生产代码。验收：

- docs/scratch/cross-session-messaging-design.md 交付：DSH 现状盘点（会话内 Team 工具、任务看板、~/.dsh/sessions）、与 Claude Code 机制逐项对齐表、落点建议（宿主 core vs 插件）及理由、数据通道设计（全局存储键控）、分阶段实施拆解、开放问题
- 引用的宿主源码路径必须真实存在（harness checkout 只读参考）验证：Lead 评审文档 + 抽查源码引用。

### T3 项目级 surface 开关

问题：按项目维度开关 市场/技能/命令/代理角色/MCP/LSP 六类 surface；图形控制放在会话框附近；状态存全局（~/.dsh，按项目键控）而非项目目录（见图二 mock）。验收：

- 六类 surface 各自可独立开关，且只影响所选项目
- 控制入口位于会话框附近（宿主 composer 周边 slot，先调研宿主 slot 清单再选）
- 状态持久于全局目录，按 workspace 路径键控；项目目录零写入
- 开关在 surface 注入路径（runtime reconciler）上真实生效，不是仅 UI 状态
- 双语文案、客户端样式规范（dsw token，见 AGENTS.local.md）、Agent Note 记录设计决策
- check:quick + test:contract + check:architecture + build 通过验证：Lead 评审 diff + 全量门禁 + 桌面端实际刷新验证（client 重建后生效）。

## 检查点

1. 基线：WIP（角色路由相关）check:quick 绿后提交 —— 本周六，提交窗口允许
2. T1/T2 完成后：Lead 评审，通过后放行 T3（同 checkout，避免并行写冲突）
3. T3 完成后：Lead 评审 + 全量门禁 + 用户验收

## 风险与缓解

| 风险                                                 | 影响         | 缓解                                           |
| ---------------------------------------------------- | ------------ | ---------------------------------------------- |
| qwen3.9 Flash 不存在                                 | 分派目标不明 | 用 qwen3.8-flash 顶替，已向用户标记待确认      |
| 同一 checkout 并行写冲突                             | 高           | T1/T3 串行；T2 只写 docs/scratch，可与 T1 并行 |
| flash/free 模型能力边界                              | 中           | Lead 评审兜底；不合格换 glm-5.3-flash 重跑     |
| 看板权限门（workspace-write 高于会话默认 read-only） | 流程阻塞     | 需用户在看板 UI 一次性确认后才能运行卡片       |
| T3 规模偏大（L）                                     | 中           | goalRun 续跑 + 阶段验收；必要时 Lead 拆卡      |

## 开放问题

1. "qwen3.9 Flash" 是否即配置中的 qwen3.8-flash？（配置中无 3.9）
2. 会话间通信最终落点（宿主 core vs 插件）—— 待 T2 结论后用户拍板
3. T3 全局存储是否复用宿主 settings namespace —— 倾于是，待实现前 mini-design 确认
