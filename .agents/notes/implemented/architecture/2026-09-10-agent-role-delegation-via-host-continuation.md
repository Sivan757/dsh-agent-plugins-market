# Agent Note: Agent role delegation over the host continuation seam

Status: implemented

## Problem

`subagents_run` carried its own copy of the host's child LLM routing: a bare-model-id resolver, a parent-option merge, a route-aware effort rule, an adapter preflight and synchronous result collection. It also applied each card's `tools` / `disallowedTools` as the host's `toolFilter`.

Measured against the real installed corpus (663 agent cards), none of that worked. Zero cards declare `provider`, so the bare-id resolver served nothing while rejecting 407 of them. Of the 556 cards declaring `tools`, 555 name Claude Code tools that the host's case-sensitive `tools.restrict()` rejects outright, so those delegations failed before a child existed. And the restriction that did run was leaky rather than protective: a card declaring `allow: ["write","read"]` produced a child holding five tools, because `subagent`, `list_agents` and `send_message` escaped it.

The host, meanwhile, owns the same capability properly: `ctx.subagents` exposes an exact route contract, a continuable lifecycle with durable resume, steering and settlement, and the shipped `subagent` tool reads a per-Session user authorization. Re-implementing a weaker copy beside it bought nothing.

## Decision

`subagent_run(agent, prompt)` is a thin role layer over the host continuation seam. It resolves a catalog role, applies the card body as the child persona, and starts a durable child with `ctx.subagents.startContinuable` on the `spawn` backend, returning `{ subagentId }` at inbox acceptance. It never waits for the result: the runtime delivers a `subagent-settled` notice carrying the outcome and closing message, `send_message` steers the child while it runs, and `list_agents` lists it.

Routing is exact-or-inherited. A card contributes child LLM options only when it declares **both** `provider` and `model`; that pair, plus any `reasoning_effort`, is validated once through `llm.resolveCallConfig` before the child starts. Every other declaration — a bare model id, a `provider/model` string, a Claude alias such as `sonnet`, a lone `provider`, an unsupported effort — is reported through the diagnostic sink and the child inherits the parent route. The bare-id resolver and the `provider/model` sugar are gone.

Tool filtering is gone entirely. `tools` and `disallowedTools` remain frontmatter that the raw editor preserves, but the executor never reads them, so a card can neither narrow nor widen its child's tool set. The role editor follows: it renders no control for a field with no effect, and instead warns whenever the stored routing declaration is one the executor would ignore.

The catalog advertises a route only for an exact `provider` + `model` pair, so it never promises a route the executor would degrade away. The tool keeps its hard depth cap of 3 and requires the host `agents`, `tools`, `llm`, `subagents` and session-persistence services.

## Alternatives considered

**Translate the Claude tool dialect and keep filtering.** Rejected: the mapping would have to invent semantics for 26 distinct Claude names plus parameterized forms (`Bash(git:*)`) and MCP namespaced names (`azure-mcp/*`), the allow list still leaked three delegation tools, and the field names belong to a different product's registry. A card whose tool list cannot be honored exactly is better served by the parent's tool set than by a guessed subset.

**Keep the bare-model-id resolver as a convenience.** Rejected: it served zero cards and rejected 407.

**Fail loud on an unresolvable route instead of degrading.** Rejected: two thirds of the corpus declares a model this deployment cannot resolve. Failing those calls would leave a catalog the model can see but never use, which is the defect this change exists to remove. Degradation is always reported, never silent.

**Keep synchronous foreground delegation.** Rejected by the owner, and the host's own design agrees: role work is long-running, and resume, steering and settlement already belong to the continuation manager. A synchronous executor had to own child disposal and stop-reason mapping that the host owns better.

**Adopt the host's `subagent-model-selection` allowlist for card routes.** Rejected: the host exempts config-owned routes — `assertAllowedModelSelection` returns early unless the model itself supplied route fields — so a card-declared route is the same class as `Config.agentOptions`. Gating it would add a second refusal path to cards that already fail, and the setting defaults off.

**Show role children in `list_agents` without making them continuable.** Not available: the listing tool drops every entry whose mode is not `continuable`. Continuable delegation is what makes them visible, so the async decision subsumes the visibility request.

## Consequences

- The split is now explicit: the host owns route authority, lifecycle, steering and settlement; this plugin owns the role registry, catalog publication and per-role persona.
- Session persistence becomes a hard requirement. The host's `startContinuable` throws `PERSISTENCE_UNAVAILABLE` without it, and the shipped profiles mount `session-persistence-jsonl` in the base bundle, so this is a declared dependency rather than a new deployment burden.
- 555 cards move from certain failure to running with the parent's tool set; the 328 that also declared an unresolvable model now inherit the parent route instead of aborting.
- Existing callers of `subagents_run(role=…)` break on all three axes: the tool name, the `agent` parameter, and the absence of an awaited result.
- What we gave up: frontmatter can no longer express per-role least privilege. A card that wants to be read-only cannot say so, and the child receives the parent's tool set.
- Tests pin strict parsing without tool fields, exact-route application through preflight, degradation with a diagnostic for every inexact declaration, cancellation raised during preflight, the `startContinuable` request shape (including the absence of `toolFilter`), `subagent_run` registration with an `agent` parameter, catalog entries that omit an inexact route, and the editor's ignored-route warning with no `tools` control.

## Related decisions

Partially supersedes [durable subagent catalog and role execution](2026-09-09-subagent-catalog.md): catalog publication, role identity and strict parsing remain in force; synchronous one-shot execution, tool filtering and internal route resolution do not. The harness decision this aligns with is recorded in `deepseek-harness` as model-selected subagent routes and user-authorized subagent model routes.
