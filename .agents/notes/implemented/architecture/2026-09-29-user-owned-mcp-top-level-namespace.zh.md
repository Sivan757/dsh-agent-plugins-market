# Agent Note: The user's own MCP declarations own the top-level namespace

Status: implemented

## Problem

用户在 `~/.agents/mcp.json` 里声明的服务，到模型面前变成了 `mcp__user-mcp__kuboard__list_clusters`。承载这份声明的是一条合成套件——来源 `@user-mcp`、id `user-mcp`——而 `deriveServerName` 把它当成普通套件加了命名空间：`mcp__<suiteId>__<serverKey>__<tool>`。

这个名字说错了这份声明的身份。文件是用户自己写的，不是包；它也正是其它 MCP 客户端读取的同一份文档，那些客户端把这个服务挂成 `kuboard`——于是一个服务按连接它的客户端不同而有两个名字。合成套件的 id 还进了状态面板的服务行和 OAuth 授权记录键（`mcp-auth/user-mcp-kuboard`），把一条属于该服务的记录改挂到了一个并不存在的套件名下。

## Decision

**包的服务按套件加命名空间；用户自己声明文件里的服务不加。** `deriveServerName(suite, serverKey)` 改为接收套件：`@user-mcp`/`user-mcp` 只返回 `sanitizeToken(serverKey)`，其余一律返回 `${suiteId}__${serverKey}`。名字仍做字符净化，仍按 bridge 的 32 字符预算用同一个确定性 hash 后缀截断——写入路径允许用户键最长 64 字符。

`mcp-direct-config.ts` 的 `isUserMcpSuite` 是「这条套件是本地数据、不是包」的唯一判据，派生函数是它唯一的读取方。挂载请求构造（`mcp-config.ts`）与状态构造（`mcp-status.ts`）都经它派生，因此面板打印的就是模型看到的名字，`mcp__<serverKey>__` 下观测到的工具也归到声明它们的行上。

服务详情在挂载名与服务键相同时不再显示挂载名一行，用户自建的服务因此只读到一个身份，而不是同一个字符串写两遍。

## Alternatives considered

**给用户声明也保留套件命名空间。** 所有挂载一条规则，且一个恰好叫 `user-mcp` 的包套件不会撞上用户自己文件想要的名字。否决：命名空间的作用是把两个包的服务分开，而用户的文件不是包。把用户的服务冠以一个用户从未写过的套件 id，问题正在这里，不是保障。

**只匹配套件 id。** 让 `deriveServerName('user-mcp', key)` 返回裸键，会把恰好叫 `user-mcp` 的市场套件也当成用户的本地声明。否决：标记本地数据的是来源 `@user-mcp`，而套件 id 在不同来源之间并不唯一。

**由各调用点传 `bare` 标志。** 可以保留派生函数的字符串签名。否决：后来的调用点可能漏传标志、悄悄把前缀带回来；传套件能让这个例外留在拥有它的派生函数里。

## Consequences

- 用户声明的服务，工具名为 `mcp__<serverKey>__<tool>`。正在运行的会话保留它已注册的名字，直到挂载重新对齐或宿主重启。
- 这类服务的 OAuth 授权记录键移到 `mcp-auth/<serverKey>`。旧键下的授权成为孤儿，服务端下一次 401 会重新走一次授权。
- 用户键可能派生出与某条套件服务相同的名字——用户文件里的 `acme__db` 与套件 `acme` 的 `db`。挂载注册表的 `duplicate-mount` 与 `foreign-mount` 守卫来裁决：先挂上的那条占住命名空间，另一行给出诊断而不是影子注册。
- 宿主自行管理的 MCP 客户端若已占用该键，则由它保留，市场报 `foreign-mount`，而不是对同一个服务再开一条连接。

## Testing

- `tests/mcp-config.test.ts` —— 派生：包套件用 `__` 连接，`@user-mcp` 用裸键，另一来源下同名 `user-mcp` 套件不变，64 字符的用户键被截断。
- `tests/mcp-direct-config.test.ts` —— 真实 `mcp.json` 往返产生的挂载，其 `serverName` 就是声明的键。
- `tests/mcp-status.test.ts` —— 用户行显示裸名，并收拢在它下面观测到的工具。
- `tests/client-mcp-detail.test.ts` —— 挂载名只会重复服务键时，该行不出现。

## Related

[One MCP server identity, not one per session](../bug-fix/2026-09-13-mcp-identity-without-session-namespace.md) 定下的是「一个派生名服务所有维度」；本记录定下的是「哪些套件加命名空间」。
