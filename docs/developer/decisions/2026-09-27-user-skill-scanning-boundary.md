# User skill scanning stays in the plugin's panel provider

## Status

Accepted, implemented as "no change" — the scanning provider, the panel store, and the parity parse stay as shipped. The [reuse audit](../../scratch/reuse-audit/host-capability-matrix.md) carries this overlap as its one open "needs a decision" item; this page closes it as decided-not-duplicated.

## Context

The plugin serves the user's own skills from `~/.agents/skills` through its panel stack, and the harness serves the same directory through its own provider:

- The user skills panel persists Markdown documents under the Agent layout root and projects them into `ctx.skills` through `UserPanelSkillProvider` (`packages/market-runtime/src/runtime/panels/user-panels.ts`, registered in `packages/market-bundle/src/index.ts`) at rank 440 — below the suite provider's user rank (450, `packages/market-runtime/src/runtime/surfaces/skills-provider.ts`) and above the harness reader of the same directory. The panel owns Web CRUD over the documents, per-entry diagnostics that mirror the harness reader's acceptance rules (`skillEntryRejection` in `packages/market-catalog/src/scanning/skills-parse.ts`), and the enable switch, which writes the harness's own invocation pair (`setSkillInvocationEnabled` in `packages/market-ui/src/ui/frontmatter.ts`). The documents' file-backed persistence is a settled matter ([ADR 2026-09-13](2026-09-13-plugin-persistence-stays-file-backed.md)); this decision covers only who scans and serves the directory into the registry.
- `@deepseek-ai/dsh-skill-filesystem` (published at the 0.1.7-rc.2 baseline) maps `<agentsHome>/skills` as its `user-agents` root at rank 500, parses the same frontmatter vocabulary (`name`, `description`, `whenToUse`, `disable-model-invocation`, `user-invocable`, failing closed on bad values), watches the roots, and loads bodies on demand.

The overlap is real but currently harmless: the skill registry resolves duplicate names within a layer by rank, so a name present in both catalogs is served by the panel's candidate (`tests/user-panels.test.ts` pins the panel's rank below 500), and every other name each side finds is served normally. Which provider wins is deterministic and host-owned.

Deployment shapes differ, and that asymmetry drives this decision. The harness base bundle mounts the filesystem provider, but the registry's contract is provider composition — `ctx.skills` accepts any set of providers — and the plugin requires only the registry services, not any specific provider beside it. Which implementations scan which roots is the deployment's choice, not something this plugin can declare as a peer dependency.

## Decision

The plugin keeps scanning `~/.agents/skills`. The boundary, in one sentence: **the panel is the authoring and control surface for the user-agents root and projects it into the registry; the host filesystem provider is the discovery implementation for every root this plugin does not present — project, custom, user-dsh, and bundled.** The plugin registers no provider for those roots, and the host provider keeps scanning the user root unmodified; the registry's rank order remains the arbitration for the one directory both read.

Why the host provider cannot take over the user root for this plugin, in order of weight:

1. **The panel's value must not depend on deployment composition.** Retiring the scan makes every panel capability conditional on a row the deployment may not mount: without the host provider there are no catalog entries to edit against, so in exactly the compositions where a user needs the panel most — a minimal profile that ships no filesystem provider — the panel degrades to a detached editor. The plugin already hard-requires `ctx.skills`; serving one small root through its own provider is what keeps the feature deployment-independent.
2. **The surface is write-shaped, and the host provider is read-only by contract.** CRUD, name-precedence resolution for addressing entries, fail-closed diagnostics phrased as the reader's own rejections, and the off switch are the panel; discovery is the only part `dsh-skill-filesystem` could absorb. Swapping that one part for a mount-dependent copy does not remove a line of the panel — it removes the only line the plugin could remove while keeping the rest, and adds a second state space (provider present/absent) to every panel behavior.
3. **Retiring the scan buys almost nothing.** The duplicated work is one shallow top-level readdir of one small directory per catalog collect; bodies load on demand in both providers, and the registry caches merged collects and invalidates them through the same `SkillProviderControl.invalidate` primitive both sides already use — panel CRUD via `notifyPanelsChanged` (`packages/market-bundle/src/application/catalog.ts`) running the change pipeline, host-side hand edits via the provider's built-in watcher. The watcher is the one capability the plugin genuinely lacks, and it is the cheapest to lack: the panel is not a change consumer, it is the change producer.
4. **The vocabulary drift the overlap threatened has already been paid down.** The switch writes the harness invocation pair and drops the panel-era `disabled` key, `skillEntryRejection` mirrors the published reader's acceptance rules, and the rank lattice is pinned by tests. The remaining overlap is one directory scanned twice, not two grammars.

