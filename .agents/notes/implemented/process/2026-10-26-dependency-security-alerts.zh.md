# Agent Note: 提升每个告警的传递依赖，并接受 zod 告警

Status: implemented

## Problem

Dependabot 针对 `pnpm-lock.yaml` 报告了十条未处理告警。它们分布在四个包上：`undici`（一条 high、两条 medium，`8.12.2` 修复）、`fast-uri`（两条 medium、两条 low，`3.1.9` 修复）、`body-parser`（high，`2.4.0` 修复）、`@modelcontextprotocol/client`（medium，`2.3.0` 修复）。第五个 `zod`（high，`4.6.6` 修复）在本仓库根本无法修：宿主系列精确锁定它。

每个包需要不同的答案，因为本仓库不拥有其中任何一个。能不能修，取决于父包声明了什么。

## Decision

每个传递依赖都用其父包允许的最省事机制升级。

| 包                             | 从       | 到           | 方式           |
| ------------------------------ | -------- | ------------ | -------------- |
| `fast-uri`                     | `3.1.8`  | `3.1.9`      | `pnpm update`  |
| `body-parser`                  | `2.3.0`  | `2.4.0`      | `pnpm update`  |
| `undici`                       | `8.11.2` | `8.12.2`     | `overrides`    |
| `@modelcontextprotocol/client` | `2.2.0`  | `2.3.0`      | `overrides`    |
| `zod`                          | `4.4.3`  | 接受 `4.4.3` | 本仓库无法修复 |

**两条 `pnpm update` 是范围修复。** `ajv@8.20.0` 声明 `fast-uri: ^3.0.1`，`express@5.3.0` 声明 `body-parser: ^2.3.0`，两个范围本就接受修复版本。定向 `pnpm update` 只移动了这两个包。

**两条 `overrides` 是精确锁定修复。** 它们的唯一父包是宿主包，且精确声明版本，既没有范围可放宽，也没有 update 能触达。`npm view` 实测：

```
@deepseek-ai/dsh-http-proxy@0.2.1-rc.2  { undici: "8.11.2" }
@deepseek-ai/dsh-mcp-client@0.2.1-rc.2  { "@modelcontextprotocol/client": "2.2.0" }
@deepseek-ai/dsh-http-proxy@0.2.1-rc.3  { undici: "8.11.2" }
@deepseek-ai/dsh-mcp-client@0.2.1-rc.3  { "@modelcontextprotocol/client": "2.2.0" }
```

两条线给出相同答案，因此 overrides 在对齐改动之后依然必要，不是陈旧基线的妥协。`undici` override 还把依赖图收敛为一份，因为 `jsdom` 本就解析到 `8.12.2`。

**`zod` 是已接受风险，记录在 [`.github/SECURITY.md`](../../../../.github/SECURITY.md)。** 宿主系列精确声明 zod `4.4.3`。2026-10-26 用 `npm view <package>@0.2.1-rc.3 dependencies.zod` 实测，六个宿主包都报告 `4.4.3`：`@deepseek-ai/dsh-agent-loop`、`@deepseek-ai/dsh-llm`、`@deepseek-ai/dsh-subagent`、`@deepseek-ai/dsh-session-projection`、`@deepseek-ai/dsh-client-ui-plugin-manager`、`@deepseek-ai/dsh-experimental-agent-team`。`4.4.3` override 存在的原因是插件 schema 会进入宿主的 `ProjectionDefinition`，第二份副本会让宿主的 `ZodType` 变成名义类型，插件 schema 不再匹配。把它提到 `4.6.6` 会破坏该匹配。关闭告警需要宿主发布新版本移动整个系列，而不是在本仓库改动。

**这些修复不会交付给使用者。** pnpm 从 `pnpm-workspace.yaml` 读取 `overrides`，而该文件不在 `package.json` 的 `files` 列表中，因此 `npm pack` 不会把它打进 tarball，发布产物不携带任何 override。使用方 profile 从 npm 解析 `@deepseek-ai/dsh-mcp-client`，该包在 `0.2.1-rc.3` 线上仍精确声明 `@modelcontextprotocol/client` `2.2.0`。这四项修复属于仓库卫生与供应链姿态，改变的是本仓库安装与测试的内容，不是使用者运行的内容。

