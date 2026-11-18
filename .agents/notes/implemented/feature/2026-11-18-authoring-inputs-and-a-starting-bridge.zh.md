# Agent Note: 保存时修复输入，启动中的桥接如实说明

Status: implemented

## Problem

为两份根 README 录制演示时，三个界面第一次呈现在一个没用过它们的读者面前，而每一处都在让这个读者替面板已经知道的事实付账。

技能面板新建的草稿里只有描述和正文。宿主读取器要求 `name` 与 `description`，`skillEntryRejection` 镜像它，因此新建后原样保存的技能会显示为已停用、开关锁住。名字就在表单自己的名称字段里，只是没有写进文档。

连接器表单把命令字段里输入的内容原样存下。每个 MCP 服务的 README 都写成一行——`npx -y @modelcontextprotocol/server-filesystem .`——而 stdio 定义把程序与参数分开存放，于是挂载把整行当成程序名去执行，报出找不到命令。

切换一个工具会重写挂载配置，因为工具过滤是桥接挂载时的一部分。开关在 1 秒预算后应答，弹窗随即重读状态，这次读取正好落在拆卸与握手之间。于是这一行报出 `degraded`——那是面板给“需要修复的服务”的词——而它服务的对象刚才还在工作，片刻之后又会正常。

## Decision

- **面板里新建的技能把名称字段当成自己的 `name`。** `packages/market-catalog/src/scanning/skills-parse.ts` 里的 `withSkillName` 在 frontmatter 没有声明 name 时把该键插到开头 `---` 之后，给只有正文的文档补上缺失的区块，而在已声明 name 或 frontmatter 无法解析时原样返回文本。技能存储通过新增的 `prepareCreate` 选项调用它，因此新建时修复，编辑时永不改写用户自己写的文档。
- **命令行在存储时拆开。** `packages/market-mcp/src/application/mcp/mcp-command-line.ts` 里的 `withSplitCommand` 按引号与空白切分，把程序之后的部分移入 `args`，并接在定义已经声明的参数之后。`prepareUserMcpServer` 与 `saveServerConfig` 都调用它，因此表单、JSON 视图和其它工具写下的声明最后都落在拆分后的定义上。含空格的裸路径保持整条：把 `C:\Program Files\app.exe` 在第一个空格处切开，只会破坏一个本来可用的服务。
- **启动中的桥接有自己的状态。** `McpStatusState` 新增 `connecting`，由监督器自己的 `connecting` 相位映射而来。该行不带重试代码，`retryable` 为 false，面板也不提供恢复操作，因为此时还没有失败。`mcpRuntimeState` 把这个词映射成预设管理器与扩展清单渲染用的共享状态 `starting`，行标签是 连接中 / Connecting。面板原有的等待读取本来就会重读连接中的行，因此握手完成时这一行自行恢复。

## Alternatives considered

- **让切换工具等待它触发的重新挂载。** 实现后又撤回，予以否决：`switchSettleMs` 是一条有文档的契约——开关最多等它的预算就应答（`docs/user/resources.md`、`docs/user/sources.md`）——而启动卡住的服务会把开关拖到更长的那段预算上，而这正是该预算要划定的情形。
- **给运行中的桥接重新过滤，而不是重新挂载。** 现阶段否决：过滤作为挂载配置抵达桥接，而 `MountPluginHandle` 只暴露 `await` 与 `dispose`。在运行中更新过滤需要一条尚不存在的桥接接缝。
- **只在失焦时拆分命令字段。** 不够，予以否决：粘贴后直接点保存，以及在 JSON 视图里的每次编辑，都不会让该字段失焦。拆分放在存储定义的地方，两种视图都覆盖。
- **把启动中的桥接报成 `connected`。** 否决：首次握手仍可能失败，而一个先绿后红的行比一个说明自己正在启动的行更糟。
- **编辑时也补 `name`。** 否决：编辑面对的是用户自己的文档。把他们删掉的键补回去，会掩盖卡片已经点名的错误，而面板保持文档原样。
- **把既是普通单词的名字也翻译掉。** 不作为缺陷处理，予以否决：翻译界面不动标识符，`caveman` 是在把它当普通名词使用的英文句子里被翻译的，对该句而言这正是正确输出。

## Consequences

- 新建技能只需要描述；文档会得到卡片上显示的那个 `name`。
- 粘进表单或写进 JSON 的命令行都会以拆分形式存储，读者打开的配置文件里程序与参数各占一个字段。含空格的路径仍是一个字段，也是这处修复唯一没有覆盖的情形。
- 启动中或重启中的服务在整个握手期间显示 连接中 而不是 降级；工具全部被拒绝的服务显示 已连接，因为一个没有暴露任何工具的活挂载是受支持的配置，而不是失败。
- `McpStatusState` 多了一个成员。所有对它做分支的消费者都必须处理 `connecting`；两个组装根上的类型检查会强制这一点。

## Testing

`packages/market-catalog/test/skills-parse.test.ts` 覆盖名称修复：草稿、已声明名称、CRLF frontmatter、只有正文的文档、空区块、无法读取的 YAML，以及不符合语法的名称。`packages/market-runtime/test/user-panels.test.ts` 用编辑器自己的草稿新建技能并断言写出的文件，断言命令保持原文，断言编辑不会给删掉 name 的文档补回该键。`packages/market-mcp/test/mcp-command-line.test.ts` 覆盖拆分与它的拒绝情形；`packages/market-bundle/test/integration/mcp-direct-config.test.ts` 断言 `addUserMcpServer` 写出的文件携带拆分后的定义。`packages/market-bundle/test/integration/mcp-status.test.ts` 钉住两点：`connecting` 观察是对独立的状态且没有可重试的东西；一个所有工具都被拒绝的活挂载读作已连接。

`pnpm run check:quick` 与 `pnpm run format:check` 通过，`market-mcp` 与 `market-ui` 两套测试通过（65 个文件、452 个测试）。
