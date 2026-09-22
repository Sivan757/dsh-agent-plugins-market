# Agent Note: The delegation contract ships with the role catalog

Status: implemented

## Problem

The injected catalog carried three different things in one message: the role list, the mechanics of calling `subagent_run`, and no statement at all about what to do with a result. The catalog message is dynamic. It is re-published whenever the role set changes, removed from the prompt when its message leaves the visible surface, and re-published when compaction hides it, so static operating guidance stored there is re-sent at every change and has no fixed position in the request.

A survey of this machine's session logs (598 logs, delegations deduplicated by child session) found 393 unique delegations: 351 through the host's `subagent`, 29 through `subagent_run` in 6 sessions, and 13 through `subagent_fork`. Every `subagent_run` call succeeded, and 28 of 29 prompts were already complete briefings with paths and expected output, so briefing quality is not where the contract failed. What the survey does show is what the guidance never addressed:

- One parent read, presented and `curl`-verified a 34-line file that predated the delegation, delivered it, and ended its turn before the child had written anything; the settlement notice arrived mid-way through its next turn. The rule the catalog lacked is that nothing depending on a child can be delivered before its notice arrives.
- Parents repeatedly overturned child assertions by checking the files themselves: a cost estimate that was wrong by an order of magnitude, a reviewer inference disproved against a prior commit, a credentials objection that did not hold.
- Two children described their own configuration in their final replies and both descriptions were wrong; the parent had to read the child transcripts to establish that the persona had in fact been installed. A child cannot observe how its role instructions were installed.
- Three coordination defects appeared in the one session that fanned out 21 role children: a child whose shell defaulted to the main checkout instead of the worktree it was told to use, a stray untracked file left in a slice the child did not own, and an out-of-boundary edit to another agent's file that needed a correction message.
- Children that asked their parent a question mid-run were never answered: four such requests in the survey, none answered while the child ran, each child falling back on its own judgment. The runtime's return guidance tells a child to report before finishing, and 58% of settled children did message their parent first, but nothing states that a running question is unanswered.

The role lines also carried a configured route the model does not act on, and the change digest included `title`, which the model never reads, so renaming a display title alone re-published the whole catalog.

## Decision

The catalog publishes the role list and the operating contract together, organized the way Claude Code organizes its agent tool prompt, in three sections: usage notes, writing the prompt, and when not to use a role child. The contract arrives with the names it governs, and a complete replacement re-states it rather than leaving a prior version to be inferred.

The text is built from module constants in `src/runtime/subagent-catalog.ts` and injected through the durable `subagent-catalog` source. It is fixed English and never consults the host translator, so the contract cannot vary with an operator's interface language; `src/runtime/host-locale.ts` now carries only the strings a person reads. Role lines use the host skill catalog's backticked form, ``- `name`: description``, so a line carries a callable name and the description that says when to use it. The configured route is no longer published; it stays in the durable entries for execution and change detection.

The host's general delegation tools are named where the model needs them, not arbitrated between here: the tool description points at them when no listed role matches, and each describes its own background behavior, parameters and limits. The catalog therefore does not repeat their inventory or their selection order.

The tool is `subagent_role`, and its parameter surface matches the host's `subagent` tool apart from the first parameter: `agent` names the catalog role where the host takes a display `description`; `prompt`, `provider`, `model`, `reasoning_effort` and `run_in_background` keep the host's names and semantics. A call-side `provider` + `model` pair overrides the card's route and starts from the selected model's default effort; with no call-side route the card's route applies, and with neither the child inherits the parent route. Omitting `run_in_background` returns `{ kind: 'continuable', subagentId }` from `startContinuable`; `true` registers the same child with the host `jobs` registry through `ctx.get('jobs')` and returns `{ kind: 'background', jobId }` for `job_output` and `job_kill`; `false` runs it once through the host's one-shot `start` and returns `{ kind: 'foreground', runId, output }`. The job channel fails loudly with the two packages to load when no registry serves the caller, rather than silently degrading to another channel.

The guidance states the exact-name rule, the briefing a child needs, that a question asked mid-run goes unanswered so the prompt must cover everything and the child must decide and report the gap, that the parent spends the wait on independent work, the no-prediction rule, the report rule, the duplicate-work rule, and the per-child worktree and file boundaries for concurrent children. The tool description in `src/runtime/agent-role-router.ts` stays short and carries what the model needs even when the catalog is not in view: what a child is, that the call returns an id without waiting, that the child runs for minutes so the parent should keep working, that nothing depending on the reply can be delivered before the settlement notice arrives, that the reply must be verified against the files and relayed to the user, and that a general delegation channel is the path when no listed role matches.

