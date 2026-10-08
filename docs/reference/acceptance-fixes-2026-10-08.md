# Acceptance fixes, 2026-10-08

## Scope

This round starts at 26f1649. It addresses the four reported acceptance findings. The settings page remains the visual reference. No host code changes.

## Shared presentation

The manager and settings used different tab containers. ResourceTabs now owns one equal-column, non-scrolling policy. Both surfaces retain the host keyboard behavior. Shared card helpers own identity, owner tags, count separators and warnings. HookResourceCard serves both surfaces. The existing detail components and fixed frame already serve both surfaces.

The manager no longer shows the introductory hint, duplicate count summary, Help action or automatic guide. Save failures retain retry and discard actions.

## Hook details

Settings cards had no detail action. Manager cards addressed the whole suite. The inventory now carries each Hook declaration. Both surfaces open HookDetailModal with the complete command, matcher, timeout, provenance and support information. Rejected declarations show diagnostics without inventing a command.

Browser acceptance found duplicate Hook identities in the settings overview. The catalog already includes the synthetic user-Hooks suite. Appending it again doubled the rows. The overview now uses one owner.

A disabled shared Hook card initially still handled card clicks. The regression now checks click, Enter and the independent detail action.

## Next-user-turn selection

Running sessions accept selection changes as durable intent. The current turn keeps its committed resources. Editing the selected or requested preset targets only the initiating session. Other sessions keep their copies.

The published host assembles tools before pre-step listeners. Applying registrations inside that listener would mix new authorization with old tools. At a safe boundary, the existing transaction commits the intent. A racing next request is parked with its identity intact and retried after idle promotion. A mid-turn steer is not a new turn and never takes that path.

Requests and promotion share a per-agent queue. Stale revisions reject. The public selectionRevision token stays separate from sequential binding revisions. Its optional durable requestRevision field survives promotion and reload. Forks start their own token sequence. Interrupted transactions retain explicit recovery.

Review reproduced and repaired mid-turn steer interruption, concurrent intent loss, missed idle promotion and public revision regression.

Live acceptance also found metadata-only UserPromptSubmit calls. Hooks now accept only authored user messages. Persisted intent is synchronously removed from pending input after its insertion is recorded. This preserves durable replay and the natural turn-stopping boundary. The ordinary queued-request regression now records exactly two completed turns and two model requests. An interrupted-boundary race retains the guarded idle fallback.

## Verification

The [standing gate](acceptance-2026-10-08-evidence/gates.txt) passes. The [affected regression run](acceptance-2026-10-08-evidence/tests.txt) passes 77 files and 621 tests. It includes all client tests and affected runtime tests. The entire repository suite was not repeated in this round.

[Live runtime acceptance](acceptance-2026-10-08-evidence/runtime.json) used the built plugin in an isolated DSH profile. Two queued user requests produced two chat calls. The separate title call belongs to DSH. The first request retained its selection while the preset changed twice. The second used the updated preset. The prompt Hook ran once, and two declarations produced two unique rows. The durable log contains exactly two completed turns with two steps.

[Settings measurements](acceptance-2026-10-08-evidence/settings-layout.json) report width and scrollWidth of 564px. All seven Chinese labels fit. [Manager measurements](acceptance-2026-10-08-evidence/manager-layout.json) report 752px for both values, with no marked hint text. Both use overflow hidden on the shared row. Browser inspection opened individual Hook details from both surfaces. The final console query returned no warning or error.

The earlier hypothesis that the host never emits turn-stopping was false. Pending intent metadata prevented that boundary in our fixture. Recording and withdrawing that metadata fixed the cause. The guarded idle fallback remains for cancellation and boundary races.

The tests use published host packages and a local mock model. They do not establish remote-provider reliability or Windows execution. Unrelated staged design deletions are outside this change.
