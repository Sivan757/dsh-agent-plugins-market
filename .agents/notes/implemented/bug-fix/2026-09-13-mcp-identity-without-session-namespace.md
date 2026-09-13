# Agent Note: One MCP server identity, not one per session

Status: implemented

## Problem

A Cloudflare MCP server kept opening the browser authorization page, in sessions whose only MCP row was already connected and whose configuration declared no `auth` at all. Two separate facts produced that.

**A session started in the harness home had a project dimension.** `resolveProjectRoot(cwd)` is `<findProjectRoot(cwd)>/.dsh/agent-plugins`, and `findProjectRoot` falls back to the cwd itself when no ancestor holds `.git`. For `~`, that path _is_ the user dimension root, `~/.dsh/agent-plugins`. The session therefore read the user's own `state.json` as a project state and reconciled every user-level suite a second time through `mountProjectMcp`, inside that agent's scope — a second connection to every user-installed MCP server.

**A project mount's name carried the session identity.** `McpMountRegistry` re-derived the name as `deriveServerName(serverName, agent.session.id ?? randomUUID())`. The result overflowed the 32-character budget, so it was clamped with a hash (`cloudflare__cloudfla-a750f72e2d3b`), and a server's OAuth credential record is keyed by that same name. Every session looked up a record no session had written: the grant fetched under the previous session's key, the server answered 401 again, and the SDK opened the loopback browser again. `.credentials.yaml` held six such records — three of them fully authorized — each matching exactly one `~`-rooted session id, which is what "I authorize every time and it still asks" was.

The suffix also made a project server unrecognizable in its own tool names, and invisible to the MCP status panel, which derives names without it.

## Decision

**A project dimension that resolves to the user dimension is not a project.** `SnapshotCache.readProjectCatalog` returns an empty snapshot when `resolveProjectRoot(cwd)` resolves to the host's `userRoot`. Every consumer of the project catalog — MCP mounts, commands, hooks, skills, project roles — now sees one scope or the other, never the user's installs wearing a project's name.

**One derived `serverName` per suite/server, in every dimension.** `McpMountRegistry` loses its `namespace` constructor argument and no longer re-derives a project mount's name; `mountProjectMcp` no longer passes the session id. The host already keeps tool registrations per agent: `ToolLayer` holds one entry table per scope, the scope's own entries shadow inherited ones, and the global layer's duplicate-name error directs callers to register a per-agent variant through that agent's `ctx`. Two agents, or a project and the user dimension, still mount the same server key independently — now under one stable name.

**The status row states the authorization the configuration cannot show.** `McpStatusEntry.oauthDefault` is true for a remote server whose suite declares no `auth` block, and the detail dialog renders it as `mcpOauthDefault`. OAuth is enabled by default and only acts on the server's 401 challenge, so a redacted configuration without an `auth` key never meant "no authorization is involved".

## Alternatives considered

**Keep the per-session suffix and give OAuth a session-independent record key.** The credential key would be passed to the bridge separately from `serverName`, so grants survive a session while tool names stay session-scoped. Rejected: it splits one identity into two names that must be kept in step by hand, keeps the hash-clamped tool names, and keeps the duplicate connection this bug was reported from.

**Skip only the duplicate mount.** Guarding the home-aliasing case alone stops this report, but a genuine project-scoped OAuth server would still re-authorize in every session, and project tool names would still carry a hash.

**Namespace by project root instead of by session id.** Stable within a project, but it still forks the credential record per project for a server the user authorized once, and it still spends the name budget.

**Give the OAuth record a fixed scope shared by every server.** Rejected: unrelated servers would collide on one record, and a re-authorize action could not name one server's grant.

## Consequences

- A project mount and the user-dimension mount of the same suite/server share one identity. Inside that agent the scoped registration shadows the global one — the host's documented rule — and one stored grant serves both.
- The six per-session records left in `~/.dsh/.credentials.yaml` are orphans. Mounts read `mcp-auth/<suite>-<server>` again (for Cloudflare, `mcp-auth/cloudflare-cloudflare`), which is the record that was always valid.
- A session rooted in the harness home no longer mounts a second copy of anything: one connection per server, not two.
- Two projects that declare the same suite/server now share a name and are distinguished by agent scope rather than by name. That is the trade: a readable, stable identity in exchange for a name that is no longer unique across live projects.
- The status panel stays a user-dimension inventory. Names it prints now match the names those mounts register, including the project dimension.

## Testing

- `tests/native-project-cwd.test.ts` — a home cwd reads as an empty project catalog while the user catalog still lists the install, and a `.git`-rooted cwd still resolves to its own dimension.
- `tests/project-mcp.test.ts` — two agents mount their own project configs under one shared derived name, and switching project layouts off unmounts both.
- `tests/mcp-status.test.ts` — `oauthDefault` is set for a remote server without an `auth` declaration and absent for `stdio` or a declared one.
- `tests/client-mcp-detail.test.ts` — the authorization note renders for that row only.
