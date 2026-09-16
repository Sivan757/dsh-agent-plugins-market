# Agent Note: Hand-authored content lives in the Agent layout root

Status: implemented

## Problem

User-authored skills, commands and personas persisted under `$DSH_HOME/agent-plugins/user/{skills,commands,agents}`, and the services a user added in the workspace persisted as `data/mcp-servers.json` and `data/lsp-servers.json`. That buried content the user owns inside plugin-private state: no other Agent tool reads it, and the service declarations did not use the layout this plugin already reads from a project's `.agents/` directory. [The ecosystem research](../../../../docs/developer/discussion/2026-09-02-agent-config-compat-ecosystem.md) records project `.agents/skills/` and global `~/.agents/skills/` as de-facto cross-tool conventions.

## Decision

Hand-authored resources and hand-written service declarations move to the shared Agent layout root `~/.agents` (`$DSH_AGENTS_HOME` overrides it for tests and unusual homes):

- `skills/`, `commands/`, `agents/` — the same Markdown entries and frontmatter grammar as before; `UserPanelStore` changes only its root. The skills panel later gained the cross-tool `<name>/SKILL.md` spelling beside its flat files, per [the skill directory spelling decision](../feature/2026-09-14-user-skill-directory-spelling.md).
- `mcp.json` (`mcpServers`) and `lsp.json` (`lspServers`) — where the workspace's Add buttons write.

Plugin state stays under `$DSH_HOME/agent-plugins`: `.sources/`, `state.json`, `data/` (overrides, `${PLUGIN_DATA}` directories, the feedback rate-limit stamp) and the persisted LSP enable set. The two roots are deliberately different: caches and install state are ours, authored content is the user's.

Containment for editing resources inside an installed suite is now measured against the catalog's user root instead of the panel directory, because a panel no longer sits inside the tree that owns the checkouts.

The harness's own `dsh-skill-filesystem` maps this same `~/.agents/skills` directory as its `user-agents` root, at rank 500, and a lower rank wins a duplicated skill name within one layer. The panel provider therefore sits at 440: ahead of that reader for the entries it serves, so the declared name and localized description it publishes are the ones that apply, and behind project roots (100-300) and the user's `~/.dsh` skills (400) — while also beating the suite user rank (450), so a skill the user wrote by hand wins over one an installed suite ships under the same name. Rank does not carry the panel's off state: the switch writes the harness's own invocation pair into the document, which that reader parses and its consumer enforces; see [the panel's reader-parity decision](../feature/2026-09-14-user-skill-directory-spelling.md).

Activation migrates before any store reads: `user/{skills,commands,agents}` and `data/user/...` into `~/.agents/<kind>`, `data/mcp-servers.json` and `data/lsp-servers.json` into `~/.agents/mcp.json` and `~/.agents/lsp.json`. Emptied former panel directories are removed; a content conflict stays at the original path and blocks activation with that path.

## Alternatives considered

**Keep one canonical root for everything.** Rejected: that is the problem being fixed — user content unreadable by the tools the `.agents/` convention exists for.

**Move skills to the cross-tool `skills/<name>/SKILL.md` directory shape at the same time.** Rejected for now: the panels edit one document per entry, and flat `skills/*.md` is also an accepted spelling; the directory shape is its own change with its own migration. That change later shipped without a migration ([the skill directory spelling decision](../feature/2026-09-14-user-skill-directory-spelling.md)): the panel now serves both spellings and keeps creating flat entries.

**Discover `~/.agents` as an ordinary source instead of a panel store.** Rejected: the panels need create/update/delete and the `disabled` frontmatter control, which the catalog reader does not provide.

## Consequences

User content survives uninstalling the plugin, which is the point of the move. `~/.agents` is shared: the plugin must never delete it or repurpose unknown entries, and migration only writes into the subdirectories and files it owns. A configured `~/.agents` that overlaps plugin storage is rejected at startup. Tests stub `DSH_AGENTS_HOME`, so activation never migrates or writes into a developer's real home directory.

Sharing `skills/` with the harness's own reader costs one duplicated candidate per entry and one host warning per shadowed name, in whichever direction the ranks decide. The panel wins that trade because it is the only reader that knows the user disabled the entry.

That cost is not profile-bounded. The web bundle disables the base host `skill-filesystem` row (`packages/bundle/web-app/cordis.patch.yml`) because presets own local discovery there, but every shipped preset mounts its own `skill-filesystem` row, so a session reads this directory through both providers. Keeping the entries in this shared directory is still the right side of the trade: moving them into plugin-private storage to avoid one duplicate candidate would put user content back where no other Agent tool reads it, which is the problem this decision exists to fix.

## Verification

`tests/storage-migration.test.ts` covers the panel and declaration moves, the emptied directories, conflicts and repeated runs; `tests/user-panels.test.ts`, `tests/mcp-direct-config.test.ts`, `tests/lsp-direct-config.test.ts` and `tests/server-config.test.ts` cover CRUD and validation against the new root; `tests/panel-resources.test.ts` covers installed-suite editing containment. `tests/user-panels.test.ts` also pins the panel provider's rank below the harness reader's 500, which is the assertion that fails if the precedence is silently retuned.
