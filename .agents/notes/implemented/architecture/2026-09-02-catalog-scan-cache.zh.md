# Agent Note: 目录发现扫描缓存与并行套件遍历

Status: implemented

## Problem

用户维度目录在每次快照构建时都会从磁盘全量扫描每个 checkout。安装真实规模的插件市场后（一个 1,874 套件的社区市场、一个 465 套件的合集，总计约 2,650 个套件），一次冷构建约 1.1 秒，瓶颈在 CPU 密集的套件读取（清单探测、frontmatter 解析、运行面计数），而非 I/O。由于 `notifyChanged()` 会作废整个快照，且客户端每次操作后都会重新拉取 overview，日常 UI 操作——安装、开关套件、变更后打开 MCP/LSP 面板——每次都要付出约 1.1 秒的全量重扫。面板载荷本身很便宜（热 MCP 状态约 55ms）；重扫抖动就是全部延迟问题。

并行化遍历（把 `collectRoot` 的逐目录串行递归换成按序并发的子目录遍历）实测没有帮助（约 730 → 约 700ms；`UV_THREADPOOL_SIZE` 扩容也确认瓶颈不是 fs 线程池），所以修复方向必须是缓存，而非并发。

## Decision

目录层的两层缓存，都有界，且都保留了真正需要新数据的变更路径：

- **发现扫描缓存**（`Catalog.buildSnapshot`）：以 `[dimension, dimensionRoot, state.sources]` 指纹为键，TTL 30 秒，≤8 条。快照推导（约 2,650 套件的 installed/enabled/surfaces 映射）始终基于缓存发现重算——该映射约 25ms。仅状态类变更（`install`、`uninstall`、`setEnabled`、`setSurface`、`setMcpOverride`、`setLspServers`、`retryMounts`、`setMcpBackend`、`reauthorizeMcpServer`）经 `notifyChanged` 传入 `keepScanCache = true`，从缓存重推导。内容类变更（add / update / remove / adopt / refresh / acquire / `mergeSources` / `load`）置 `scanCacheDirty`，仅旁路下一次扫描；一次完成的新扫描会清除该标志（最初实现漏了这一步，缓存永不命中——靠测量发现，测试没抓到）。
- **技能 frontmatter 解析缓存**（`surfaces.ts`）：`SKILL.md` 解析结论按路径为键、`mtimeMs`+`size` 为戳，上限 20 000 条，超限整体重置。TTL 到期后的重扫只需重新 stat 文件，跳过数千份 frontmatter 的重读重析；实测刷新后的重扫从约 1.1 秒降到约 0.44 秒。

新鲜度契约：本地源仍然原地读取，但工作树改动在下一次缓存刷新时可见——任何源变更、刷新按钮，或 30 秒 TTL。TTL 为 0 的项目维度快照（`projectSnapshotTtlMs <= 0`，显式禁用缓存）完全旁路扫描缓存，保留其逐读观察语义（由 `tests/native-project.test.ts` 钉住）。

## Alternatives considered

- **按内容戳的每源失效**（git HEAD / 目录 mtime）被否决：git 源打戳便宜，但本地源不行——目录 mtime 探测不到文件编辑，正确的递归打戳成本接近重扫本身。
- **客户端懒加载**（先渲染来源、套件流式到达）被推迟：它改变 wire 契约与 UI 流程，而服务端缓存已经消除了用户实际感知的延迟。
- **进一步并行化套件读取**经实测无意义——负载是解析 CPU 密集，不是 I/O 密集。

## Risks

- 本地源实时编辑有 30 秒陈旧窗口（两份 README 已记载）；编辑 SKILL.md 后期待市场页即时更新的用户需刷新或变更某个源。
- 解析缓存跨扫描仅按路径为键：删除后重建且 mtime/size 完全相同的文件会拿到旧结论——实际不可达（mtime 粒度），但作为打戳弱点记录在案。
- 触达上限时的整体重置使 20 000 个技能文件变化后的第一次扫描略慢；在市场规模下可接受。

## Verification

- `tests/native-project.test.ts` 钉住 TTL-0 旁路；全量套件（277 测试）保持绿；`check:refactor` 绿。
- 在真实 `~/.dsh/agent-plugins` 目录（约 2,650 套件）实测：冷 overview 约 1.2 秒（每次启动/内容变化一次），开关后 overview 约 26ms（原先约 1.1 秒），热 MCP 状态约 55ms，LSP 状态约 1ms，刷新后重扫约 0.44 秒（解析缓存热）。
