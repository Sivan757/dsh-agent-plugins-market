# Agent Note: the request-trust fence accepts the authorities the deployment declares

Status: implemented

## Problem

`isTrustedMutation` refuses every request whose `Host` is not loopback. That rule is correct for a server reached only through `127.0.0.1`, and wrong for the deployment shape this plugin is most often installed into: `dsh web --host 0.0.0.0` behind a reverse proxy that terminates TLS on a public name.

The proxy keeps the incoming `Host`, so a browser on `https://dsh.example.com` sends `Host: dsh.example.com` to this plugin. The fence answered 403 `{"ok":false,"code":"cross-origin"}` for every mutating route — and for the two read routes that run through the same fence, the extension window and the hooks overview — while the host's own `/api` fence had already accepted the very same request, because the deployment had declared that name to the host with `--trusted-host`, or through the plugin that registers arriving hosts.

The two fences disagreed about one deployment. The host fence is the one the operator configured; this one had no way to hear it. #156 wrote the loopback rule and recorded the trade-off in the source: *"A deployment that exposes this port under another name needs a configured allow-list, and the plugin has none."* This note supplies the missing list.

## Decision

`isTrustedMutation(request, trust)` takes a `RequestTrust` and the `Host` check becomes three sources instead of one:

1. loopback hostnames, exactly as before;
2. the listener's own bind address, on any port — a browser dialing the literal grants nothing further, and the Origin and cross-site checks still apply;
3. `trustedHosts`, the host's own live list: an entry with a port matches that exact authority, a port-less entry matches the hostname on any port.

The other two checks are untouched: `sec-fetch-site: cross-site` is still refused outright, and a present `Origin` must still equal `Host`.

`requestTrustOf(ctx)` reads the list from `connection.trustedHosts` and the bind address from `webServer.host`, lazily, once per request — the host appends to the list while it runs, so a name registered after this plugin mounted is accepted without a restart. A context that exposes neither yields an empty trust, which is the loopback-only rule this module has always applied; a harness without a `connection` service therefore keeps today's behavior exactly.

## Consequences

A reverse-proxied deployment works without a second, plugin-local copy of the name list, and without weakening the rebinding defense: a name the deployment never declared is still refused, which is the attack #156 fixed. This plugin's fence and the host's now accept the same set of authorities, because they read the same list.

The trust a deployment grants is the trust its host fence already grants. A deployment that registers every arriving `Host` — the shape a wildcard-entry plugin implements — has already widened the host fence to every name, and this fence follows it rather than being the one component that still refuses the page the server just served. That is a deployment choice, made once, in one place; it is not a widening performed by this plugin.

Nothing changes for loopback deployments, and nothing changes for a harness that predates the `connection` service.

## Alternatives considered

**Compare `Origin` with `Host` and drop the loopback rule.** This is precisely the check #156 removed: a DNS-rebinding page carries the attacker's domain in both headers, the browser treats the request as same-origin, and the comparison proves nothing. Reintroducing it would reopen unauthenticated command execution through the hook dry run.

**A plugin-local allow-list setting.** It would work, and it would be a second copy of a fact the host already owns, edited in a different file, drifting the first time an operator adds a name to only one of the two. The host's list is the one that decides whether the request reaches this code at all.

**Rely on the host's `/api` fence and delete this module.** The host fence is mounted as the `/api` prefix route; the routes here are exact paths that match first, so the host fence is not on their path. Something has to check these routes, and it should check them the same way.

**Keep the loopback rule and document "use an SSH tunnel".** That abandons the remote-web deployment the harness supports, for a rule the deployment cannot satisfy through any supported mechanism.

## Testing

`packages/market-bundle/test/integration/request-trust.test.ts` gains both directions of the new input. An declared name with a matching `Origin` is accepted; a rebound page whose domain the deployment never declared is still refused; a declared name with a disagreeing `Origin`, an opaque `Origin`, or `cross-site` is refused; an entry with a port matches that port only, a port-less entry matches any port; the bind address is accepted on any port and a neighboring address is not; an empty trust keeps the loopback-only behavior. `requestTrustOf` is driven against a fake context whose list is appended to after the first read, which is the live-list contract: the second name is accepted without a second read of the service.
