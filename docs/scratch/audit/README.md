# Repeating cleanup cadence

The audit that runs before each release, and the process that turns its output into merged fixes. This directory holds one report per axis per pass.

## The five axes

Each axis has a skill and a question it answers. Run all five per pass, because they find different things.

| Axis           | Skill                      | Question                                                                         |
| -------------- | -------------------------- | -------------------------------------------------------------------------------- |
| Architecture   | `dsh-code-review`          | Is one responsibility owned twice, and does any module reach past its neighbour? |
| Performance    | `dsh-speed-up-perf`        | What work does the plugin do that it need not do?                                |
| Simplification | `dsh-find-simplifications` | What costs more to keep than to delete?                                          |
| Security       | `security-and-hardening`   | Can an untrusted path, a route, a hook or an injected string misbehave?          |
| Tests          | `dsh-ci-test-reliability`  | Which test asserts nothing, and which one is flaky by construction?              |

## The pass

1. Run the gates first. A red gate is worth more than any report: `pnpm run typecheck`, `lint`, `format:check`, `test`, `check:architecture`, `check:doc-links`, `check:reuse`, `check:host-alignment`.

   There is no `duplication` gate in this repository, and that is a real gap: the simplification pass found five byte-identical copies of the same route plumbing and a dead write path, neither of which any gate would have caught. A duplication gate and a dead-export gate are the two additions that would make the next pass cheaper. Neither exists yet, and the dead-export gate cannot land until the branches that delete today's dead exports merge.

2. Run each axis as an independent read-only reviewer, one report per axis under `pass-<date>/`. Each report ranks by the cost of NOT fixing.
3. Consolidate into one backlog. Drop anything a report did not evidence with `file:line`. Merge duplicates across axes, keeping the entry with the strongest evidence.
4. Land the backlog in waves, one axis per pull request, so a regression is attributable to one change.
5. Give every wave an independent reviewer before it merges. The reviewer sees the diff, not the author's reasoning.
6. Re-run the gates on the merged result. A wave that does not close its own entries does not count as done.

## What a finding must carry

A finding without these is a wish, not a finding.

- `file:line` for the thing, and for any second owner of the same responsibility.
- The evidence it is real: a caller search, a measurement, a reproduction, or the gate that should have caught it and did not.
- The smallest repair.
- The cost of leaving it, in the reader's terms.

## What is deliberately not audited

These were checked and are correct. Proposing them again wastes a pass.

- A `##` heading with no `#` parent outside the system prompt is shipped reference behaviour, so it is not drift.
- The plugin does not assert `IMPORTANT:` precedence. The host states scope once, hedged, for the same content in the same request, and a stronger claim beside it would contradict it.
- MCP tool descriptions pass through unchanged, which is what the host does with them too.

See `docs/scratch/prompt-research/corrections.md` for the prompt-side reasoning behind the last two.
