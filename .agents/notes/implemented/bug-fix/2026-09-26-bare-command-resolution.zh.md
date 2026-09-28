# Agent Note: 裸命令按用户的登录 shell 解析

Status: implemented

## Problem

市场套件按可移植写法声明 stdio MCP 服务——`npx --prefix ${PLUGIN_DATA} chrome-devtools-mcp@1.10.1`、`uvx …`——LSP 声明同样用裸名（`typescript-language-server`、`pyright-langserver`）。这些名字都必须靠进程的 `PATH` 解析。

桌面版从访达/Dock 启动，Host 的 `PATH` 来自 launchd：`/usr/bin:/bin:/usr/sbin:/sbin`，用户工具链所在的目录（Homebrew、`~/.local/bin`、pnpm、bun、cargo）一个都不在里面。桌面包只带 node shim 与 pnpm、不含 npm/npx；`.env` 层拒绝 `PATH`（`BOOTSTRAP_NAMES`）；也没有任何设置项暴露它。结果是最普通的套件都以 `spawn npx ENOENT` 挂载失败；本机缓存的 6 条 stdio 声明全部是裸名。

宿主没有覆盖这件事：`dsh-mcp-client` 把 `command` 原样交给 MCP SDK——不解析、不碰 `PATH`、没有 `ENOENT` 专用措辞，它自己的 README 示例就是裸 `npx`；桌面版 README 明确写着 `runtime/bin` 只加给安装进程。`dsh-lsp-stdio` 会预解析，但解析范围仍是同一份短 `PATH`，所以它把"找不到"报得很清楚，却依然挂不上去。宿主自带的 MCP 靠 `process.execPath` 加 `import.meta.resolve` 把自己的包解析成绝对入口来绕开，这条路对第三方套件声明的 `npx <包>` 不适用。

## Decision

- **`src/runtime/host/shell-path.ts` 只问用户的登录 shell 一次。** `/bin/zsh -ilc` 先打印一行标记、再打印 `$PATH`；模块只解析标记之后的内容，按顺序保留绝对路径并去重。探针仅 `darwin` 生效、惰性启动、缓存的是一整个 promise（并发首调共享同一次探测）、上限三秒。`-i` 是必需的：Homebrew 的 `shellenv` 写在 `.zshrc` 里，登录但非交互的 `zsh -lc` 读不到。
- **解析是外科式的。** `resolveDeclaredCommand` 先用宿主自己的 `ctx.subprocess.resolveExecutable`，拿 spawn 将要继承的环境解析一次；只有真正的 `SubprocessExecutableNotFoundError` 才走额外一步——把登录 shell 的目录**追加**到当前 `PATH` 之后（绝不前插，因此不改变任何既有优先级）——再解析一次。
- **绝不改写声明。** 裸名仍是命令，只有子进程的 `PATH` 变长。套件或用户显式声明的 `env.PATH` 原样保留，连探针都不会触发。
- **每种结果都留下事实。** 发生扩展时报告 `PATH extended from the login shell: <目录>`；追加后仍找不到时报告命令名与最终搜索的 `PATH`；探针给不出可用 `PATH` 时如实说明。不会静默失败，失败一律回落到今天的环境。
- **两个消费点。** MCP 桥接层在 `apply` 里解析（`buildChildEnv` 是同步的且拿不到 ctx），把扩展写进 `config.env.PATH`，而传输层本来就把这份 env 最后合并；LSP 注册表在把配置交给 `dsh-lsp-stdio` 之前逐个解析套件与自建 server，仅在 server 未声明 `PATH` 时注入 `env.PATH`。

## Alternatives considered

- **静态候选目录清单**（`/opt/homebrew/bin`、`/usr/local/bin`、`~/.local/bin`…）。拒绝：那是在猜用户用的是哪套工具链，而这台机器正好说明为什么不行——它的 `/usr/local/bin/npx` 是 2023 年那次安装留下的断链。登录 shell 才是用户对自己工具位置的说法。
- **把声明的命令改写成绝对路径。** 拒绝：那改动了套件或用户写下的内容，而且单靠它并不成立——Homebrew 的 `npx` 开头是 `#!/usr/bin/env node`，`PATH` 里没有 `node` 时绝对路径照样失败（实测退出码 127）。
- **让所有 stdio 启动都经登录 shell。** 拒绝：那会在每次挂载时付出探针开销与 profile 噪音，并改变今天能正常解析的服务所处的环境。
- **只等宿主修。** 拒绝把它当作唯一答案：桌面版 README 把短 `PATH` 当设计，用户会一直卡着。缺口改为写成上游提案，而插件在未来宿主补上该能力后依然可用。
- **每次 reconcile 都探一次。** 拒绝：同一个 Host 进程内 shell 环境不会变，缓存探针让包含注入 `PATH` 的 LSP fingerprint 保持稳定，不会反复重挂。

## Consequences

- 找不到的裸命令每个 Host 进程只多付一次约 200ms 的 shell 探测；健康环境不付，因为探针只在真正的查找失败之后才跑。
- 绝对路径这个边角仍在：像 `/opt/homebrew/bin/npx` 这样的声明会被判定为"文件存在"，因此不触发探测，而它的 `#!/usr/bin/env node` shebang 仍需要 `PATH` 里有 `node`。那是另一种失败、有自己的信息，且当前目录里没有任何套件声明绝对路径。
- 扩展成功的事实进插件日志而不进状态行：已挂载的行没有可承载备注的 wire 字段，本次改动不触碰 contracts。

## Verification

- `tests/shell-path.test.ts`（21 例）钉住标记解析、前置噪音、相对项过滤、去重、只探一次、非 darwin no-op、超时、shell 缺失，以及 `resolveDeclaredCommand` 的每个分支——基础解析、追加后重试、追加后仍失败、探针失败、显式 `PATH`、缺少 seam、非查找类错误。
- `tests/mcp-bridge.test.ts` 与 `tests/lsp-mounts.test.ts` 新增 10 例：健康环境的 `PATH` 逐字节不变、扩展进入挂载 env 与日志、显式 `PATH` 原样透传、失败事实进入 cause 链、非 stdio 传输不做解析。
- 在宿主自身的短 `PATH` 下实测探针：194ms、30 项、含 `/opt/homebrew/bin`，按序追加 26 个目录。
- 用解析器自己的输出真启动：`npx --prefix … chrome-devtools-mcp@1.10.1` 成功启动（status 0，npm 报出运行信息），而同一命令配宿主 `PATH` 则是 `ENOENT`。
- 全部门禁通过：typecheck、eslint、prettier、dependency-cruiser，以及 98 文件 / 881 用例。
