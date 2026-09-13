# Agent Note: 路径包含性依据路径关系而非文本前缀

Status: implemented

## Problem

`isWithin(root, candidate)` 是 marketplace 条目解析、声明式组件路径、归档解包以及插件资源文件写入守卫背后的包含性判定。它比较的是字符串：候选路径以"根路径 + 宿主分隔符"开头就算在内部。

这个答案只有在两侧用同一套书写约定时才成立，而 Windows 上并非如此。checkout 路径有两条来源：基于 `join()` 的助手（如 `sourceCheckoutDir()`）产出反斜杠；本地来源则走 `expandHome(source.url)`，原样返回配置文本（`C:/Users/x/marketplace` 是绝对路径，来源路由会接受）。随后 `resolve()` 把条目自身的相对路径规范成反斜杠，于是 `C:\Users\x\marketplace\plugins\typescript-lsp` 永远不以 `C:/Users/x/marketplace\` 开头，每一个本地 marketplace 条目都被判为 `path "…" escapes the checkout`。这正是 0.6.2 上的 issue #50：官方那些无 manifest 的 LSP 插件是"声明即插件"，容器兜底扫描救不回来，12 个全部从目录中消失。

同一种书写依赖也会向反方向出错：带未规范化 `..` 的候选路径能通过前缀检查，而大小写不同的合法根路径却不能。

## Decision

包含性判定改问平台自己的路径规则：候选路径是否就是根路径或它下面的某个位置：

```ts
const rel = flavor.relative(root, candidate)
return rel === '' || (!rel.startsWith(`..${flavor.sep}`) && rel !== '..' && !flavor.isAbsolute(rel))
```

`relative` 先按平台规则解析两侧再比较，因此 `C:/x/y` 的 checkout 与 `C:\x\y\plugins\a` 的条目能对上，Windows 上盘符与路径段按大小写不敏感比较，候选路径里的 `..` 会被解析而不是当成文本相信。生产代码调用绑定宿主 `node:path` 的 `isWithin`；`isWithinUnder` 接收 flavor，使 win32 规则在 POSIX 上也能被测试覆盖。

同一规则的两份手写副本一并删除。`storage-migration.ts` 自己长出了一个 `contains()`，把 win32 分支内联在里面；`panel-resources.ts` 判断 `rel.startsWith('../')`，而 Windows 上 `relative()` 返回的是 `..\`，永不匹配——用户根目录之外的资源可能被当作根内文件改写。

折叠分隔符只解决了"哪段文本算路径"；`realpath` 仍是符号链接逃逸的守卫，因此 `claimLocal` 与 `componentPath` 依旧解析两侧后再次判定。

## Consequences

Windows 上本地 marketplace 条目与 POSIX 一样能解析成功，这正是那些无 manifest 的 LSP 插件可以在 Windows 上安装的原因。

对仍带 `..` 的候选路径，新规则比前缀检查更严（`/a/b/../c` 对 `/a/b` 过去通过，现在不通过）。所有调用点都会先规范化操作数，因此这是纵深防御而非行为变化，而且失败方向正是包含性守卫应有的方向。

## Alternatives considered

**在调用方折叠分隔符。** 报告人的补丁把两侧用 `split('\\').join('/')` 归一。反斜杠只在把它当分隔符的平台上才是分隔符；在 POSIX 上它是普通的文件名字符，折叠会让 `/a/b\c` 被判为在 `/a/b` 之内，而它其实是该目录的兄弟项。`relative` 拿到了 Windows 那份收益，却没有凭空制造 POSIX 上的包含关系。

**采用宿主的文件系统身份回退。** `dsh-fs-sandbox` 的 `isPathUnder` 保留词法快路径，并在书写不一致时沿候选路径的既有祖先比较 `dev`/`ino` 身份，同时覆盖 Windows 8.3 别名与大小写差异。这里没有采用：我们的输入不会出现 8.3 别名（checkout 来自 `join`/`resolve`/`realpath`，或来自用户输入普通路径），而它会把一个用在八个调用点的同步判定变成异步且带 I/O。若将来出现带别名的输入，它仍是正确工具。

**把包含性判定接到 `ctx.fs` 上。** 宿主把包含性放在文件系统 provider 上——`contains(parent, child)`，两个操作数都是 `resolve()` 产出的不透明 target——消费者因此无需解析路径。但扫描需要 `readdir`、递归遍历、git 与归档解包，这些按设计都不在 provider 契约里（它的定位是有界文本 I/O 加原子变更）；而 `src/catalog/` 刻意不依赖宿主上下文，才能保持为纯粹、快速的测试目标。

## Testing

`tests/paths.test.ts` 用 `path.posix` 与 `path.win32` 两套规则驱动 `isWithinUnder`。其中第一行 win32 用例就是报告的形状——根 `C:/Users/x/marketplace`、候选 `C:\Users\x\marketplace\plugins\typescript-lsp`——前缀规则给的是 `false`。`tests/scan-pipeline.test.ts` 通过真实的条目处理器补上同一形状：用正斜杠书写的 checkout（POSIX 上是空操作，Windows 上正是混用书写）仍须把 `./skills/one` 解析为 local。

`.github/workflows/windows.yml` 在 `windows-latest` 上跑整套测试，那里宿主绑定的是 win32 路径函数。回归的端到端覆盖由既有 fixture 承担：`cc-marketplace` 声明了四个字符串路径条目与一个内联 `lspServers` 条目，在旧规则下 Windows 运行只能解析出远程条目与容器兜底那一个。