Change detection covers the name, the durable role id, the description and the configured route. The role title is durable identity metadata that never reaches the model, so it is no longer part of the digest: renaming a title alone leaves the published catalog accurate.

An interaction survey of the same corpus (598 logs, deduplicated) reconstructed what parents actually did: 147 of 157 delegation turns kept calling tools after the launch instead of waiting, 93 turns fanned out two or more children, and 364 of 377 settlement notices landed while the parent was mid-turn, none left unread. Children return results on their own — 58% of settled children messaged the parent before settling — and parents rarely interrupt, never answering a running child's question. The guidance therefore pushes work into the wait and treats the settlement as the point where a result becomes usable, and the two omissions it fixes are the unanswered mid-run question and fork's nested-parent behavior.

## Alternatives considered

**Keep the operating guidance in the tool description alone.** Rejected: a catalog message then arrives on its own, and the model reads a list of roles without the rules that govern them when the tool description is not in view.

**Move the role list into the tool description.** Not possible here: `defineTool` fixes the description when the tool is registered, and roles change while the session runs, which is exactly why the catalog is a durable injected message.

**Inject nothing and let the tool description carry everything.** Rejected: the model would never learn which roles exist, and a role name is not guessable.

**Keep the digest over every entry field.** Rejected: re-publishing the catalog because a display title changed spends a message and a full replacement to say nothing different.

**Add a generic child for work no role matches.** Rejected: the host already ships `subagent` and `subagent_fork`, and the survey counted 351 delegations through `subagent` against 29 through `subagent_run`. Naming the host tools in the guidance is cheaper than a second spawner.

**Publish the delegation-channel inventory and its selection order in the catalog.** Rejected: each host delegation tool already describes its own background behavior, parameters and limits, so the catalog would be maintaining a second copy of another package's contract. It keeps the rule only it can state — no listed role means a general channel, not a similarly named role.

**Constrain re-delegation through the `prompt` parameter.** Rejected by the owner: the depth limit is the host's to enforce, and turning every briefing into a policy notice about the child's own tools spends the parent's attention on a rule the runtime already holds.

**Keep the catalog text in the host locale dictionary.** Rejected: a contract that changes with an operator's interface language cannot be reasoned about once, and the harness's own tool descriptions are English, so the catalog now reads as one text with them.

## Consequences

- The catalog message carries the role list plus the operating contract, so it costs more to inject and every replacement re-states the contract.
- The contract sits where the model is already looking when it considers delegating, and a replacement never separates the names from the rules.
- The trade for that length is a short tool description: the mechanics and the general-channel fallback stay there in every request, and the guidance arrives with the names.
- Removing the channel inventory drops the catalog's dependency on another package's tool set and parameter names; what it gives up is naming the host's general channels in one place, which each tool's own description already covers.
- The fixed English text makes the contract one artifact rather than two, and it means the catalog no longer appears in the host locale dictionary at all.
- The observed behaviors now have explicit instructions, including the two the runtime's own return guidance leaves out: a mid-run question is unanswered, and `subagent_fork` starts fresh under a nested parent. Whether a model follows them is a separate question from whether they exist; the test suite pins the wording, not the behavior.
- The survey's own limits bound this decision: it records tool traffic, not context occupancy or cost, so it can show that a parent shipped a stale artifact and cannot show that delegation saved tokens. Deduplicated, its 393 delegations still put the 29 role calls in 6 sessions, so per-role rates stay anecdotal.
- Renaming a card title no longer re-publishes the catalog.
- A task with no matching role is no longer steered away from delegation: the catalog says to use a general channel, and the tool description names the general path.

## Testing

`tests/subagent-catalog.test.ts` asserts the escaped role line carries a name and a description and no route, that a description or route change re-publishes while a title rename does not, that two renders under different host locales are byte-identical, that the three guidance sections and the mid-run question rule are present, and that the removed channel inventory stays out. `tests/host-locale.test.ts` asserts the interface strings translate in both languages and that the model-facing catalog is no longer part of that dictionary. `tests/agent-role-router.test.ts` asserts the registered `subagent_role` parameter surface, call-over-card route precedence, the continuable request shape, the job registration and its cancellation, the loud refusal without a registry, and the foreground path's output and disposal.

## Related decisions

Extends [durable subagent catalog and role execution](2026-09-09-subagent-catalog.md) and [agent role delegation over the host continuation seam](2026-09-10-agent-role-delegation-via-host-continuation.md): catalog durability, role identity, strict parsing and continuable delegation remain in force; where the operating contract lives and what the digest covers change here.
