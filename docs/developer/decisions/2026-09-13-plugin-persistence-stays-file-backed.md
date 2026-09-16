# Plugin persistence stays on the harness file utilities, not the storage domain

## Context

This plugin keeps durable state of its own: `state.json` (sources and install records), the MCP and LSP declarations under the Agent layout root, per-suite overrides, the LSP enable set, and the panel Markdown. The harness ships a second durable facility, `ctx.storageDomain`, mounted in the standard profile by the base bundle (`dsh-storage` / `dsh-storage-json` rooted at `$DSH_HOME/storages` / `dsh-storage-domain`), whose `DomainFacility.open(spec)` takes a `defineDomain` declaration with zod record schemas and returns a typed handle.

The question this decision records: should the plugin's persistence move onto that facility?

## Decision

No. Plugin persistence stays where the [storage note](../../../.agents/notes/implemented/architecture/2026-09-13-plugin-storage-on-harness-file-utilities.md) put it — reads and writes through `@deepseek-ai/dsh-atomic-write`, roots through `@deepseek-ai/dsh-home-paths` — with the plugin owning its file layout under `$DSH_HOME/agent-plugins`.

Three reasons, in order of weight:

1. **The failure models differ, and the plugin's is deliberate.** `state.json` is the source of truth for what is installed, and `state-store.ts` states the contract: the on-disk copy is authoritative, and a mutation that races a concurrent writer re-reads the file so the last writer's content survives. The storage domain loads records into memory at `open` and serves reads from there, which is the right model for a cache or a projection and the wrong one for a file a user may also edit by hand.
2. **It is a user-data migration, not a refactor.** Moving to the domain means relocating `$DSH_HOME/agent-plugins/state.json` into `$DSH_HOME/storages/*` and migrating every existing install's copy, on top of the migration `storage-migration.ts` already performs. That is a product-visible change to where a user's data lives, and it belongs in a change that says so rather than in a reuse sweep.
3. **The domain's schemas are zod.** The plugin's own declaration surface is schemastery (the host settings namespace, the plugin `Config`). Adopting zod for the domain would not be wrong — the plugin already depends on zod — but it does split one plugin's declaration vocabulary across two libraries for no capability gain.

This is a decision about the plugin's **own** state. It does not contradict using host-owned stores for state the host already owns: the settings namespace keeps user switches in the host settings document, and browser-local preferences ride the platform snapshot store.

## Revisit when

- The plugin needs a record it can query by key without reading the whole document (per-source progress, per-server diagnostics history) rather than one small state blob.
- The harness states that plugin state belongs in the storage domain, or removes the file utilities this plugin builds on.
- A user-data migration is happening anyway for another reason, in which case folding this move into it costs little extra.

## Considered options

- **Migrate to `ctx.storageDomain` now — rejected.** Correct destination, wrong change: it swaps the authoritative-copy semantics for an in-memory one and relocates user data, neither of which this change is about.
- **Route writes through `ctx.fs` — rejected.** Already decided against in the storage note: `ctx.fs` is the execution world's filesystem, it is sandboxed away from this plugin's roots, and it has no binary write, `mkdir`, rename, or delete.
- **Keep hand-rolled `node:fs` writes — rejected.** Superseded by the storage note; the atomic-write utility carries the Windows rename retry and the symlink-safe temp create.

## Status

Implemented as "no change": persistence remains on the harness file utilities. No plugin code reads or writes `ctx.storageDomain`. `tests/state.test.ts` continues to pin the properties this decision depends on — a write creating two missing directory levels, successive writes leaving one file with the last content, and `0o600` on the replacement.
