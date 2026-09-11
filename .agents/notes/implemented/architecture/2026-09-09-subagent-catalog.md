# Agent Note: Durable subagent catalog and role execution

Status: implemented

## Problem

Role definitions were exposed as skill candidates and slash commands with generated `agent-` and `persona-` names. This mixed role delegation with instruction loading and duplicated discovery through `market_agent` list actions. Role reasoning effort was not passed to the child.

## Decision

`runtime/subagent-catalog.ts` follows the existing DSH `tool-skill` catalog algorithm: an asynchronous `agent/pre-step` listener, exact tool visibility, stable entry digests, complete replacement messages, durable `source.entries`, and recovery through the visible session surface. It uses its own `subagent-catalog` source kind and bilingual role-specific guidance. Empty removals invalidate older directories; incomplete reads do not publish partial snapshots. A disposer prevents late publication after teardown.

`subagent_run(agent, prompt)` replaces `market_agent` without an old-name alias or an `action` parameter. Catalog summaries and execution share strict role parsing. The executor resolves provider/model and optional `reasoning_effort` (`reasoningEffort` alias), validates the effective route through `llm.resolveCallConfig`, then calls the existing one-shot `spawn` service with persona and tool restrictions. The parent's latest request configuration owns inherited values; an omitted effort follows the parent only on an unchanged route. Host runtime policy remains authoritative.

**Partially superseded by [agent role delegation over the host continuation seam](2026-09-10-agent-role-delegation-via-host-continuation.md).** Catalog publication, role identity and strict parsing remain in force. Delegation is now continuable and asynchronous rather than one-shot; the executor applies only an exact `provider` + `model` pair and degrades every other declaration to inheritance; and `tools` / `disallowedTools` are no longer applied.

Suite/project roles and user personas leave both skill providers and role-generated slash commands. Their management panels and files remain. Qualified role IDs preserve both `reviewer.md` and `reviewer.agent.md`; generated alias collision rules no longer apply. Ordinary skills and commands with those prefixes remain normal resources. Project discovery remains tied to the calling session and its scan switch.

This partially supersedes the role-as-skill decision in [user panels](../feature/2026-09-06-workspace-tabs-user-panels.md) and the alias projection in [layout registry](2026-09-09-layout-registry.md). Their storage, UI and project-scope decisions remain in force. The existing `dsh-llm` development dependency is also declared as a runtime peer to reuse the host's immutable message constructor; no new package or host edit is needed.

## Alternatives considered

**Use dynamic system-prompt context.** DSH supports it, but the user explicitly requested the skills catalog mechanism, including its durable catalog source and pre-step admission.

**Keep role skills or a list action.** This preserves duplicate discovery and makes the model choose between loading a persona and delegating to one.

**Use the generic subagent tool directly.** It has no role-ID lookup that applies the role's saved configuration. The role-aware executor remains necessary.

## Consequences

The role editor exposes a reasoning-effort selector backed by exact-model `resolveModelInfo`, through the existing model-catalog endpoint. Provider/model selection clears the previous effort; unavailable saved values remain selectable and removable. Edits canonicalize the snake_case key without retaining a conflicting alias. The host's advertised levels define the options; no fixed cross-provider effort list is invented.

Existing callers must move to `subagent_run` and remove `action`; newly composed sessions have no generated role slash entries. Changed summaries or model metadata publish at the next model step; ongoing requests and children retain their accepted configuration. Full persona bodies are loaded only for execution. The catalog is durable context, not hidden data. External discovery uses existing TTL/refresh behavior, without a file watcher. Background continuation was outside this change and is now owned by [agent role delegation over the host continuation seam](2026-09-10-agent-role-delegation-via-host-continuation.md).

Tests use real DSH session, scope and tool registries for publication, restore, fork, compaction, restrictions, replacement-tool identity and disposal; real files exercise user/suite/project changes. Executor tests cover model routing, effort aliases, current-request inheritance, invalid effort preflight and cancellation before child creation. The host repository remains read-only.
