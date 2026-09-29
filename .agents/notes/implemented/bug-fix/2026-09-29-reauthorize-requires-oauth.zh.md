# Agent Note: Re-authorize belongs to servers that authorize in a browser

Status: implemented

## Problem

详情弹窗给两个自带 `Authorization` 请求头的远端服务都显示了「重新授权」：一个声明的是 `Bearer ${CONTEXT7_API_KEY}`，另一个是字面 token。这个动作会删掉已存的 OAuth 授权记录，让服务端下一次 401 打开浏览器授权——可自带请求头的服务根本走不到那条路径，于是这个按钮描述的是一个该服务从不处于其中的恢复动作。

`canReauthorize` 当时只看传输方式与声明的 `auth` 块：远端且授权开启即成立。静态请求头不是 `auth` 声明，所以两个服务都通过了判定。

## Decision

**自带 Authorization 请求头的服务不再提供 OAuth 动作。** `application/mcp/mcp-status.ts` 里的 `declaresAuthHeader(config)` 判断生效配置是否携带该请求头（不分大小写），`McpService.status()` 要求它缺席才置 `canReauthorize`。这条规则挨着状态词汇表、而不是搬进弹窗，于是这个标志的每个读取方对它的含义理解一致。

## Alternatives considered

**问凭据库是否存在授权记录。** 这是最精确的信号——该动作删的就是这条记录。否决：每个条目都要经一个面板未必拥有的服务往返一次，标志也会比它装饰的那一行到得更晚。

**所有远端服务都不给这个动作。** 规则更简单，但连它唯一存在的那一种情形也一并去掉了：声明 OAuth、并以 401 挑战的套件。

**保留按钮，在弹窗里解释它什么也不会发生。** 弹窗已经会确认这个动作做什么；一个解释"为什么按了没用"的确认框，比不提供它更糟。

## Consequences

- 自带请求头的服务保留重试、失去重新授权；真正在浏览器里授权的服务两者都有。
- 既声明 `auth` **又**带 Authorization 请求头的服务会失去该动作：它用请求头作答，剩下那一个恢复动作才是适用的那个。
- 标志即 `McpStatusEntry.canReauthorize`；详情弹窗自己的动作列表未改动。

## Testing

- `tests/mcp-status.test.ts` —— `declaresAuthHeader` 不分大小写地识别 `Authorization`，忽略其它请求头名，请求头表缺席时返回 false。
- `tests/client-mcp-detail-actions.test.ts` —— 弹窗的动作列表仍按它拿到的标志判定。
