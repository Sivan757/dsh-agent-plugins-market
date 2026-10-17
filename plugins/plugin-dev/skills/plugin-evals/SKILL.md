---
name: plugin-evals
description: Build and run an eval suite for a plugin — realistic prompts, graders, repeated runs, and a no-plugin baseline — and gate changes on the scores. Use when the user asks to "test my plugin", "write evals", "benchmark a plugin", "measure whether a skill triggers", or before shipping plugin changes.
---

# Plugin Evals

Measure what a plugin reliably does. A case is a realistic prompt plus one or more graders — pass/fail checks on the final reply, the transcript, tool calls, or created files. Runs are repeated and averaged, and every case also runs without the plugin so the scores show the plugin's contribution, not the model's baseline ability.

## Suite layout

The suite lives under `evals/` in the plugin root. One directory per case; nest cases under a plain directory to group them.

```text
<plugin>/
├── plugin.json
├── skills/...
└── evals/
    ├── <case>/
    │   ├── prompt.md          # the prompt sent to the agent, plus run limits
    │   ├── case.yaml          # optional: workspace fixtures, history, extra dirs
    │   ├── graders/
    │   │   ├── criteria.md    # one grader per file
    │   │   └── skill-fired.md
    │   └── <fixtures, scripts referenced by case.yaml>
    ├── mocks/                 # optional: scripted MCP tool answers
    └── results/               # written by each run; add to .gitignore
```

Only `prompt.md` or `case.yaml` is required for a case to exist. Cases start from an empty working directory, so put everything the task needs in the prompt, in `case.yaml` fixtures, or in a fixture directory added via `context.add_dirs`.

## Step 1 — Design the cases

Interview the user with `ask_user_question`:

1. Which skill, command, agent or MCP server the suite tests.
2. What a good result looks like, concretely — the artifact, its shape, the tool that must have run.
3. What should NOT trigger the plugin (negative cases: a near-miss request the skill should leave alone).
4. Whether the task needs workspace fixtures (a git repo, sample files) or an early conversation to continue.

Write the prompt the way a user would type it, phrased naturally — not naming the skill. A prompt that names the skill measures obedience, not triggering.

`prompt.md` frontmatter fields:

| Field | Default | Purpose |
| --- | --- | --- |
| `name` | directory name | Case name; report keys and `--case` filters use it |
| `description` | — | For humans; unused at run time |
| `tags` | `[]` | Filter with `--tag` |
| `runs` | `3` | Runs per arm, 1–50 |
| `model` | default | The agent under test's model |
| `max_turns` | `10` | Turn cap; hitting it is recorded as a run error |
| `timeout_seconds` | `300` | Wall-clock cap per run |
| `allowed_tools` | `[]` | Tools the case may use, e.g. `[Read, Glob, Grep, Skill]` |
| `env` | `{}` | Extra environment variables, keys must match `EVAL_[A-Z0-9_]*` |

`case.yaml` (needs `schema_version: "1.1"` and `name`) adds the fields only it carries: `context.scaffold_script` (a bash script in the case directory that seeds the workspace before the agent starts), `context.history_file` (a `.jsonl` transcript to continue; the prompt becomes the next user turn), `context.add_dirs` (read-only fixture directories), and `execution.prompt` when the whole case lives in YAML.

## Step 2 — Write the graders

One grader per file under `graders/`. Frontmatter sets `type` plus options; optional `weight` (relative weight in the run score) and `arm` (`with-only` excludes it from scoring in the baseline arm).

| Type | Options | Passes when |
| --- | --- | --- |
| `regex` | `pattern`, `flags`, `match`, `target` | JavaScript regex found in the target; `match: not_contains` requires absence, `match: "count:N"` requires exactly N |
| `tool_used` | `tool`, `input_match`, `min`, `max` | Calls to `tool` whose JSON input matches `input_match` land between `min` (1) and `max` (∞); `min: 0, max: 0` asserts the tool was never called |
| `tool_order` | `before`, `after` | Both tools ran and the first `before` call precedes the first `after` call |
| `file_exists` | `path`, `exists` | A file created during the run matches the glob (or none does with `exists: false`) |
| `llm` | `criteria`, `focus` | A judge model votes PASS on the rubric at least 2 of 3 votes |
| `baseline` | `baseline_file`, `criteria` | The judge finds the run at least as good as a reference `.jsonl` transcript |

