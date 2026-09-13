# Agent Note: injected session context carries no plugin decorator

Status: implemented

## Problem

Text this plugin puts in front of a host session carried packaging the author of that text never wrote. A forwarded suite command arrived as `[Agent Plugins 命令 /{command}（来自 {sourceId}/{suiteId}）]`, a blank line, then the authored template; its user-panel twin arrived behind `[用户快捷命令 /{command}]`. Skill catalog entries were prefixed in the same spirit: `[{suiteName}] ` for a suite skill and `[用户技能] ` for a user-panel one. The catalog line is the text the harness renders into the model's `<available_skills>` block, so those prefixes were model-facing prose.

Two costs. The suite token came from `qualifiedSuiteId()`, whose value is the registry's `{sourceId}/{suiteId}` spelling — an internal identifier rather than a name a reader recognizes, injected into the model's context and into the receipt the slash invocation shows the user. And every forwarded command paid a title line and a blank line for provenance the session log already records structurally: the follow-up carries `source: { kind: 'plugin', plugin: 'dsh-agent-plugins-market' }`.

The decorator was the last survivor of a wider pattern. Agent definitions once entered context wrapped in a `## 子代理定义（来自 Agent Plugins …，Claude Code agents 格式）` header beside an `agent_plugins` inventory tool; both were replaced by the [durable subagent catalog](../architecture/2026-09-09-subagent-catalog.md), whose role lines are a name, a description and any saved route. Commands kept the same header shape after their neighbours lost it.

## Decision

Session-facing text is the author's text. A command forward is the template with `$ARGUMENTS` substituted and nothing around it, for a suite command and a user-panel command alike. A skill candidate carries the skill's own `description`, and a user-panel skill carries its entry's description. Provenance stays structural: the follow-up's `source`, the `mcp__<suiteId>__<serverKey>__<tool>` tool name, and the `agent-plugins:instructions` prompt-section name all identify origin without spending model context.

Five keys left the host dictionary: `commandForwardTitle`, `userCommandForwardTitle`, `userSkillDescription`, and `subagentCatalogInherit` / `subagentCatalogDefaultEffort`, which no longer had a call site. The receipt the invocation UI shows lost its `（{suite}）` suffix, which made it identical to its user-command sibling, so the two collapsed into `commandAcknowledged`. `UserPanelSkillProvider` lost its translator parameter along with the prefix it rendered.

## Where the line falls

Text only the host's own UI reads may name its source: the slash-menu registration description stays `[{suiteName}] {description}` for a suite command and `[用户命令] {description}` for a user entry, because the palette has no source column and the display name there is the manifest name, not an id. Panel copy in `src/client/locales.ts` is unaffected.

`report_market_issue` remains the deliberate exception: its tool description names the repository it files against, which is what makes the tool callable for the right problem.

## Alternatives considered

**Drop the plugin name from the header and keep the suite name.** The suite token is still packaging we add, and still an internal id; a reader learns nothing from it that the slash entry they typed did not already show.

**Keep a human-readable suite name as provenance for the model.** The model does not route by origin, and the suite already names itself on its own market panel. Paying a prefix on every catalog entry to restate it is the redundancy this note removes.

**Keep `[用户技能]` / `[{suiteName}]` so the model can tell which skills came from the marketplace.** Both providers rank and dedupe by name, so the catalog's names are already unique; the label discriminates nothing.

**Trim the forwarded template's trailing newline.** The body is the author's file verbatim; removing whitespace alters their text without changing what the model does with it.

## Consequences

The model sees the command template alone and the author's own skill descriptions. The cost is that the skill catalog no longer says which suite a skill came from — that fact lives in the market UI and the slash menu, not in the model's context.

Five locale keys, one constructor parameter, and two decorator emissions are gone from the runtime, and the invocation receipt no longer prints an internal suite id. The rule is review-enforced rather than gated: nothing in the type system stops a future injection path from adding a label, so a reviewer reading a new `t(...)` call in `src/runtime/` is what holds the line.

## Testing

`tests/mcp-mounts.test.ts` asserts a suite forward equals the authored template with `$ARGUMENTS` substituted, byte-exact including the fixture file's trailing newline, and `tests/user-commands.test.ts` asserts the same for a user-panel command while pinning that the entry's own `description` reaches the slash menu. `tests/skills-provider.test.ts` and `tests/native-project.test.ts` assert a suite skill candidate's description is the author's, `tests/user-panels.test.ts` does the same for a user entry, and `tests/host-locale.test.ts` pins the receipt without a suite. Re-adding a decorator makes the two forward assertions fail on the leading title line.

## Related

[User-facing copy omits decisions and unrequested hints](../process/2026-09-11-user-facing-copy-omits-decisions.md) governs the human-facing text of the same plugin and applies the same principle to a different audience; this note covers what a session's model reads. [The durable subagent catalog](../architecture/2026-09-09-subagent-catalog.md) is the surface that had already dropped its decorator.
