# Agent Note：面板点名那个挡住内网的代理

Status: implemented

## Problem

负责人问：网络是通的，为什么三个连接器失败。答案不在产品里：三个域名都解析到内网地址，这台机器的 HTTPS 流量走本地代理，代理隧道到不了内网，而面板报的是像「服务坏了」的超时或握手失败。要证明请求死在哪，得在命令行跑 `curl --noproxy`，而看面板的人做不到。

## Decision

- **由状态组装来判断，而不是让读者判断。** `proxyMismatchFor` 把失败行的地址与本进程环境比对：设了代理变量，且 `NO_PROXY` 没覆盖该主机。`NO_PROXY` 支持精确匹配与点后缀匹配、两种大小写，以及 `*` 全放行。
- **只解释代理能解释的失败。** 行必须像连接问题：要么代码属于 `timeout|tls|dns|refused|transport|mount-failed|reconnecting|reconnect-stopped`，要么各层写下的话匹配传输错误（`timed out`、`ECONNREFUSED`、`ENOTFOUND`、`handshake`、`certificate` 等）。401 或命令行写错永远不会被归到代理头上。
- **详情用一句话说出来**，点名代理与主机： `本机经代理 http://127.0.0.1:7890 访问网络，而 NO_PROXY 未包含 kuboard.platform.zealwon.com：内网服务通常需要直连，或把该域加入 NO_PROXY。` 可复制的诊断块用 `proxy:` 一行携带同一事实，于是发给同事的报障是可执行的。

## Alternatives considered

- **解析主机、标记私网地址。** 否决：解析是异步的，要在状态构造里做 DNS 读取，而且会漏掉「内网地址本来能直连、只是配了代理」这种最常见的情形。
- **让挂载自动尝试直连。** 否决：传输不归本插件所有，而且悄悄绕过代理会破坏把它放在那里的策略。
- **把提示放卡片上。** 否决：卡片那一行已经有原因和耗时；详情才是读者决定「接下来做什么」的地方。

## Consequences

- 最常见的内网失败现在自己说出原因，并给出要改的变量与要加的主机。
- 代理后面的公网主机不会被误报，因为失败形状必须匹配。
- 诊断滞后于环境：它在构造状态时读代理变量，改了变量要等下一次读取才反映。

## Verification

- 在 `market-dev` 实测：失败的 `kuboard` 连接器原样渲染那句话，旁边是 `mountMs 10004`；复制的文本在成因链之前有 `proxy: http://127.0.0.1:7890 (host not in NO_PROXY: kuboard.platform.zealwon.com)`。
- `packages/market-bundle/test/integration/mcp-proxy-hint.test.ts` 钉住：正例、从通用 `mount-failed` 里读出超时、`NO_PROXY` 两种大小写、`*` 放行、非代理失败（401、`spawn ENOENT`）、无代理与地址不可解析。
- 四个类型检查、`check:refactor` 与全量测试通过。
