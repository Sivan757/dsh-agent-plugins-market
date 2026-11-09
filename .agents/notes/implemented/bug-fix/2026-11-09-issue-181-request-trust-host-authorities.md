# Agent Note: The request-trust fence accepts the host's declared authorities

Status: implemented

## Problem

Every market route sits behind one request-trust fence (`packages/market-bundle/src/request-trust.ts`) whose Host check accepted loopback hostnames only. A reverse-proxied deployment — `dsh web --host 0.0.0.0` behind Caddy or nginx terminating TLS on a public domain and keeping the incoming `Host` — therefore failed every market route with `403 {"ok":false,"code":"cross-origin"}` (issue #181): the proxy delivers `Host: dsh.example.com`, which the fence can never accept, and rewriting `Host` at the proxy does not help because the browser's `Origin: https://dsh.example.com` then fails the Origin-vs-Host comparison. The host's own `/api` fence (`packages/client/connection/src/api-request-trust.ts` in the harness checkout) accepts exactly these deployments through its `trustedHosts` configuration and the listener bind address, so the plugin disagreed with the host that mounts it. The extension window routes are GET reads polled every 2.5 s, so the failure filled the browser console and made the whole surface unusable from the domain.

## Decision

The Host check now accepts the same set as the host fence: loopback (unchanged), an entry of the host connection service's `trustedHosts`, or the listener's bind address. The entry matcher mirrors the harness's `isTrustedAuthority` — an exact `host:port` entry matches that authority, a port-less entry matches the hostname on any port, both sides compare through WHATWG normalization so case and scheme-default ports never decide — and the bind address mirrors `isBindAddressAuthority`: hostname compare on any port, any `%zone` id dropped first. `sec-fetch-site: cross-site` and the Origin-vs-Host comparison are unchanged, and the decision stays a pure function with explicit authority input: `isTrustedMutation(request, authorities)`.

The loopback test mirrors the harness classifier too: `isLoopbackHostname` (`packages/client/connection/src/loopback-hostname.ts`) accepts `localhost`, `[::1]`, or any IPv4 in 127/8, replacing the fence's older hand-rolled set that also carried `0.0.0.0` and missed the rest of 127/8. The alignment cuts both ways: `127.0.0.2`, which the host fence admits, passes here as well, and `0.0.0.0` is no longer loopback — a listener bound to it admits that Host through the bind-address mirror, exactly as the host fence does.

The authorities are threaded explicitly through the mounts. Every route mount already receives the host context, so each fence call site passes `requestTrustAuthoritiesOf(<host ctx>)` — a structural read of `connection` (`trustedHosts`) and `webServer` (`host`, `protocol`) resolved per request, the same lazy pattern every host port in this plugin uses, because a service can provision after this plugin's apply. A context that exposes neither service — an older harness, a hand-built test host — yields undefined, and the fence degrades to loopback-only, exactly its previous behavior. A name the deployment never declared is still refused, so the #156 DNS-rebinding defense is intact.

### Reading the connection service's private field

`HostConnectionService` holds `trustedHosts` as a TypeScript- `private` field; it is not a published host surface. The plugin reads it structurally (`{ trustedHosts?: readonly string[] }`), the local-structural-typing precedent the routes already use for `webServer`, and adds no dependency on `@deepseek-ai/dsh-client-connection`. This is a recorded deviation: a harness that renames or reshapes the field silently degrades the fence to loopback-only, which fails closed (403 returns) rather than opening.

The runtime-mutation question is settled against the harness source: the list is config-fixed. The connection plugin reads `config.trustedHosts` once in `apply`, passes it to the service constructor as a `readonly` field, and precomputes `allowsRemoteAuthorities` from it in that constructor — a shape that would be wrong if the list moved at runtime. (The issue's "the host appends to `trustedHosts` while it runs" does not describe the current harness.) The per-request read stays anyway: it keeps the fence correct if that ever changes and costs one cheap `ctx.get`.

## Alternatives considered

**Reusing the connection service's `requestRejection`/`admit`.** Rejected: that path applies the host's browser authentication on top of the fence, so it would 401 the non-browser callers the plugin's routes admit today, folding a session behavior change into a trust fix.

**A plugin-local trusted-host setting.** Rejected: it duplicates host configuration and drifts — a deployment that declares its name to the host would also have to declare it to the plugin, and the two fences would disagree exactly as before.

**A new host-side public API exposing the accepted authorities.** Rejected here: host modification is forbidden in this project, so the change is an upstream request for the harness maintainer to weigh, not something this repository can ship.

**Reading the private `trustedHosts` field structurally.** Accepted, with the deviation recorded above: it is the only way to consume the host's live declaration without a host change or a new dependency, and the failure mode is fail-closed.

**A module-level authority provider registered once at apply.** Rejected in favor of threading: every mount already receives the host context, so threading added no signatures and no plumb-through, while a module-level `setXxxSource`-style provider would have introduced mutable module state shared by test instances without removing any wiring.

## Deferred

The Origin comparison parses both headers under plain HTTP and is blind to scheme: an `https` Origin equals an `http` Host carrying the same authority, where the host fence compares Host under the Origin's scheme. This is pre-existing behavior preserved byte-for-byte on purpose — the reported proxy deployment keeps a port-less Host, where the two cannot differ — and the review classifies the differing shape as not browser-reachable through this fence's remaining checks. Aligning it with the host's origin-scheme parse would be its own decision.

## Consequences

Cost: the plugin now leans on two unpublished service shapes (`connection.trustedHosts`, `webServer.host`/`protocol`), both read structurally, whose failure mode is degradation to loopback-only — never admission. Bought: deployments that declared their name to the host, or dial the bind literal, pass every market route, and the two fences agree; hosts that declared nothing keep exactly the loopback-only fence. The Origin comparison keeps its existing plain-HTTP parse, so its behavior is byte-for-byte unchanged; for a proxied Host without a port (the reported deployment) it matches the https Origin.

## Testing

`packages/market-bundle/test/integration/request-trust.test.ts` pins the accepted set: a trusted entry (the reported repro), port-less entries on any port, explicit-port entries exactly, scheme-default-port redundancy, the https listener's TLS-default entry grant mirrored row-for-row from the harness spec, the bind address including `%zone`, the loopback classifier (127/8 accepted, `0.0.0.0` only through the bind path, near-loopback names refused), the malformed-entry reading shared with the harness, undeclared refusal, degradation without authorities, cross-site and Origin refusals for a trusted host, and the structural resolver. The full `packages/market-bundle` suite (164 files) and `pnpm run typecheck` stay green. Not verified against a live reverse-proxied host: the fence logic is pinned by mirroring the harness source, not by an end-to-end proxy run.

## Related

The scratch audit that called for this alignment: [the security audit](../../../../docs/scratch/audit/security.md). The mirrored host fence: `packages/client/connection/src/api-request-trust.ts` in the harness checkout.
