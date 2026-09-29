# Agent Note: The user's own MCP declarations own the top-level namespace

Status: implemented

## Problem

A server the user declared in `~/.agents/mcp.json` reached the model as `mcp__user-mcp__kuboard__list_clusters`. That declaration is carried by a synthetic suite — source `@user-mcp`, id `user-mcp` — and `deriveServerName` namespaced it like any package: `mcp__<suiteId>__<serverKey>__<tool>`.

The name misstated what the declaration is. The user authored that file, not a package; it is the same document every other MCP client reads, and those clients mount the server as `kuboard`, so one server answered to two names depending on which client connected. The synthetic suite id also reached the status panel's service rows and the OAuth grant key (`mcp-auth/user-mcp-kuboard`), renaming a record that belongs to the server rather than to any suite.

## Decision

**A package's servers are namespaced under their suite; the servers of the user's own declaration file are not.** `deriveServerName(suite, serverKey)` takes the suite: for `@user-mcp`/`user-mcp` it returns `sanitizeToken(serverKey)` alone, and `${suiteId}__${serverKey}` for everything else. The token is still sanitized and still clamped to the bridge's 32-character budget with the same deterministic hash suffix, because the write path accepts user server keys up to 64 characters.

`isUserMcpSuite` in `mcp-direct-config.ts` is the single predicate for "this suite is local data, not a package", and the derivation is its only reader. The mount request builder (`mcp-config.ts`) and the status builder (`mcp-status.ts`) both derive through it, so the panel prints the names the model sees and the tools observed under `mcp__<serverKey>__` group onto the row that declared them.

The service detail drops its mount-name row when the mount name equals the server key, so a user's own service reads one identity instead of the same string twice.

## Alternatives considered

**Keep the suite namespace for user declarations.** One rule for every mount, and a package shipping a suite called `user-mcp` could not take a name the user's own file wants. Rejected: the namespace exists to keep two packages' servers apart, and the user's file is not a package. Naming a user's server after a suite id the user never wrote is the defect, not the safeguard.

**Match the suite id alone.** `deriveServerName('user-mcp', key)` returning the bare key would also claim a marketplace suite that happens to be called `user-mcp`. Rejected: `@user-mcp` is what marks local data, and a suite id is not unique across sources.

**Pass a `bare` flag from each call site.** Keeps the string signature of the derivation. Rejected: a later call site can omit the flag and reintroduce the prefix quietly, while passing the suite keeps the exception inside the derivation that owns it.

## Consequences

- Tools of user-declared servers are `mcp__<serverKey>__<tool>`. A live session keeps the names it already registered until the mount is reconciled or the Host restarts.
- Such a server's OAuth grant record moves to `mcp-auth/<serverKey>`. A grant stored under the old key is orphaned, so the server's next 401 starts one authorization.
- A user key may derive the name a suite server also derives — `acme__db` in the user's file beside suite `acme`'s `db`. The mount registry's `duplicate-mount` and `foreign-mount` guards settle it: the first live mount keeps the namespace and the other row carries the diagnostic instead of a shadow registration.
- A host-managed MCP client already owning the key keeps it, and the market reports `foreign-mount` rather than opening a second connection to one server.

## Testing

- `tests/mcp-config.test.ts` — derivation: `__`-joined for a package, the bare key for `@user-mcp`, unchanged for another source's suite called `user-mcp`, and clamped for a 64-character user key.
- `tests/mcp-direct-config.test.ts` — the real `mcp.json` round trip produces mounts whose `serverName` is the declared key.
- `tests/mcp-status.test.ts` — a user row reads its bare name and collects the tools observed under it.
- `tests/client-mcp-detail.test.ts` — the mount-name row is absent when it would only repeat the server key.

## Related

[One MCP server identity, not one per session](../bug-fix/2026-09-13-mcp-identity-without-session-namespace.md) settled that one derived name serves every dimension; this note settles which suites are namespaced at all.