`regex` and `llm` accept `target`/`focus`: `last_message` (default), `trace` (whole session as JSON lines), `files` (created paths), `{ source: file, path: <path> }` (a file's content — grade generated artifacts with this, never with `files`), or `mock_calls`.

The skill-triggered check, for a skill named `your-skill`:

```markdown
---
type: tool_used
tool: Skill
input_match: '"skill"\s*:\s*"(?:[\w-]+:)?your-skill"'
---
```

### Graders that give a stable signal

- Grade long outputs (generated files) with `regex` over `{ source: file, path }`; keep `llm` graders for short outputs with concrete PASS and FAIL conditions.
- Give every case one grader about the outcome and one about how the result was produced (`tool_used` or `tool_order`). Together they say whether the answer is right and whether the plugin produced it.
- If the `tool_used: Skill` grader passes but Δ is negative, suspect the judge: rerun with a stronger judge model and tighten the rubric so formatting does not decide the verdict.

## Step 3 — Baseline and arms

Every case runs in two arms: **with** the plugin and **without** any plugin (same run counts). The report shows `WITH`, `W/OUT` and their difference `Δ` — the plugin's contribution. A case scoring 1.0 in both arms proves nothing about the plugin.

Graders that cannot pass without the plugin (every `tool_used: Skill` grader, and any grader marked `arm: with-only`) are excluded from scoring in the without-arm so the arms stay comparable. Mark a grader `arm: both` to force scoring in both arms — that is what a "must NOT call the skill" check wants, with `min: 0` and `max: 0`.

## Step 4 — Mock MCP servers

Skills that call MCP tools run without the real services. Place `evals/mocks/<server>/<tool>.md` suite-wide, or `mocks/` inside a case. The file body is the tool's answer; `{{input.<field>}}` inserts call input, `{{file:fixtures/<name>}}` inserts a fixture file, and an `expect:` block of dot-path → type guards the input (a violating call aborts the run with score 0). `error: true` returns the body as a tool error. A server with no mock files never starts.

Grade the calls themselves with a grader whose `target` is `mock_calls`.

## Step 5 — Run on DeepSeek Harness

There is no bundled eval command here; the same suite format runs through the agent, with the host doing what such a CLI would:

1. **Isolation.** One fresh session per run, loading only the plugin under test — no personal or project-level skills, hooks, MCP servers, or memory. Point the run at a clean `DSH_HOME` and a scratch working directory.
2. **Spawn.** For each case × run × arm, start the run (`subagent_run`) with the prompt body from `prompt.md`, the case's allowed tools, and the turn/timeout caps from the frontmatter. Launch all runs for a turn in one message so they run concurrently.
3. **Observe triggering from the session log.** A skill load is an ordinary tool call — `{"type":"tool/call","data":{"name":"skill","arguments":"{\"name\":\"<skill>\"}"}}` — recorded in the subagent's persisted session log at `$DSH_HOME/sessions/...`. The `skill-creator` skill's `scripts/run_eval.py` reads these logs, detects the call, and builds the confusion matrix; reuse it instead of re-parsing logs by hand.
4. **Grade.** Apply the deterministic graders to the captured reply, transcript and files. For `llm` and `baseline` graders, spawn judge subagents with the rubric and take the 2-of-3 majority. Record per-run per-grader verdicts plus cost and wall time.
5. **Aggregate.** Run score = weighted share of passing graders; case score = mean over runs; a case passes at `--threshold` (default 1.0). Render the summary table:

```text
CASE        WITH  W/OUT Δ      RUNS COST    NOTES
first-case  1.00  0.33  +0.67  6    ...
```

`NOTES` shows the highest-weight failing grader's explanation, or the with-arm run error.

6. **Iterate.** The most common first finding is Δ near zero with a failed `tool_used: Skill` grader: the description does not trigger on the prompt's wording. Adjust the description, rerun, compare. To iterate one case cheaply, run one arm once (`--runs 1`, no baseline) — noisy, so confirm at three runs before trusting any change.

## Step 6 — Gate in CI

Fail the check when any case score falls below the threshold the team sets. Add `evals/results/` to `.gitignore`; commit the cases and mocks. Rerun the suite when the plugin changes or a new model ships — both are regression sources. If a run dies on a rate or usage limit mid-suite, treat its scores as suspect and rerun after the limit resets.

## Step 7 — Report

Report the summary table, the report directory, the per-case verdicts against the threshold, and the descriptions or skills whose triggering needs another iteration.
