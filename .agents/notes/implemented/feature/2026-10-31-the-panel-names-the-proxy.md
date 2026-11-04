# Agent Note: the panel names the proxy that blocks an intranet host

Status: implemented

## Problem

The owner asked why three connectors failed while the network was fine. The answer was not in the product: every host resolved to a LAN address, the machine's HTTPS traffic went through a local proxy, the proxy tunnel could never reach the LAN, and the panel reported a timeout or a handshake failure that reads like the service's fault. It took `curl --noproxy` on the command line to prove where the request died, which no one reading the panel can do.

## Decision

- **The status assembly decides, not the reader.** `proxyMismatchFor` compares the failed row's endpoint with the process environment: a proxy variable is set, and `NO_PROXY` does not cover the host. `NO_PROXY` matches exactly or as a suffix after a dot, in either casing, and `*` bypasses everything.
- **Only the failures a proxy explains.** The row must look connection-shaped: either its code is one of `timeout|tls|dns|refused|transport|mount-failed|reconnecting|reconnect-stopped`, or the words its layers wrote match a transport error (`timed out`, `ECONNREFUSED`, `ENOTFOUND`, `handshake`, `certificate`, and the rest). A 401 or a bad command line is never blamed on the proxy.
- **The detail says it in one sentence**, naming the proxy and the host: `本机经代理 http://127.0.0.1:7890 访问网络，而 NO_PROXY 未包含 kuboard.platform.zealwon.com：内网服务通常需要直连，或把该域加入 NO_PROXY。` The copyable diagnostics block carries the same fact as a `proxy:` line, so a report to a colleague is actionable.

## Alternatives considered

- **Resolve the host and flag private addresses.** Rejected: resolution is async, needs a DNS read inside a status build, and misses the common case where the LAN address is reachable directly but the proxy is what is configured.
- **Ask the mount to try a direct connection automatically.** Rejected: the plugin does not own the transport, and silently bypassing a proxy would defeat whatever policy put it there.
- **Put the hint on the card.** Rejected: the card's one line already carries the cause and the duration; the detail is where a reader goes to decide what to do.

## Consequences

- The most common intranet failure now names its own cause, with the exact variable to change and the host to add.
- A public host behind a proxy is not flagged, because the failure shape has to match.
- The diagnosis lags the environment: it reads the proxy variables at status build time, so a change to them shows on the next read, not instantly.

## Verification

- Live in `market-dev`: the failed `kuboard` connector renders the sentence verbatim with `mountMs 10004` beside it, and the copied block ends `proxy: http://127.0.0.1:7890 (host not in NO_PROXY: kuboard.platform.zealwon.com)` before the cause chain.
- `packages/market-bundle/test/integration/mcp-proxy-hint.test.ts` pins the positive case, the timeout read out of a generic `mount-failed`, both `NO_PROXY` casings, the `*` bypass, the non-proxy failures (401, `spawn ENOENT`), and the missing-proxy and unparseable-endpoint cases.
- The four typechecks, `check:refactor` and the full suite pass.
