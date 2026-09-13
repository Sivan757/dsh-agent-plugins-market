# Agent Note: 升级时清理 profile 里手工添加的 LSP 层

Status: implemented

## Problem

LSP 在 0.6.2 之后才改为自供给（见 [self-provisioned LSP capability](../../architecture/2026-09-11-self-provisioned-lsp-capability.md)），这次改动带来一道插件自身无法消除的迁移坎。

在那之前，README 说明 profile 必须自己暴露 LSP 工具，所以想要语言服务器的用户会手工加这一层：profile 依赖 `@deepseek-ai/dsh-lsp` 与 `@deepseek-ai/dsh-tool-lsp`，并在 profile 自己的 `cordis.patch.yml` 里写两条 `insert`。现在 `LspMountRegistry` 用本包自带的副本挂载这两个 seam，于是升级后那层遗留配置先注册了 `service "lsp"`，所有挂载都以 `seam-conflict` 失败——用户本来能用的功能反而停了。

插件自己也清不掉这个障碍：profile 的 patch 文件在**所有 bundle 层之后**应用，所以本包的 `cordis.patch.yml` 永远无法禁用或替换那一行，只有用户自己的文件可以。而原来的失败信息只是一句写着「the profile」的说明，既分不清是哪几个 profile，也没说要删什么。

## Decision

seam 冲突被报成一次可修复的升级动作，而不是死路。

`findLegacyLspSeams()` 读取 `$DSH_HOME/profiles/*`，用 `yaml` 的 document 模型解析每个 `cordis.patch.yml`，报出 `insert` 行里含 `@deepseek-ai/dsh-lsp` 或 `@deepseek-ai/dsh-tool-lsp` 的 profile。只是*依赖*这些包的 profile 不报：依赖不注册任何东西，不可能是原因。`dsh.profile.bundles` 里列出这些包的会报，因为 bundle 层可以插入行。

冲突文案现在会点名 profile、行内容和文件的绝对路径（`LspMountRegistry` 把查找函数作为可注入依赖，默认用真实扫描，这样测试不会继承运行者本机的 profile）。LSP 面板把同样的事实呈现为一条横幅，配一个动作，且只在冲突真的存在时出现。

`migrateLegacyLspSeam()` 在用户写的文件上完成这次编辑：

- 删除由 YAML document 模型驱动，而不是把解析后的数据重新序列化，所以用户的注释与未知键都会保留。文档会按该库的规范缩进重新输出，因此手工写的、缩进风格混杂的文件也会被顺带规范化——这是除删除之外唯一可见的改动，备份可以覆盖它。被删空的 patch 条目会整条离开文档；`- id: <group>` 这种带其它配置的写法保留其余键，只丢掉 `insert` 列表。
- 写入前先校验：结果会重新解析，必须不含任何 seam 行，并且必须与「用纯解析数据独立算出的同样删除」深度相等。任何不一致都会中止，文件原样不动。
- 改动前的内容先写到 `<patch>.bak-lsp-seam-<timestamp>`，两次写入都走 harness 的 `writeFileAtomic`。时间戳不含冒号，所有路径都来自 `node:path`，因此 macOS、Linux、Windows 行为一致。
- profile 的依赖刻意不动。删依赖意味着跑 pnpm，而一个插件不该对装载自己的 profile 启动包管理器。这些依赖只做汇报。

即使多个 profile 都有这层，面板的动作也是逐个处理的：只迁移它点名的那个，其余只列出、不一并扫掉。确认信息带上备份路径，改动因此可回退；面板同时说明是否需要重启——`patchReload` 为 `live` 的 profile 自行卸载该层，否则需要重启宿主。

## Alternatives considered

- **让位给 profile 已注册的 seam。** 否决：profile 里钉的版本是当时那份旧文档给的（触发这次问题的机器上是 0.1.2-rc.1），让位就等于一边跑旧服务、一边由本包的 stdio provider 挂载，而 manifest 声明的是当前基线。按版本决定是否让位需要拿到已注册服务的版本，cordis 并不暴露；而且这道闸门几乎帮不到人——照旧说明做过的用户，正是停在旧 pin 上的那批。
- **改为跨两个版本废弃**（这一版警告、下一版报错）。否决：等于先带着坏状态发一个版本且没有修复路径，再把它变得更糟。这个冲突是本次改动引入的，就该由本次改动带上修复。
- **启动时自动改写 profile 的 `cordis.patch.yml`**。否决：在用户的 Harness home 里静默改文件，而且是插件并不能确定名字的 profile，正是那种本该需要一次点击的副作用。横幅就是那次点击。
- **顺手删掉过期的 profile 依赖。** 否决：那需要 pnpm，而插件无法知道该 profile 的锁文件状态。删掉行就够了——没有行的依赖不注册任何东西。
- **用插件自己的 bundle patch 干掉这一层。** 否决：从结构上就不可能，[self-provisioned LSP capability](../../architecture/2026-09-11-self-provisioned-lsp-capability.md) 那篇已记录过原因。bundle patch 先应用，它写的 `disabled:` 会被 profile 更晚的那层覆盖。

## Consequences

- 升级用户一次点击就能拿回语言服务器，且有备份、有写入前校验，不必去 Harness home 里手改 YAML。
- 插件现在会读自己存储之外的文件（`$DSH_HOME/profiles`），此前只读 `settings.yaml`。这些读取都是 best-effort，写入只在被请求时发生，且只写一个文件。
- 扫描只在冲突被上报时运行，不是每次状态轮询都跑，所以健康的 profile 不为此付出代价。
- patch 文件解析失败的 profile 会被跳过而不上报，因此 profile 本身坏掉的用户拿到的是通用冲突文案，而不是迁移入口。
- `dsh-lsp-stdio` 刻意不在删除集合内：它不发布服务，配置行不可能冲突，就留在用户放的位置。
