# Agent Note: Raise every alerting transitive, and accept the zod alert

Status: implemented

## Problem

Dependabot reported ten open alerts against `pnpm-lock.yaml`. Four packages carry them: `undici` (one high, two medium, fixed in `8.12.2`), `fast-uri` (two medium, two low, fixed in `3.1.9`), `body-parser` (high, fixed in `2.4.0`), and `@modelcontextprotocol/client` (medium, fixed in `2.3.0`). A fifth, `zod` (high, fixed in `4.6.6`), cannot be fixed here at all: the host family pins it exactly.

Each package needs a different answer, because the repository owns none of them. Whether a fix is possible depends on what the parent declares.

## Decision

Each transitive moves by the cheapest mechanism its parent allows.

| Package                        | From     | To                  | How                     |
| ------------------------------ | -------- | ------------------- | ----------------------- |
| `fast-uri`                     | `3.1.8`  | `3.1.9`             | `pnpm update`           |
| `body-parser`                  | `2.3.0`  | `2.4.0`             | `pnpm update`           |
| `undici`                       | `8.11.2` | `8.12.2`            | `overrides`             |
| `@modelcontextprotocol/client` | `2.2.0`  | `2.3.0`             | `overrides`             |
| `zod`                          | `4.4.3`  | accepted at `4.4.3` | no fix is possible here |

**The two `pnpm update` rows are range fixes.** `ajv@8.20.0` declares `fast-uri: ^3.0.1` and `express@5.3.0` declares `body-parser: ^2.3.0`, so both ranges already admit the fixed release. A targeted `pnpm update` moved them and nothing else.

**The two `overrides` rows are exact-pin fixes.** Their only parents are host packages that declare them exactly, so no range exists to widen and no update can reach them. Measured with `npm view`:

```
@deepseek-ai/dsh-http-proxy@0.2.1-rc.2  { undici: "8.11.2" }
@deepseek-ai/dsh-mcp-client@0.2.1-rc.2  { "@modelcontextprotocol/client": "2.2.0" }
@deepseek-ai/dsh-http-proxy@0.2.1-rc.3  { undici: "8.11.2" }
@deepseek-ai/dsh-mcp-client@0.2.1-rc.3  { "@modelcontextprotocol/client": "2.2.0" }
```

Both lines answer the same way, so the overrides survive the alignment change and are not a workaround for a stale baseline. The `undici` override also collapses the graph to one copy, because `jsdom` already resolved `8.12.2`.

**The `zod` row is an accepted risk, recorded in [`.github/SECURITY.md`](../../../../.github/SECURITY.md).** The host family declares zod `4.4.3` exactly. Measured on 2026-10-26 with `npm view <package>@0.2.1-rc.3 dependencies.zod`, six host packages report `4.4.3`: `@deepseek-ai/dsh-agent-loop`, `@deepseek-ai/dsh-llm`, `@deepseek-ai/dsh-subagent`, `@deepseek-ai/dsh-session-projection`, `@deepseek-ai/dsh-client-ui-plugin-manager`, and `@deepseek-ai/dsh-experimental-agent-team`. The `4.4.3` override exists because a plugin schema crosses into the host's `ProjectionDefinition`, and a second physical copy makes the host's `ZodType` nominal, so the plugin's schema stops matching. Raising it to `4.6.6` breaks that match. Closing the alert needs a host release that moves the family, not a change here.

**None of these fixes ship to a user.** pnpm reads `overrides` from `pnpm-workspace.yaml`, and that file is absent from the `package.json` `files` list, so `npm pack` leaves it out and the published tarball carries no override. A consumer profile resolves `@deepseek-ai/dsh-mcp-client` from npm, and that package still declares `@modelcontextprotocol/client` `2.2.0` exactly on the `0.2.1-rc.3` line. The four fixes are repository hygiene and supply-chain posture. They change what this repository installs and tests, not what a user runs.

## Alternatives considered

- **Override all four packages.** Rejected: an override pins a version forever, and three of the four parents declare a real range. `fast-uri` and `body-parser` would then need maintenance the parent range already provides, and the next `ajv` or `express` minor would silently fight the pin.
- **Override only `undici`, and leave `@modelcontextprotocol/client` for the host to fix.** Rejected: it closes the high alert and leaves a medium one open, when the same one-line mechanism closes both. The risk profile of `2.2.0` to `2.3.0` is a minor bump whose own manifest keeps `zod: ^4.2.0`, so the existing `zod` override still governs it and the host's single-copy rule survives.
- **Wait for `0.2.1-rc.3` to fix `undici` and the MCP client.** Rejected on evidence: `rc.3` keeps both exact pins, measured above. Waiting would leave four alerts open indefinitely.
- **Pin `@modelcontextprotocol/client` to `2.4.0` instead of `2.3.0`.** Not chosen: `2.3.0` is the lowest release that clears the advisory, and it is the version `dsh-mcp-client` was built against soonest. Choosing the minimum keeps the override defensible.
- **Move the `zod` override to `4.6.6` and accept a second copy.** Rejected: this is the exact failure the override exists to prevent. The host's nominal `ZodType` would stop matching the plugin schema at runtime, which is a break with no alert attached to announce it.
- **Leave `zod` undocumented so the next bot pull request just bumps it.** Rejected: an undocumented intentional hold reads as staleness. A later reader would raise it, break the host contract, and have no way to see why the value was chosen.

## Consequences

- Four of the five packages clear their alerts. Three `undici` alerts, four `fast-uri` alerts, one `body-parser` alert, and one `@modelcontextprotocol/client` alert close with this change.
- The `zod` high alert stays open by design. `.github/SECURITY.md` states that it is accepted and what would close it, so the next reader does not treat it as an oversight.
- Two new overrides carry a maintenance cost. Each names the parent that forced it and the parent version it was measured against, so the override is removed when the host raises its own pin.
- The `undici` graph now holds one copy instead of two, which removes a duplicate `EnvHttpProxyAgent` module instance from the install.
- This change touches no host pin, and `check-host-alignment` passes on it. The `0.2.1-rc.3` baseline comes from the separate alignment change, not from this one.

## Forward risk: the MCP client redirect default

`@modelcontextprotocol/client` `2.3.0` adds `redirectPolicy` to both HTTP transports, defaulting to `'same-origin'`. Version `2.2.0` had no such option and left redirects to fetch. `dsh-mcp-client` does not pass the option, so it inherits the new default.

The import surface does not drift. Unpacking both tarballs shows the same 402 exports, a byte-identical `declare class Client` block, and an unchanged `StdioClientTransport`. The failure arrives through the changed default, not through an API break.

The risk is measured, not hypothetical. Probed on 2026-10-26, the owner's own server `https://kuboard.dev.kapukapu.cn/mcp` answers `301` with `location: https://kuboard.platform.zealwon.com/mcp`, which is a cross-origin redirect. Two local servers reproduced the consequence. Port A answered `307` to port B, and `2.2.0` delivered the request to the target and resolved, while `2.3.0` sent nothing to the target and threw `Error POSTing to endpoint: Redirect to ... not followed; use that URL as the endpoint if it is the intended server (redirectPolicy: 'same-origin')`.

When the host family moves `dsh-mcp-client` onto `@modelcontextprotocol/client` `2.3.0` or later, that server stops connecting. The failure lands on the host, not on this repository. Connect failures surface through the plugin's retry policy, then through its unregister path, and the redirect text travels in the message.

The fix is one line in `dsh-mcp-client`: pass `redirectPolicy: 'follow'` to the transport. That is a host change. This repository adds no workaround for it and opens no host issue from here. This note is the record.
