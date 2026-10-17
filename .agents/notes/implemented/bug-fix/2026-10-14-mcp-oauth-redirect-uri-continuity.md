# Agent Note: The OAuth loopback port stays published through the code exchange

Status: implemented

## Problem

Enabling a suite whose MCP server challenges with `401` opened four or five identical browser windows on different loopback ports, and no authorization ever stored a token. The mount stayed `failed`. Disabling the suite was the only way to stop the windows.

The loopback redirect varies its port per attempt (RFC 8252 §7.3). The listener binds an ephemeral port, and `redirectToAuthorization` rewrites the authorization URL's `redirect_uri` to that port (`runtime/mcp/bridge/oauth.ts`). Dynamic client registration runs earlier, so it advertises the `http://127.0.0.1:0/callback` placeholder that `redirectUrl` returns while no port is bound.

`handleCallbackRequest` then cleared `boundPort` as soon as the redirect arrived, before it resolved the code. The exchange that runs a moment later asks the provider for `redirectUrl` (`@modelcontextprotocol/sdk` 1.32.1, `client/auth.js`), so the token request carried port `0` while the authorization request had carried the bound port. An authorization server that compares the two requests (RFC 6749 §4.1.3) rejects the exchange. Cloudflare's `@cloudflare/workers-oauth-provider` 1.2.3 answers `invalid_grant: redirect_uri does not match the authorization request`. Its loopback relaxation accepts any port at `/authorize`, which is why the consent page appeared and only the exchange failed.

Every reconnect attempt therefore re-opened the browser. The mount retry schedule (five attempts at 1.5s, 5s, 15s, 45s, 120s) produced the number of visible windows. The stored record showed the shape of the failure: `mcp-auth/cloudflare-cloudflare` carried `clientInformation` and no `tokens`.

## Decision

**The bound port outlives the callback.** `redirectToAuthorization` clears it in its `finally`, after `finishAuth` completes. `handleCallbackRequest` no longer touches it. `resetCallback` still clears it for an aborted leg, so a timeout or a disposal cannot leak a stale port into a later attempt.

**The supervisor re-establishes the connection after a successful leg.** The generation that raised the `401` cannot finish its handshake. The SDK closes it as soon as the initialize fails, whether the human approval outlived the request timeout or returned inside it. The provider publishes `lastBrowserLegOutcome`, because the pending `browserLeg` promise is gone once a leg settles inside the attempt. The supervisor then retires the generation and runs one more attempt in place. A successful authorization reaches `ready` as a connected mount, not as a failure for a later retry to repair.

**The browser opener is an injectable seam.** `startConnection` and `createTransport` take an optional `BrowserOpener`. A caller that owns the human leg supplies its own. The functional tests drive a real authorization server through that seam.

## Consequences

- One authorization stores tokens and the mount connects. No further window opens for that server.
- A denied or aborted leg still reports its error and closes the loopback listener. The next attempt opens exactly one window.
- Token refresh is unchanged. A stored `refresh_token` answers a later `401` without a browser leg, which the functional suite asserts.
- `redirectUrl` reads as the bound port for the duration of the exchange. Registration metadata still advertises the placeholder, so nothing else about registration changes.

## Alternatives considered

**Default to a fixed `callbackPort`.** One URL for registration, authorization, and the exchange would remove this class of defect. Rejected: the port must be free on every machine, two servers would contend for it, and no suite can declare one. The manifest scanner keeps only `auth.enabled` and `auth.scope`, and the override sanitizer does the same.

**Register the client after the listener binds.** Registration could then advertise the real port. Rejected: the SDK owns registration ordering, and one registration per attempt would leave a client record per window on the authorization server.

**Remember the authorization URL's `redirect_uri` instead of the port.** Equivalent in effect. Rejected because it duplicates state that `boundPort` already holds and that `resetCallback` already clears on abort.

## Testing

- `packages/market-mcp/test/mcp-oauth-flow.test.ts` runs the real SDK client and the real bridge transport against a real HTTP authorization server that mirrors the Cloudflare rules (`test/helpers/fake-oauth-mcp.ts`). Five cases cover the default ephemeral port, a slow approval that outlives the initialize timeout, a denial followed by recovery, a refresh that opens no second window, and a configured fixed port. The port-continuity check compares what `/authorize` received with what `/token` received.
- `packages/market-mcp/test/mcp-oauth.test.ts` keeps the provider contract (record state, redirect metadata, callback admission) and adds the regression case that pins `redirectUrl` across the exchange. Every callback-leg case runs on the default ephemeral port. The previous suite passed a fixed `callbackPort` in all of them, which pinned one URL for all three requests and hid this defect.
- Without the `boundPort` change, four of the five functional cases fail with `redirect_uri does not match the authorization request`. The fixed-port case still passes. That is the shape of the original escape.

## Related

[Re-authorize belongs to servers that authorize in a browser](2026-09-29-reauthorize-requires-oauth.md) governs which servers offer the action that drops a grant and restarts this flow.
