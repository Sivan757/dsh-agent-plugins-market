# Agent Note: 请求信任闸门接受宿主声明的权威名

Status: implemented

## Problem

所有市场路由都挂在同一道请求信任闸门后面（`packages/market-bundle/src/request-trust.ts`），而它的 Host 检查只接受回环主机名。反向代理部署——`dsh web --host 0.0.0.0` 由 Caddy 或 nginx 在公网域名上终止 TLS 并保留入站 `Host`——于是每条市场路由都返回 `403 {"ok":false,"code":"cross-origin"}`（issue #181）：代理送来 `Host: dsh.example.com`，这道闸门永远无法接受它；而在代理侧改写 `Host` 也不行，因为浏览器随带的 `Origin: https://dsh.example.com` 又会挂在 Origin 与 Host 的比对上。宿主自己的 `/api` 闸门（harness checkout 的 `packages/client/connection/src/api-request-trust.ts`）通过 `trustedHosts` 配置与监听器绑定地址接受的正是这类部署，于是插件与挂载它的宿主发生了分歧。扩展窗口路由是每 2.5 秒轮询一次的 GET 读，失败刷满浏览器控制台，从域名访问时整个界面都不可用。

## Decision

Host 检查现在接受与宿主闸门相同的集合：回环（不变）、宿主 connection 服务的 `trustedHosts` 条目、或监听器的绑定地址。条目匹配镜像 harness 的 `isTrustedAuthority`——带端口的 `host:port` 精确匹配该 authority，不带端口的条目匹配任意端口上的主机名，两侧都经 WHATWG 归一化，大小写与 scheme 默认端口从不参与裁决；绑定地址镜像 `isBindAddressAuthority`：按主机名比较、端口不限，先剥掉 `%zone` 接口选择符。`sec-fetch-site: cross-site` 与 Origin 对 Host 的比对不变，决策仍是带显式权威输入的纯函数：`isTrustedMutation(request, authorities)`。

回环判定同样镜像 harness 的分类器：`isLoopbackHostname`（`packages/client/connection/src/loopback-hostname.ts`）接受 `localhost`、`[::1]` 或任意 127/8 IPv4，替换了闸门旧的手写集合——旧集合多带了 `0.0.0.0`，又漏掉 127/8 的其余地址。这次对齐是双向的：宿主闸门放行的 `127.0.0.2` 在这里同样放行；`0.0.0.0` 不再视作回环——绑定在该地址上的监听器经由绑定地址镜像接纳该 Host，与宿主闸门完全一致。

权威名经由挂载显式传递。每个路由挂载本来就持有宿主上下文，于是每处闸门调用传入 `requestTrustAuthoritiesOf(<host ctx>)`——对 `connection`（`trustedHosts`）与 `webServer`（`host`、`protocol`）的结构化读取，按请求解析，与本插件读取其他宿主端口的惰性模式一致，因为服务可能在本插件 apply 之后才落地。两样服务都暴露不出的上下文——旧版 harness、手工构造的测试宿主——得到 undefined，闸门降级为 loopback-only，与从前的行为完全一致。部署方从未声明的名字仍然被拒绝，#156 的 DNS rebinding 防线完好。

### 读取 connection 服务的私有字段

`HostConnectionService` 把 `trustedHosts` 持有为 TypeScript `private` 字段；它不是宿主的已发布表面。插件按结构化类型读取它（`{ trustedHosts?: readonly string[] }`），沿用路由已有的本地结构化类型先例（`webServer` 即如此），不新增对 `@deepseek-ai/dsh-client-connection` 的依赖。这是一条记录在案的偏离：harness 若重命名或改形该字段，闸门会静默降级为 loopback-only——闭闸失败（返回 403），而不是开闸。

运行期变更问题已对照 harness 源码定论：该清单由配置固定。connection 插件在 `apply` 里一次性读取 `config.trustedHosts`，以 `readonly` 字段传入服务构造器，并在构造器里预算 `allowsRemoteAuthorities`——若清单会在运行期变动，这个形状本身就是错的。（issue 里「宿主会在运行期追加 `trustedHosts`」的说法与当前 harness 不符。）按请求读取仍然保留：将来行为变化时闸门依旧正确，代价只是一次廉价的 `ctx.get`。

## Alternatives considered

**复用 connection 服务的 `requestRejection`/`admit`。** 否决：那条路径在闸门之上还叠加宿主的浏览器认证，会把插件路由今天接纳的非浏览器调用方拒成 401，把一次会话行为的改动卷进一次信任修复。

**插件本地的可信主机设置。** 否决：它复制宿主配置并必然漂移——向宿主声明过名字的部署还得向插件再声明一次，两道闸门依旧像从前一样分歧。

**新增宿主侧公开 API 暴露被接受的权威名。** 在此否决：本项目禁止修改宿主，这一改动只能作为 upstream 请求交由 harness 维护者裁量，不是本仓库能发布的东西。

**结构化读取私有的 `trustedHosts` 字段。** 采纳，偏离已如上记录：不修改宿主、不新增依赖，这是消费宿主实时声明的唯一途径，且失败模式是闭闸。

**在 apply 时一次性注册模块级权威名提供方。** 否决，改用显式传递：每个挂载本就持有宿主上下文，传递没有新增任何签名与管道；模块级 `setXxxSource` 式的提供方反而引入被测试实例共享的模块级可变状态，却没有省掉任何接线。

## Deferred

Origin 比对按 plain HTTP 解析两侧、对 scheme 视而不见：携带同一 authority 的 `https` Origin 等于 `http` Host，而宿主闸门会按 Origin 的 scheme 解析 Host。这是被有意逐字节保留的既有行为——报告中的代理部署保留不带端口的 Host，此时两者不可能出现分歧——且评审将差异形态归类为本闸门其余检查下浏览器不可达。将其对齐到宿主按 Origin scheme 的解析，应作为独立的决策另行处理。

## Consequences

代价：插件此后依赖两个未发布的服务形状（`connection.trustedHosts`、`webServer.host`/`protocol`），均为结构化读取，其失败模式是降级为 loopback-only——绝不会变成放行。收益：向宿主声明过名字、或直接拨绑定字面量的部署通过每条市场路由，两道闸门达成一致；未声明任何名字的宿主保持与从前完全一致的 loopback-only。Origin 比对保留其原有的 plain-HTTP 解析，行为逐字节不变；对不带端口的代理 Host（即报告中的部署）它能与 https Origin 相符。

## Testing

`packages/market-bundle/test/integration/request-trust.test.ts` 钉住被接受的集合：受信条目（即报告中的复现行）、任意端口匹配的无端口条目、精确匹配的带端口条目、scheme 默认端口的冗余性、https 监听器上 TLS 默认端口条目的放行（逐行镜像 harness 规格测试）、含 `%zone` 的绑定地址、回环分类器（127/8 放行、`0.0.0.0` 仅经绑定地址路径、近回环名字拒绝）、与 harness 一致的畸形条目解读、未声明名字的拒绝、无权威名时的降级、对受信主机依旧生效的 cross-site 与 Origin 拒绝，以及结构化解析器。`packages/market-bundle` 全量套件（164 个文件）与 `pnpm run typecheck` 保持绿色。未在真实的反向代理宿主上验证：闸门逻辑以镜像 harness 源码的方式钉住，而非端到端代理实测。

## Related

提出这一对齐要求的 scratch 审计：[安全审计](../../../../docs/scratch/audit/security.md)。被镜像的宿主闸门：harness checkout 的 `packages/client/connection/src/api-request-trust.ts`。
