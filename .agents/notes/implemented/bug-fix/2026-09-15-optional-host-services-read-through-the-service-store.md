# Agent Note: optional host services are read through the service store

Status: implemented

## Problem

Suite skills and slash commands failed to load with `cannot get property "shell" without inject`, and the feedback tool failed to register with the same error for `tools`. One idiom caused all three.

Cordis resolves `ctx.<name>` by walking the reading fiber's **ancestors** and returning the first ancestor whose store holds the name. A service that a _sibling_ fiber provides is invisible to that walk, which ends at the root and throws. The host provides `shell` (the bash sandbox) and `tools` (the tool registry) from sibling fibers, so these reads threw wherever they ran:

- `src/index.ts` resolved the shell seam as `(ctx as unknown as { shell?: ShellSeam }).shell` on the entry fiber, whose `inject` is `['skills','commands']` — the path behind `SuiteSkillProvider.get()`, so every market-provided skill body.
- `src/runtime/commands-mounts.ts` resolved the same seam as `(this.ctx as unknown as { shell?: ShellSeam }).shell`, on the entry fiber and on the project mount's own `['commands']` scope — the path behind every suite slash command, before the body's placeholders were even examined.
- `src/runtime/feedback-tool.ts` read `(hostCtx as unknown as ToolsHost).tools` on the entry fiber. `syncFeedbackTool` contains the throw, so instead of the intended "the host exposes no tools registry" line the log carried `feedback tool mount failed: cannot get property "tools" without inject` on every settings sync, and `report_market_issue` never registered.

The tests missed all three for the same reason: they handed the reading code a **plain object** with the service hung on it. A plain object has no proxy trap, so `stub.shell` reads `undefined` — or works — where the mounted plugin throws. `tests/plugin-apply.test.ts` stated the mistake outright, describing its stub as "the plugin context exposes the tools service directly, like the host's service proxy does", which is what the proxy deliberately does not do for a service the fiber does not inject.

The rule itself was already written down twice — `docs/reference/dsh-plugin-development-standard.md` §2.2 and the timer paragraph of [the settings note](../../implemented/architecture/2026-09-13-settings-and-card-ride-the-host.md). What was missing was a test that could fail.

## Decision

**An optional host service is read through the service store, from one resolver per service.**

`ctx.get(name)` reads the global isolate-keyed store instead of the ancestor walk, answers `undefined` when the profile provides no such service, and stays strict about the provider's active state. `inject` remains for hard dependencies only.

- `shellSeamOf(ctx)` in `src/runtime/dynamic-context.ts` is the single place that resolves the shell seam; the entry and `CommandMountRegistry` both call it.
- `toolsServiceOf(ctx)` in `src/runtime/tool-registry-observer.ts`, which already read `tools` this way for the MCP status surface, now backs `mountFeedbackTool` as well.
- `seatOf(ctx)` in `src/runtime/timer-seat.ts` followed the pattern first, and is what the settings note recorded.

**The topology is tested, not the function under test.** `tests/host-service-seam.test.ts` mounts a real Cordis tree in which `shell`, `tools`, `skills` and `commands` each come from a fiber that is a sibling of the reader, then drives the three production paths: the entry's registered skill provider loading a body that carries a `` !`cmd` `` placeholder, `CommandMountRegistry` forwarding an injected command body, and `mountFeedbackTool` registering on the tools service. Each run also pins the trap itself — a property read on the same fiber throws `without inject` — so the reason the service-store read exists cannot decay. The entry case mounts a plugin object built from the entry's own exported `name`, `inject` and `apply`, so a service added to that list, or read as a property without being added, is exercised the way the loader runs it.

**Hand-built context stubs resolve services through `get`.** `tests/dynamic-context.test.ts`, `tests/mcp-mounts.test.ts`, `tests/plugin-variables.test.ts`, `tests/project-commands.test.ts` and `tests/plugin-apply.test.ts` were updated: a stub that hangs a service on the object is a stub that cannot fail the way the host fails.

## Alternatives considered

**Static enforcement — a lint rule or check script banning `(ctx as unknown as { <service> }).<service>`.** Rejected: it would not have caught the feedback-tool instance, which assigns the cast to a local (`const host = hostCtx as unknown as ToolsHost`) and reads through the variable, so catching it needs flow analysis rather than a selector. It also cannot separate an injected read from an uninjected one without modelling `inject`; the legitimate sites (`src/index.ts` reads `tools` inside an `inject(['tools'])` scope, the suite-instruction mount reads `systemPrompt` on the scope it injected) would each need an annotation, and the assignment shape evades the check anyway. The fiber-tree test fails closed instead, and fails with the production error string.

**Declare `shell` and `tools` in `inject`.** Rejected: the market has to load on a profile that provides neither, and `inject` gates activation — the plugin would not start at all. Both are optional by design, which is why they resolve lazily.

**Reuse the host's `internal/get` waterfall or `ctx.reflect.get`.** Rejected: the harness installs no interceptor for `internal/get`, and `ctx.reflect.get` is the reflection service's own internal method. `ctx.get` is the documented optional-read surface.

## Consequences

Suite skills and commands load again, dynamic context included, and the feedback tool registers. Each read is one call, and the ancestor-walk trap is documented at the resolver rather than at each call site. `src/runtime/feedback-tool.ts` drops its `ToolsHost` wrapper: it takes the registry slice straight from `toolsServiceOf`.

The rest of `src/**` reads services either where its fiber injects them (`tools`, `llm`, `subagents` and `agents` under `ctx.inject`, `webServer` and `loader` under their own, `commands` on both the entry and the project scope, `systemPrompt` on the suite-instruction scope) or through `ctx.get` (`credentials` from the credentials store, `llm` in the model catalog, `timer` through the seat, `settings` through the locale source in `src/runtime/host-locale.ts`). One letter-violation remains in the browser half: `src/client/index.ts` reads `slots` off a child scope that injects only `settingsScope`; it resolves from the parent client-root fiber's store, so it works, and it belongs in that child's own `inject` the next time the file is touched.

Recorded rather than changed: the entry's `inject = ['skills','commands']` makes `commands` a hard gate while three paths treat it as optional (`CommandMountRegistry`'s "`ctx.commands` is not available in this profile" diagnostic, `UserCommandMountRegistry`, and the entry's own diagnostics). Those fallbacks are unreachable exactly when `commands` is absent. Moving the gate is an activation-semantics decision, not part of this fix.

Supersession: the timer paragraph of [the settings note](../../implemented/architecture/2026-09-13-settings-and-card-ride-the-host.md) records the same trap for the timer accessors. That note stays authoritative for the settings, card and timer decisions; neither note supersedes the other. [The host locale source note](2026-09-24-host-locale-source-read-and-lifetime.md) records the lifetime half of this rule for a read that resolves through `ctx.get` from module state, and does not supersede this one.

## Testing

`tests/host-service-seam.test.ts` is the regression gate: four cases over a real fiber tree whose services come from sibling fibers, covering the seam resolver, the command mount, the entry's skill provider and the feedback tool. Reverting any one of the three resolvers to a property read makes its case fail with `cannot get property "<service>" without inject`.

`tests/dynamic-context.test.ts` keeps the injection pass itself under test against a hand-made seam, now supplied through a stub whose `get` returns it. `tests/plugin-apply.test.ts` resolves `tools` through the stub's `get` only, so the entry-level assertions fail if the read goes back to a property.
