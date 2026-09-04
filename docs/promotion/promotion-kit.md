# dsh-agent-plugins-market 推广工具箱

- 依据：`docs/research/dsh-plugin-registration-ecosystem.md`（注册机制全景分析）
- 纪律：**所有对外发布（PR/Issue/帖子/发布）必须先经用户明确批准**；本文件只是草稿库。
- 更新：2026-08-25 · 当前版本 0.5.1

---

## 1. 定位语（按场景取用）

| 场景 | 文案 |
| --- | --- |
| 一句话 | 把 Claude Code / Codex / Cursor / Kimi 的整个插件市场生态装进 DeepSeek Harness：加个 git 仓库当源，一键安装，skills、MCP、hooks、斜杠命令在运行时直接注入会话。 |
| 电梯演讲（30 秒） | DSH 很强，但插件生态不如 Claude Code 市场。dsh-agent-plugins-market 是标准桥：任意市场 git 仓库加为源 → 浏览/安装/启用 suite → 四类能力面运行时注入。零转换、零拷贝，Claude Code 技能原样可用。禁用即真实回收 MCP 子进程，不留残留。 |
| 技术圈标签行 | The standard way to run Claude Code plugin marketplaces in DeepSeek Harness — zero conversion, zero file copying, live runtime injection. |
| 给套件作者 | 你的 Claude Code 插件不用改一行代码就能服务 DSH 用户：我们原生读 `.claude-plugin/marketplace.json`，目录即能力清单。 |

## 2. 七大卖点（每条都有机制事实背书）

1. **全能力面覆盖** — 唯一同时注入 skills + MCP + hooks + 斜杠命令/子代理的方案；官方桥件各只管一通道，我们是编排者。
2. **实时生命周期回收** — 禁用/卸载立即卸载 `dsh-mcp-client` 子进程与 hooks 桥（reconcile dispose + 单测 + 真实 DSH 截图证据链）；对比部分同类管理器仅写 next-start 状态。（对外表述保持客观：说"本项目提供实时回收并有证据"，不点名贬低他人。）
3. **零转换七方言** — agent-plugins.org v1 / Claude Code / Universal / Cursor / Kimi / Codex / 无 manifest 技能集；`${CLAUDE_PLUGIN_ROOT}` 自动替换，生态技能 verbatim 运行。
4. **零拷贝迁移** — 仓库自带 `.claude/`、`.agents/` 直接原地发现为只读 project-native 套件，项目技能优先遮蔽同名安装套件技能。
5. **安全模型完整** — 安装期不执行第三方代码；git 走 execFile 无 shell depth-1；v1 manifest/mcp.json fail-closed 校验；路径 containment 拒绝 symlink 逃逸；MCP 凭据 write-only 经 Host credentials 服务，绝不落盘；同源 POST ≤64KiB。
6. **Web GUI 内置市场页** — 源管理、状态页签、卡片栅格、详情弹窗（skills/MCP/hooks/commands 预览），legacy shell 自动降级顶层页面。
7. **官方标准公民** — 完全遵循 cordis bundle 标准（`dsh.bundle.patch` → `cordis.patch.yml` insert），与 workbuddy/workspace-manager 同构；本身就是「如何写 DSH 插件」的活模板。

## 3. 受众与话术

| 受众                                  | 痛点                              | 主打卖点                 |
| ------------------------------------- | --------------------------------- | ------------------------ |
| 从 Claude Code/Cursor 迁移 DSH 的用户 | 技能/MCP 资产搬不过来或要手工拷贝 | 3、4、6                  |
| 插件/套件作者                         | 多端适配成本                      | 3、7（一次发布双端可用） |
| 团队/企业用户                         | 第三方供应链风险、进程残留        | 5、2                     |
| DSH 生态建设者                        | 官方缺第三方插件教程与市场        | 7 + 本项目文档站补位     |

## 4. 渠道与状态

| 渠道                                                                          | 状态                                  | 材料                                             |
| ----------------------------------------------------------------------------- | ------------------------------------- | ------------------------------------------------ |
| npm + GitHub 双语 README（含对比表/FAQ）                                      | ✅ 已上线                             | 根 README.md / README.zh.md                      |
| 文档站（GitHub Pages）                                                        | ✅ 已上线                             | docs-site/                                       |
| dsh-web 社区插件索引登记（community.json 第 38 条）                           | 📝 材料就绪待批准提交                 | docs/promotion/dsh-web-pr-body.md                |
| 生命周期证据链（启停/卸载截图）                                               | ✅ 已沉淀                             | docs/promotion/lifecycle-evidence.md + evidence/ |
| GitHub topics（deepseek-harness / claude-code / mcp）                         | ⬜ 建议补充到 repo about              | —                                                |
| awesome 列表收录申请（awesome-deepseek-harness-plugins、awesome-claude-code） | ⬜ 待批准后提 PR                      | 用 §5 文案                                       |
| 中文社区帖（linux.do / V2EX）与英文帖（X/Reddit r/ClaudeAI）                  | ⬜ 草稿见 §5                          | —                                                |
| 向 deepseek-harness 官方 examples/docs 贡献「第三方插件开发指南」             | ⬜ 机会点：官方无此教程，本项目可补位 | 引用研究文档 §1.4 模板                           |

## 5. 即用文案草稿

### 5.1 中文社区帖（linux.do / V2EX）

> **标题**：把 Claude Code 插件市场整个搬进 DeepSeek Harness：开源工具 dsh-agent-plugins-market
>
> 正文要点：
>
> - 痛点：DSH 没有 Claude Code 那样的插件市场生态；手动拷贝 skill 会丢 `${CLAUDE_PLUGIN_ROOT}`、带不走 MCP/hooks/命令。
> - 方案：`dsh plugin --profile <name> add dsh-agent-plugins-market` → Web GUI 里把任意市场仓库（如 anthropics/claude-plugins-official）加为源 → 一键安装 suite。
> - 注入效果：技能出现在 `/` 菜单；MCP 工具以 `mcp__<suite>__<server>__<tool>` 出现；hooks 挂官方桥；commands/*.md 变斜杠命令。
> - 安心点：安装期不执行第三方代码；凭据 write-only；禁用即回收子进程（附证据截图）。
> - 收尾：MIT 开源，求 ⭐ 与市场源仓库推荐。

### 5.2 英文短帖（X / Reddit）

> Your DeepSeek Harness can now run the whole Claude Code plugin ecosystem. Add any marketplace repo as a source → one-click install → skills, MCP servers, hooks & slash commands injected into your sessions at runtime. Zero conversion, zero copying. MIT: github.com/Sivan757/dsh-agent-plugins-market

### 5.3 套件作者邀请（一句话版）

> Ship once, run twice: publish your Claude Code plugin as usual — DSH users install it via dsh-agent-plugins-market with no changes; your `.claude-plugin` manifest and directory layout are read natively.

## 6. 对外 FAQ 速答

- **和手动拷贝区别？** 不破坏占位符路径、带走 MCP/hooks/commands、有 per-suite 启停与刷新更新路径。
- **支持哪些格式？** 七种方言见 README 表格；一仓多方言并存，manifest 定身份、目录定能力。
- **要 token 的 MCP 怎么办？** `${ENV_NAME}` 引用经 Host credentials 服务 write-only 配置，缺凭据阻断启动并显示 needs-credentials。
- **安全吗？** 安装期零第三方代码执行；git execFile depth-1；schema fail-closed；路径逃逸拒绝；错误按 plugin 隔离。