This is not a duplicate under the reuse rule: the host's capability is discovery of roots nobody edits through this plugin, and the panel's capability is authoring and control of the one root it does present. The scan rides along because the panel must project what it serves; it is not a second implementation of the host's scanner.

## Consequences

- **The double scan stays, with bounded cost.** One shallow readdir per collect against a user-scale directory; no body reads, no watching, no caching beyond what the registry already does for every provider.
- **Grammar parity is a standing obligation.** `skillEntryRejection` must keep mirroring the published reader: when the host makes an additional frontmatter key load-bearing for discovery or tightens an existing rule, the change that notices extends the mirror in the same PR — an entry the harness reader would drop must not publish as enabled (validation fails closed).
- **The rank lattice is a contract to maintain.** Panel 440 < suite-user 450 < host user-agents 500, and suite-project 250 between the host project roots (100/200) and custom (300), is what makes the coexistence deterministic. A host renumber or an arbitration change in the registry triggers the revisit clause below.
- **The off state stays portable.** The switch writes `disable-model-invocation: true` plus `user-invocable: false` and removes `disabled`, so the off state lives in the file and every reader of the directory agrees on it; a `disabled: true` document left by an older release still reads as off in the panel and migrates on the first toggle.
- **Reuse-ledger registration.** The boundary is registered in [the reuse manifest](../../reference/reuse-manifest.md) as a `self-built` row for `packages/market-runtime/src/runtime/panels/user-panels.ts` whose decision record points at this ADR — keeping the counterpart cell free text (the `dsh-skill-filesystem` user-agents root), since the gate's export-pattern rules cannot resolve a package this plugin does not declare; with the reader-mirror `packages/market-catalog/src/scanning/skills-parse.ts` covered by the manifest's existing frontmatter row. Nothing enters `wait-host`: the panel is not waiting on any host export.

## Considered options

- **Retire the scan, keep the panel as editor and switch mapped onto the host provider's catalog — rejected.** Reasons 1 and 2 above: the panel would stop working in provider-less compositions, and the scan is the only piece the swap removes while the write-shaped panel stays.
- **Retire the panel, keep only the host reader — rejected.** Deletes the only Web CRUD and per-entry diagnostics this directory has, a user-facing regression with no replacement upstream.
- **Hybrid: use the host provider when mounted, fall back to the plugin scan otherwise — rejected.** A runtime branch on deployment composition doubles the states every panel behavior must be tested in, and the rank-based coexistence already yields the deterministic outcome the branch would try to buy.
- **Keep the scan but write the panel's own `disabled` key — rejected, and already superseded.** Shipped behavior writes the harness invocation pair; a plugin-private key would recreate the vocabulary drift this decision treats as paid down.
- **Ask deployments to silence the host's user root (`includeDefaultRoots: false`) to remove the overlap — rejected.** The plugin does not own the host's bundle row, and muting the root for the whole deployment trades away other consumers of the user root (slash-invocable user skills outside market sessions) to tidy a benign overlap.

## Revisit when

- The harness ships a maintained authoring or editing surface for the user-agents root; re-evaluate whether the panel should retire onto it.
- The host changes what discovery accepts (new load-bearing frontmatter, tighter rules) — that change extends `skillEntryRejection`; if the panel's projection can no longer mirror the reader cheaply, re-make this decision.
- The host renumbers the user root's rank or changes within-layer name arbitration (layers, nearest-layer-wins); re-check the 440/450 ordering and the pins in `tests/user-panels.test.ts`.
- The user root moves or changes shape away from the shared Agent layout premise (`$DSH_AGENTS_HOME`/`~/.agents`, top-level `<name>.md` and `<name>/SKILL.md`); the two-scanners-one-directory premise fails and this decision must be re-made.
- The harness turns serving the user root through the filesystem provider from composition into contract; the deployment-independence argument collapses and the scan should retire.
