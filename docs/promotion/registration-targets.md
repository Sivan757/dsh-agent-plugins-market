# 插件市场/清单渠道收录目标清单

- 调查日期：2026-08-25 · 方式：GitHub API + raw README 只读核查（联网 web_search 余额不足，改用 api.github.com）
- 本体状态：npm `dsh-agent-plugins-market@0.5.1` 已发布；GitHub topics 已打全（含 `dsh-plugin`、`deepseek-harness` 双标签）；仓库描述与 npm keywords 完整
- 纪律：所有对外提交（PR/Issue/表单）**必须先经用户明确批准**

## A. 已收录 ✅（无需动作，发版后留意条目同步）

| 渠道 | 星标 | 证据 | 备注 |
| --- | --- | --- | --- |
| [awesome-dsh-plugin/awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) | ⭐13510 | 2026-08-29 复核：条目已在 main（`data/plugins/Sivan757__dsh-agent-plugins-market.yml`，README.md 第 2606 行双语均有），无需再提交。⚠️ GitHub 网页渲染在 ~512KB 处截断（README 共 725KB，截断线约在第 1966 行），第 2606 行的我们在 github.com 上**看不到**；但 awesome-dsh-plugin.com 官网（position 2465）与 raw 文件均正常可见 | 全生态最大精选列表；收录标准=声明 `dsh.bundle` manifest 可被 `dsh plugin add` 安装（我们满足）。收录流程：改 YAML 后 `node scripts/generate-readme.mjs` 重新生成双 README |
| [imsai-sh/awesome-deepseek-harness-plugins](https://github.com/imsai-sh/awesome-deepseek-harness-plugins) | ⭐185 | README.md:1436 已列 | 不只是清单：自带在线市场 deepseek1024.com + 公开 API + `dsh1024` 安装插件，10566 个插件 |

## B. Topic 自动抓取型 🤖（我们的 topics 已齐，待验证/等待）

| 渠道 | 星标 | 机制 | 当前状态 |
| --- | --- | --- | --- |
| [bradeGithub/DSH-Plugins-Marketplace](https://github.com/bradeGithub/DSH-Plugins-Marketplace) | ⭐141 | CI 每 2h 扫 `topic:dsh-plugin`，「零申请」 | README 未检索到我们；数据文件未能定位 → **待验证** |
| [AdamPlatin123/awesome-dsh-plugins](https://github.com/AdamPlatin123/awesome-dsh-plugins) | ⭐1385 | 声称加 topic 后 8h 自动收录进 PLUGINS-ALL.md | README 与 PLUGINS-ALL.md 均**未见**我们（9000+ 候选池可能有滞后或筛选）→ 建议 PR 登记（有 PR 模板，PLUGINS.md 为登记清单） |
| [ZASENJC/dsh-plugins-store](https://github.com/ZASENJC/dsh-plugins-store) | ⭐66 | 需同时带 `dsh-plugin`+`deepseek-harness` 双 topic（我们均已有），排除 fork/归档 | 待经其 API（api.dshmk.com）查询验证 |

## C. 材料就绪、待批准提交 📝

| 渠道 | 星标 | 材料 | 动作 |
| --- | --- | --- | --- |
| [zhu1090093659/dsh-web](https://github.com/zhu1090093659/dsh-web) 社区插件索引（创意工坊 + dsh-market.com 数据源） | ⭐6004 | `docs/promotion/dsh-web-pr-body.md` 全套 PR 稿（community.json 第 38 条 + market-build 生成物，对齐已合并先例 #1055） | 用户批准后从 `register-agent-plugins-market` 分支提 PR（base: dev）。当前索引 37 条、无我们 |

## D. 需主动提 PR/Issue 的 awesome 清单（按优先级排序）

| 优先 | 渠道 | 星标 | 收录方式 |
| --- | --- | --- | --- |
| P1 | [Anil-matcha/awesome-dsh-plugin](https://github.com/Anil-matcha/awesome-dsh-plugin) | ⭐987 | Contributing 章节，标准 PR |
| P1 | [0xsline/awesome-deepseek-harness](https://github.com/0xsline/awesome-deepseek-harness) | ⭐891 | contributing（生态全景：插件/工具/基础设施） |
| P1 | [Zhiyuan-Fan/Awesome-DeepSeek-Harness-Plugins](https://github.com/Zhiyuan-Fan/Awesome-DeepSeek-Harness-Plugins) | ⭐297 | issue-to-PR 工作流 |
| P1 | [bruc3van/awesome-dsh-plugin](https://github.com/bruc3van/awesome-dsh-plugin) | ⭐274 | 每日自动抓 `dsh-plugin` topic 复核（暂未见我们）+ 作者自荐 SHOWCASE.md「首页最近10条」 |
| P2 | [libukai/awesome-deepseek-harness](https://github.com/libukai/awesome-deepseek-harness) | ⭐203 | 中英双语终极指南，Issues welcome |
| P2 | [Dominic789654/awesome-deepseek-harness](https://github.com/Dominic789654/awesome-deepseek-harness) | ⭐193 | contributing（插件/skills/MCP/profile 层分类） |
| P2 | [beancookie/awesome-dsh-plugin](https://github.com/beancookie/awesome-dsh-plugin) | ⭐114 | 三语清单，投稿入口 |
| P3 | [Alex-Yanggg/awesome-DSH-plugin](https://github.com/Alex-Yanggg/awesome-DSH-plugin) | ⭐83 | 精选列表 |
| P3 | [kejixiaoliang/awesome-dsh-plugins](https://github.com/kejixiaoliang/awesome-dsh-plugins) | ⭐27 | 14 类 280+ 目录 |
| P3 | [fendouai/awesome-deepseek-harness](https://github.com/fendouai/awesome-deepseek-harness) | ⭐21 | 小型清单 |
| P3 | [walkinglabs/awesome-deepseek-harness-plugins](https://github.com/walkinglabs/awesome-deepseek-harness-plugins) | ⭐11 | source-verified 目录 |

## E. 市场站点型（表单/内置目录）

| 渠道 | 星标 | 收录方式 | 状态 |
| --- | --- | --- | --- |
| [dsh-market/dsh-market](https://github.com/dsh-market/dsh-market)（Web 内置可视化市场） | ⭐2291 | 目录来自 npm registry 元数据（src/catalog-npm.ts）+ 可配置源（src/sources.ts）；支持作者自策截图 | 我们在 npm 且 keywords 全 → **待确认其目录可见性**（装一次即可查） |
| [dshplugin/dsh-plugin-hub](https://github.com/dshplugin/dsh-plugin-hub)（dsh-plugin.org 插件中心） | ⭐46 | 官网表单 https://dsh-plugin.org/zh/submit 或 Issue；5048 收录/4470 人工精选 | **未收录** → P1 表单提交 |

## F. 被动发现面（已完成 ✅）

- npm 发布 + 26 个关键词全覆盖（deepseek-harness/dsh-plugin/marketplace/claude-code…）
- GitHub repo topics 16 个全打（`dsh-plugin`+`deepseek-harness` 双标签满足所有双 topic 型市场的门槛）
- 文档站 sivan757.github.io/dsh-agent-plugins-market

## 建议执行顺序

1. **C：dsh-web 创意工坊 PR**（材料现成，6000★ 曝光最大，等用户批准）
2. **E：dsh-plugin.org 表单提交**（人工精选池，一次性动作）
3. **D-P1 四个清单 PR/Issue**（Anil-matcha → 0xsline → Zhiyuan-Fan → bruc3van 自荐）
4. **B 验证**：给 AdamPlatin123 提 PLUGINS.md 登记 PR；用 api.dshmk.com 与 bradeGithub 数据核验双 topic 自动收录是否生效
5. D-P2/P3 长尾批量处理（同一文案复用 promotion-kit.md §5）

> 维护提示：A 类两处条目描述基于旧版本特性（如「no redundant inventory tool」后的表述差异），下次发版时可顺带 PR 更新一句话简介。
