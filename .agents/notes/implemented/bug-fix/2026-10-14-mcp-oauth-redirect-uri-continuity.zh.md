# Agent Note: The OAuth loopback port stays published through the code exchange

Status: implemented

## 问题

启用一个 MCP 服务器会返回 `401` 的套件时，会连续弹出四五个内容相同、端口不同的浏览器窗口，而且任何一次授权都没有保存 token。挂载状态一直是 `failed`。只有禁用套件才能让窗口停下来。

Loopback 回调每次尝试都会换端口（RFC 8252 §7.3）。监听器绑定一个临时端口，`redirectToAuthorization` 把授权 URL 里的 `redirect_uri` 改写成该端口（`runtime/mcp/bridge/oauth.ts`）。动态客户端注册发生得更早，因此注册时携带的是 `redirectUrl` 在未绑定端口时返回的 `http://127.0.0.1:0/callback` 占位值。

`handleCallbackRequest` 在收到回调时立刻清掉了 `boundPort`，这发生在它交出授权码之前。随后进行的换取 token 请求会向 provider 索取 `redirectUrl`（`@modelcontextprotocol/sdk` 1.32.1，`client/auth.js`），于是 token 请求带的是端口 `0`，而授权请求带的是已绑定的端口。凡是会比较这两个请求的授权服务器（RFC 6749 §4.1.3）都会拒绝这次换取。Cloudflare 的 `@cloudflare/workers-oauth-provider` 1.2.3 返回 `invalid_grant: redirect_uri does not match the authorization request`。该库对 loopback 端口在 `/authorize` 上放宽匹配，所以同意页会正常出现，只有换取 token 这一步失败。

于是每一次重连尝试都会重新打开浏览器。挂载重试计划（1.5 秒、5 秒、15 秒、45 秒、120 秒共五次）决定了可见窗口的数量。已保存的记录正好说明失败的位置：`mcp-auth/cloudflare-cloudflare` 里有 `clientInformation`，没有 `tokens`。

## 决策

**已绑定的端口活到换取 token 结束。** `redirectToAuthorization` 在 `finally` 里、`finishAuth` 完成之后才清掉它。`handleCallbackRequest` 不再触碰它。`resetCallback` 仍会在授权环节中止时清理，因此超时或销毁不会把过期端口泄漏给后续尝试。

**supervisor 在授权成功后重建连接。** 触发 `401` 的那一代连接无法完成握手。SDK 在 initialize 失败时就关闭它，无论失败来自人类授权超时还是授权在超时之前返回。provider 新增 `lastBrowserLegOutcome`，因为授权环节在本次尝试内部结束时，待决的 `browserLeg` promise 已经不存在。supervisor 据此退役该代连接并在原地再跑一次尝试。授权成功会以「已连接」的结果到达 `ready`，而不是留给后续重试去修补的失败。

**浏览器 opener 成为可注入接缝。** `startConnection` 与 `createTransport` 接受可选的 `BrowserOpener`。拥有人类授权环节的调用方可以传入自己的实现。功能测试正是通过这个接缝驱动真实的授权服务器。

## 后果

- 一次授权即可保存 token 并完成挂载。该服务器不会再弹窗。
- 拒绝或中止的授权环节仍然上报错误并关闭 loopback 监听器。下一次尝试只弹一个窗口。
- token 刷新逻辑不变。已保存的 `refresh_token` 能在没有浏览器环节的情况下应答后续 `401`，功能测试对此有断言。
- 在换取 token 期间 `redirectUrl` 一直读取为已绑定端口。注册元数据仍然使用占位值，注册相关的行为没有其他变化。

## 备选方案

**默认使用固定的 `callbackPort`。** 让注册、授权、换取 token 共用一个 URL 可以消除这一类缺陷。未采纳：该端口必须在每台机器上都空闲，两个服务器会争抢它，而且任何套件都无法声明它。manifest 扫描器只保留 `auth.enabled` 与 `auth.scope`，override 的清洗逻辑同样如此。

**在监听器绑定之后再注册客户端。** 这样注册即可携带真实端口。未采纳：注册顺序由 SDK 掌管，而且每次尝试都注册会在授权服务器上留下一个窗口一个客户端记录。

**记住授权 URL 的 `redirect_uri`，而不是记住端口。** 效果等价。未采纳：这份状态 `boundPort` 已经持有，`resetCallback` 也已经在中止时清理，另存一份只是重复。

## 测试

- `packages/market-mcp/test/mcp-oauth-flow.test.ts` 用真实的 SDK 客户端与真实的 bridge 传输，对接一个镜像 Cloudflare 规则的真实 HTTP 授权服务器（`test/helpers/fake-oauth-mcp.ts`）。五个用例覆盖：默认临时端口、超出 initialize 超时的慢速授权、拒绝后恢复、刷新不弹第二个窗口、以及配置固定端口。端口连续性断言比较 `/authorize` 收到的值与会话 `/token` 收到的值。
- `packages/market-mcp/test/mcp-oauth.test.ts` 保留 provider 契约（记录状态、重定向元数据、回调准入），并新增锁定 `redirectUrl` 跨越换取 token 过程的回归用例。所有回调环节用例都运行在默认临时端口上。旧测试在每一个用例里都传了固定 `callbackPort`，一次 URL 贯穿三个请求，从而掩盖了这个缺陷。
- 去掉 `boundPort` 的改动后，五个功能用例中有四个以 `redirect_uri does not match the authorization request` 失败，固定端口那个仍然通过。这正是当初漏网缺陷的形状。

## 相关

[Re-authorize belongs to servers that authorize in a browser](2026-09-29-reauthorize-requires-oauth.md) 决定哪些服务器会提供「删除授权并重新走本流程」的操作。
