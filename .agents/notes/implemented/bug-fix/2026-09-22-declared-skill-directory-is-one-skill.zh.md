# Agent Note：自带 SKILL.md 的路径就是一个技能

Status: implemented

## 问题

清单可以把技能逐个声明为独立目录，而不是声明一个容器。`mattpocock/skills` 正是如此：`.claude-plugin/plugin.json` 的 `skills` 列出了全部 25 个技能目录（`./skills/engineering/codebase-design` 等）。技能目录里，`SKILL.md` 旁边还放着自己的文档——`DESIGN-IT-TWICE.md`、`DEEPENING.md`、`MISSION-FORMAT.md`、`references/`、`scripts/`。

技能发现对每个声明路径先执行平铺 `*.md` 扫描，之后才检查该路径自身是否带 `SKILL.md`，于是技能旁边的每一份文档都被当成平铺技能读取。扫描真实 checkout 产生了 22 条 `skill "<name>": missing YAML frontmatter` 诊断，点名各种参考文档（`PHASE-BOUNDARIES`、`DESIGN-IT-TWICE`、`LOGIC` 等），显示在套件详情面板上。问题不止于噪声：恰好带 `name` 与 `description` frontmatter 的参考文档会被注册成没人声明过的技能。

## 决策

自带 `SKILL.md` 的路径就是一个技能目录。发现只读取那份文档就停止：平铺 `*.md` 扫描、子目录扫描与分类扫描，都只作用于自身没有 `SKILL.md` 的路径。

这条规则针对的是被读取的路径，而不是它所处的层级，因此无论清单声明的是技能目录本身、约定的 `skills/` 容器装着它，还是它位于上两层分类目录之下，规则都成立。`discoverSkills` 在列举任何内容之前先检查 `SKILL.md`。

## 已考虑的替代方案

**跳过名字看起来像参考文档的文件**（大写名称、位于 `references/` 之下）。否决：名字是约定而不是契约，靠猜测哪些 Markdown 是"真技能"来定规则，一旦某个集合换一种写法，就会把合法的平铺技能一起丢掉。

**禁止嵌套扫描进入技能目录。** 否决：它们从来没有进入过。子目录扫描与分类扫描只查找 `child/SKILL.md`，技能的 `references/` 对它们本来就是不可见的。缺陷在于平铺扫描跑在了一个自身就是技能的路径上。

**要求清单声明容器。** 否决：逐个声明技能是合法写法，插件本来就接受它（`declaredSkillDirs` 会逐个解析），为了不读它自己的文件而拒绝这种形态会破坏一个可用的来源。

## 后果

同时带有 `SKILL.md` 与平铺 `*.md` 技能的路径，现在只贡献那一个技能。这种组合自相矛盾——同一个目录不能既是一个技能、又是一个技能集合——兼容集合里也没有任何来源是这样：十四份已配置的 checkout 中，没有任何名为 `skills` 的目录自带 `SKILL.md`。

清单逐个列出技能目录的套件不再把参考文档报成诊断，也不再注册带 frontmatter 的参考文档。市场卡片上的计数与会话里真正可调用的技能一致。

## 验证

`tests/discovery.test.ts` 扫描 `tests/fixtures/declared-skill-dirs/`：这是 mattpocock 形态的测试样本，两个声明技能目录各自带着参考文档，其中一份带合法的 `name` 与 `description` frontmatter。测试钉住发现到的技能集合正是那两个声明的名字、诊断列表为空，以及那份带 frontmatter 的参考文档不在其中。本次改动之前扫描十四份已配置来源报出 22 条此类诊断，全部来自 mattpocock checkout；改动之后一条也没有。
