# Agent Note: 命令正文展开自己声明的参数

Status: implemented

## Problem

市场套件会带 Claude Code 命令，其 frontmatter 声明具名参数：

```markdown
---
description: Security scan of the legacy system with a reviewable remediation patch
argument-hint: <system> [--show-secrets]
arguments: system
---

Run a **security hardening pass** on `legacy/$system` ...
```

已发布的 `code-modernization` 套件在全部 13 个命令里都声明了参数，单是 `$system` 就出现 246 次。其中 8 个命令的正文完全没有 `$ARGUMENTS`。

挂载处理器只替换了一种写法，即 `.replaceAll('$ARGUMENTS', invocation.rawInput.trim())`。所有具名占位符都以字面量到达模型。没有 `$ARGUMENTS` 的正文彻底丢掉用户输入，于是 `/modernize-harden payment-service` 带着字面量 `$system` 到达，却没有 `payment-service`。issue #125 与 #127 报告同一个缺陷，#127 是重复条目。

缺陷不是某个套件缺功能。Claude Code 在模型读取之前用调用文本填好命令正文，任何为该方言写的套件都会保留这种写法。

## Decision

`packages/market-runtime/src/application/command-arguments.ts` 用一个纯函数完成展开，输入是作者正文、调用文本与声明的名字。挂载处理器在插件路径变量展开之后、动态上下文执行之前调用它。

`parseCommandResource` 按作者顺序把声明记到 `CommandSpec.args` 上。它接受已发布套件写的那一个空格或逗号分隔的字符串，也接受 YAML 列表，因为两种写法都真实存在。不能当占位符用的名字、重复的名字、非字符串条目，都通过同时报告被拒命令文件的 `onIssue` 出口报告，其余名字照常绑定。

`expandCommandArguments` 对正文做一趟扫描，只认三种写法：

- `$ARGUMENTS` 是整段去掉首尾空白的调用文本，与之前一致。
- `$1` 到 `$9` 按位置各取一个参数。
- `$name` 取该名字在声明里的位置对应的参数。

其余所有美元序列保持字面量，因此 `$HOME`、`${CLAUDE_PLUGIN_ROOT}`、`$?` 以及仅仅以美元符号开头的文本都按作者写的到达模型。替换进去的值不会被再次扫描，所以本身含 `$system` 的参数就是那段文本。

调用文本按 Claude Code 的方式切分：以空白分隔，单引号或双引号包住的短语算一个参数并去掉引号。没有转义语法，未闭合的引号一直延伸到文本结尾。

正文用到、而文本没有填的参数展开为空，命令的确认行会点名它：`/modernize-uplift did not receive these declared arguments, left empty: $target_version`。这句话是一对宿主 locale 键，跟随界面语言。

展开为空而不是拒绝，是该方言本身的行为，也是唯一能让已发布命令继续工作的做法。Claude Code 把缺失参数渲染成空字符串，而带尾部参数的正文正是按这个"空"来分支。`code-modernization/commands/modernize-brief.md` 读 `$target_stack`，为空时取 `analysis/$system/INTENT.md` 里的那个，否则按评估推荐一个。`code-modernization/commands/modernize-transform.md` 写的是 `If $module or $target_stack is empty` 时先把后面的内容读完再动手。改成拒绝调用，等于用一个作者从未考虑过的失败，替换掉他们写过也测过的分支。

完全不含占位符的正文，会在一个空行之后收到文本，渲染为 `User input: <text>`。用户输入的任何内容都不会被丢掉。

占位符在代码围栏内与其它地方一样展开。声明参数的套件也把这些参数写在模型要执行的 shell 片段里，按围栏区分会让同一段作者文本因位置不同而行为不同，且没有说得出收益。

## Alternatives considered

**声明参数没有值时拒绝整次调用。** 拒绝是 fail-closed 的，也是"绝不产生空字符串"最严格的解读。代价是把作者写好的命令弄坏：三个已发布命令都写明尾部参数为空时该怎么做，而拒绝让那条分支永远跑不到。

**没有值时保留字面占位符。** 这正是被报告的缺陷。模型会对着一个指不到任何东西的记号推理，而正文自己的"if blank"分支永远跑不到，因为这个记号并不为空。

**把空缺报告成 reconcile 诊断，与被拒命令文件并列。** reconcile 诊断描述文件，每次 reconcile 出现一次。空缺是某一次调用的属性，因此它属于对输入该命令的人的回复，而那也正是已经用来报告命令拒绝运行的界面。

**附上文本时不加标签。** 光秃秃的文本读起来像作者最后一段的延续。一行标签告诉模型作者正文在哪里结束，渲染也便于测试。

**跳过代码围栏里的替换。** 按围栏区分会让作者自己的脚本片段保留字面量 `$system`，而周围的散文被填好，比统一规则更糟。已发布套件依赖统一规则。

**给字面量 `$name` 增加转义。** 目前没有套件需要。转义是对该方言的扩展，而正文必须保持字面量的名字，作者可以改名。

**让自建命令面板共用这次展开。** 面板从工作区存储里读自己的 frontmatter，并自行替换 `$ARGUMENTS`。扩展它是同一方言、同一修法，留作独立改动，好让这次改动保持一个界面一个读取器。

## Testing

`packages/market-runtime/test/command-arguments.test.ts` 覆盖切分（空白、带引号短语、空的带引号参数、未闭合引号）与展开（按位置的具名绑定、带引号的值、缺失名字及其报告、`$ARGUMENTS`、`$1` 到 `$N`、未知美元序列、不重复扫描、追加文本、空调用与代码围栏）。

`packages/market-runtime/test/command-resources.test.ts` 覆盖声明读取：空格分隔字符串、逗号分隔字符串、YAML 列表、没有声明、不可用名字且其余照常绑定、重复名字、既不是字符串也不是列表的值。

`packages/market-bundle/test/integration/commands-mounts.test.ts` 用 `packages/market-bundle/test/integration/fixtures/code-modernization-commands` 驱动挂载注册表，那是两个已发布命令的裁剪副本，frontmatter 未改动。它检查 `/modernize-harden payment-service` 带着 `payment-service` 且不含 `$system` 到达模型、两个声明名字带引号短语的绑定、没有声明时位置占位符的展开、缺失名字被确认行点名、无占位符正文收到 `User input: <text>`，以及 `$ARGUMENTS` 与声明名字并存时仍是整段文本。

## Consequences

套件命令现在把用户的话放进作者标记的位置。13 个 `code-modernization` 命令绑定自己的声明名字，作者漏标占位符的命令仍然在末尾收到文本。

缺失参数展开为空是有意的权衡。它让已发布命令按自己写明的"if blank"行为工作，确认行点名缺了什么。希望模型看到硬性停止的读者不会得到。

自建命令面板仍然只替换 `$ARGUMENTS`。那里的同样写法仍以字面占位符结束，上面记为延后的改动会用同一个函数补上。

注册指纹包含声明，因此改 `arguments` 会在下一趟重新挂载命令，与改其它 frontmatter 字段一致。

## Related

这扩展了[套件文本里的路径变量与动态上下文](../bug-fix/2026-09-14-suite-text-paths-and-dynamic-context.md)建立的占位符面，并保持那份笔记的解析顺序：先插件路径变量，再调用占位符，最后 `!`command`` 动态上下文。本笔记借助的拒绝报告，用于畸形声明，是 [#126](https://github.com/Sivan757/dsh-agent-plugins-market/issues/126) 关闭的那一条。
