# Agent Note：每个 schema 一个真实仓库的兼容性报告

Status: implemented

## 问题

兼容性矩阵原本只是文档与源码核对：「按官方文档与本插件源码逐项核验（2026-09-08）」。这句话回答不了兼容性主张真正会提出的两个问题。第一，真实仓库的清单是否满足我们在 `schemas/` 里发布的契约？第二，本插件读取该仓库时，到底有没有读这个方言——还是优先级更高的清单胜出？[规范库](2026-09-08-plugin-specification-library.zh.md)为十种布局加了字段级契约，却从未拿真实文件跑过；新增的 ZCode、Qoder CLI、GitHub Copilot CLI 三行更是没有任何证据。

## 决策

- **每个 schema 做两项互相独立的测量，因为两者会各自失败。** _Schema 一致性_：解析方言清单，用 Ajv 对照 `schemas/<dialect>/*.schema.json` 校验。_扫描器接入_：用随包发布的扫描器（`lib/catalog/suite-scanner.js` 的 `scanSource`）读取同一个 checkout，记录胜出布局、套件数、能力面与扫描备注。一行可以同时「schema 通过」且「扫描器被遮蔽」——九个样本里有六个正是如此。
- **每个 schema 一个仓库，按分支钉定。** `scripts/compat-sources.json` 钉住「使用该布局且 star 最多」的 GitHub 候选：先用代码搜索找出候选，再用批量 GraphQL 查 star，最后逐文件确认它确实提供该布局。报告记录实际 checkout 的提交号，样本不会悄悄漂移。
- **获取方式是稀疏、blobless、延迟检出。** 先用 `--depth 1 --filter=blob:none --no-checkout` 克隆，设置 sparse 规则，再 `git checkout`。`--no-checkout` 是关键：单纯的 `--sparse` 克隆仍会先取出根目录 blob，某个样本因此要以 155 KB/s 下载 54 MB 的 GIF。先设规则后检出，12 GB 的仓库不到 1 MB。checkout 缓存在 `node_modules/.cache/compat-report/`。
- **一套点出关键情形的判定词。** `integrated`：扫描器把该方言自己的清单读作套件身份。`shadowed`：发现了套件，但胜出的是另一种方言的清单。`unread`：没有发现任何套件。`error`：获取或扫描失败。遮蔽（shadowing）正是矩阵此前无法表达的那个发现。
- **报告是生成物，并有离线守卫。** `node scripts/compat-report.mjs` 写出 `docs/compat-report.md` 与 `docs/compat-report.json`；两者因为是生成物而列入 `.prettierignore`。`tests/compat-report.test.ts` 强制覆盖（每个方言 schema 都要有样本，外加内置的 agent-plugins schema）、形状、提交号与判定词合法性、被引用的 schema 文件确实存在，以及两份 README 都引用每个抽样仓库并链接报告。它完全不联网。
- **README 矩阵带实测行。** ZCode、Qoder CLI、GitHub Copilot CLI 的清单路径已被识别，并附明确的能力边界；「抽样验证」表列出布局、仓库、方言清单、schema 结论与扫描器结论。脚本测量前重新编译当前扫描器，从其布局注册表读取 marketplace 路径，并区分文件存在与策略实际产出。
- **schema 仍是参考契约。** 报告只做测量，不会让扫描器在运行时按自撰 schema 校验。那仍是一个独立的 fail-closed 决定，本次刻意不做。
- **替代性检查。** 本笔记扩展而非取代[规范库笔记](2026-09-08-plugin-specification-library.zh.md)：schema 的角色不变，本笔记只拥有「如何测量它们的主张」。[README 信息结构](2026-09-08-readme-information-structure.zh.md)仍拥有 README 的组织方式，本笔记拥有兼容性章节背后的证据。

## 考虑过的替代方案

- **只在 README 手写证据表。** 否决：无法重新生成，读者也无从分辨哪一格是实测、哪一格是断言。
- **把 harness 放进 CI。** 否决：九次联网克隆、其中一个是 12 GB 仓库，不该进 CI。守卫测试让签入的报告在结构上保持诚实，且不需要网络。
- **用厂商自己的校验器**（ZCode 的 `scripts/validate.py`、Qoder 编译后的 Zod bundle）。否决：等于把厂商实现复制进本仓库，且随客户端发版过期。我们发布的 schema 才是被测契约。
- **完整浅克隆。** 否决：`saadeghi/daisyui` 有 12.3 GB；稀疏 blobless 克隆同一个仓库只要约 836 KB。
- **按能力面而不是按 schema 取样。** 否决：需求是「每个 schema 一个仓库」，1:1 映射让覆盖测试简单、报告可读。
- **既然手上有真实清单，顺手把自撰 schema 接进运行时校验。** 本次否决：那会改变所有既有源的 fail-closed 行为，应作为独立变更、带着自己的兼容面来讨论。

## 后果

- 九个抽样清单全部满足已发布的 schema，其中三个被按自身方言读取。六个被遮蔽：`saadeghi/daisyui`（Codex 样本）按 agent-plugins v1 读取，`EveryInc/compound-engineering-plugin`、`DietrichGebert/ponytail`、`zenstory-ai/oh-story-claudecode`、`headroomlabs-ai/headroom` 按 Claude Code 读取，`obra/superpowers` 也按 Claude Code 读取。这是生态的属性——热门仓库常常同时提供多种方言——不是扫描器缺陷，但它确实意味着某个方言自身的身份常常不是被采用的那一个。
- 三种新方言已被识别，但抽样仓库仍由优先级更高的清单胜出。独立布局测试覆盖未被遮蔽的身份；报告不会从 schema 通过推断运行时兼容。
- 报告是某一时点的测量。`generatedAt`、每个样本的提交号与选择日期让过期状态可见，重新生成只需一条命令。
- 现在新增一个 schema 就必须新增一个样本，否则覆盖测试会失败。这个耦合正是目的。
- 矩阵仍然不认证在原平台上的端到端行为；它记录的是本插件读取真实仓库时做了什么。

## 验证

- `node scripts/compat-report.mjs`——九个样本，schema 全部通过，三个 `integrated`、六个 `shadowed`，写入 `docs/compat-report.json` 与 `docs/compat-report.md`。
- `pnpm exec vitest run tests/compat-report.test.ts tests/schemas.test.ts`——十个用例，覆盖报告覆盖度/形状、schema 编译与 README 证据链接。
- `README.md`、`README.zh.md` 与 `docs-site/src/pages/compatible-plugins.astro` 已更新新行、抽样验证表与报告链接。