## Alternatives considered

- **四个包全用 override。** 已拒绝：override 会永久钉住版本，而四个父包中有三个声明了真实范围。`fast-uri` 与 `body-parser` 会因此背上父包本已提供的维护工作，下一次 `ajv` 或 `express` minor 会与 pin 静默冲突。
- **只 override `undici`，把 `@modelcontextprotocol/client` 留给宿主修。** 已拒绝：它关闭 high 却留下 medium，而同一个一行机制能同时关闭两者。`2.2.0` 升到 `2.3.0` 是 minor，其自身 manifest 仍写 `zod: ^4.2.0`，因此现有 `zod` override 依旧支配它，宿主的单副本规则得以保留。
- **等 `0.2.1-rc.3` 修掉 `undici` 与 MCP client。** 依据实测拒绝：`rc.3` 保留了两个精确 pin。等待只会让四条告警无限期挂着。
- **把 `@modelcontextprotocol/client` 钉到 `2.4.0` 而不是 `2.3.0`。** 未采用：`2.3.0` 是解除告警的最低版本，也是 `dsh-mcp-client` 最早对齐的版本。取最小值让 override 更站得住。
- **把 `zod` override 提到 `4.6.6` 并接受第二份副本。** 已拒绝：这正是该 override 要防的失败。宿主的名义 `ZodType` 会在运行时停止匹配插件 schema，而这个破坏没有任何告警来提醒。
- **不记录 `zod`，让下一个机器人 PR 直接升它。** 已拒绝：未记录的有意保留看起来就是陈旧。后来的读者会升级它、破坏宿主契约，并且无从看出当初为何选这个值。

## Consequences

- 五个包中有四个解除告警。三条 `undici`、四条 `fast-uri`、一条 `body-parser`、一条 `@modelcontextprotocol/client` 告警随本次改动关闭。
- `zod` high 告警按设计保持开启。`.github/SECURITY.md` 写明它已被接受以及什么能关闭它，后来者不会把它当作疏漏。
- 两条新 override 带来维护成本。每条都点名逼出它的父包以及测量时的父包版本，宿主提高自身 pin 时即可移除。
- `undici` 依赖图现在只有一份而非两份，安装中少了一个重复的 `EnvHttpProxyAgent` 模块实例。
- 本次改动不触碰任何宿主 pin，且 `check-host-alignment` 在其上通过。`0.2.1-rc.3` 基线来自单独的基线对齐改动，不来自本次改动。

## Forward risk: the MCP client redirect default

`@modelcontextprotocol/client` `2.3.0` 为两个 HTTP 传输新增 `redirectPolicy`，默认值为 `'same-origin'`。`2.2.0` 没有该选项，重定向交给 fetch。`dsh-mcp-client` 不传该选项，因此继承新默认值。

导入接口没有漂移。解包两个 tarball 可见相同的 402 个导出、逐字节一致的 `declare class Client` 块、未变的 `StdioClientTransport`。失效来自默认值变更，不是 API 破坏。

该风险是实测的，不是假设。2026-10-26 探测，owner 自己的服务 `https://kuboard.dev.kapukapu.cn/mcp` 返回 `301`，`location: https://kuboard.platform.zealwon.com/mcp`，属于跨源重定向。两个本地服务复现了后果。端口 A 对端口 B 返回 `307`，`2.2.0` 把请求送达目标并正常返回，而 `2.3.0` 没有向目标发出任何请求，抛出 `Error POSTing to endpoint: Redirect to ... not followed; use that URL as the endpoint if it is the intended server (redirectPolicy: 'same-origin')`。

当宿主系列把 `dsh-mcp-client` 移到 `@modelcontextprotocol/client` `2.3.0` 或更晚时，该服务将无法连接。失效落在宿主上，不在本仓库。连接失败会走插件的重试策略，再走注销路径，重定向文本随消息一起出现。

修复是在 `dsh-mcp-client` 中加一行：给传输传 `redirectPolicy: 'follow'`。那是宿主改动。本仓库不为此添加变通方案，也不从这里开宿主 issue。本记录就是凭据。
