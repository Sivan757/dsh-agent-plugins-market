# Agent Note: 目录发现扫描缓存与并行套件遍历

Status: implemented

## Problem

用户维度目录在每次快照构建时都会从磁盘全量扫描每个 checkout。安装真实规模的插件市场后（一个 1,874 套件的社区市场、一个 465 套件的合集，总计约 2,650 个套件），一次冷构建约 1.1 秒，瓶颈在 CPU 密集的套件读取（清单探测、frontmatter 解析、运行面计数），而非 I/O。由于 `notifyChanged()` 会作废整个快照，且客户端每次操作后都会重新拉取 overview，日常 UI 操作——安装、开关套件、变更后打开 MCP/LSP 面板——每次都要付出约 1.1 秒的全量重扫。面板载荷本身很便宜（热 MCP 状态约 55ms）；重扫抖动就是全部延迟问题。

并行化遍历（把 `collectRoot` 的逐目录串行递归换成按序并发的子目录遍历）实测没有帮助（约 730 → 约 700ms；`UV_THREADPOOL_SIZE` 扩容也确认瓶颈不是 fs 线程池），所以修复方向必须是缓存，而非并发。

## Decision

按维度的发现缓存由[来源拥有的发现索引](2026-11-12-source-owned-discovery-indexes.zh.md)取代。本记录继续持有来源扫描期间复用技能 frontmatter 解析结果的决策。

- **技能 frontmatter 解析缓存**（`surfaces.ts`）：`SKILL.md` 解析结论按路径为键、`mtimeMs`+`size` 为戳，上限 20 000 条，超限整体重置。TTL 到期后的重扫只需重新 stat 文件，跳过数千份 frontmatter 的重读重析；实测刷新后的重扫从约 1.1 秒降到约 0.44 秒。

[来源拥有的发现索引](2026-11-12-source-owned-discovery-indexes.zh.md)持有来源新鲜度与失效规则。实际扫描时，frontmatter 缓存在复用解析结论之前仍会 stat 每个技能文件。TTL 为 0 的项目维度快照（`projectSnapshotTtlMs <= 0`）逐次观察发现结果，由 `packages/market-bundle/test/integration/native-project.test.ts` 钉住。

## Alternatives considered

- **递归计算可变来源的内容戳以避免发现。** 目录 mtime 探测不到文件编辑，正确的递归打戳成本接近扫描本身。[来源索引决策](2026-11-12-source-owned-discovery-indexes.zh.md)将可变树策略与托管来源的低成本 HEAD 校验分开处理。
- **客户端懒加载**（先渲染来源、套件流式到达）被推迟：它改变 wire 契约与 UI 流程，而服务端缓存已经消除了用户实际感知的延迟。
- **进一步并行化套件读取**经实测无意义——负载是解析 CPU 密集，不是 I/O 密集。

## Consequences

- frontmatter 复用减少扫描时的文档读取与解析，不会省去发现所需的文件 stat 或目录遍历。
- 解析缓存跨扫描仅按路径为键：删除后重建且 mtime/size 完全相同的文件会拿到旧结论——实际不可达（mtime 粒度），但作为打戳弱点记录在案。
- 触达上限时的整体重置使 20 000 个技能文件变化后的第一次扫描略慢；在市场规模下可接受。

## Verification

- `packages/market-bundle/test/integration/native-project.test.ts` 钉住 TTL-0 发现。当前发现行为及验证由[来源索引记录](2026-11-12-source-owned-discovery-indexes.zh.md)持有。
- 此次缓存决策在真实 `~/.dsh/agent-plugins` 目录（约 2,650 套件）记录的测量：冷 overview 约 1.2 秒，开关后 overview 约 26ms（原先约 1.1 秒），热 MCP 状态约 55ms，LSP 状态约 1ms，frontmatter 解析缓存热时刷新后重扫约 0.44 秒。这些是历史解析缓存测量，不是采用来源索引后的目录耗时。
