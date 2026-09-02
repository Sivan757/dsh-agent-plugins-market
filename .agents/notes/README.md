# Agent Notes

English | [中文](README.zh.md)

One kind of design doc lives here. An **Agent Note** records a decision or proposal that affects this codebase — the _why_ and _what we gave up_, the parts code and docs can't carry. This file defines where Agent Notes live, when to write one, and [the in-file format](#the-file-format). The rules are adopted from the DeepSeek Harness corpus (`deepseek-harness/.agents/notes/`), adapted to this repository: the mechanical gates named there (`verify-agent-note-format`, `verify-archived-agent-notes`, the i18n pairing gate) do not exist here, so the format is maintained by discipline and review until a gate is added.

## Layout and naming

Every Agent Note has two axes, both encoded in its **path** — `{lifecycle}/{class}/yyyy-mm-dd-topic-title.md`:

- **Lifecycle** (the top-level folder) is the Agent Note's status, and an Agent Note moves between folders as that status changes:
  - **`proposed/`** — proposals reviewed before implementation; not yet built (or only partly).
  - **`implemented/`** — the decision shipped. The file records what was decided and what was rejected, and is **kept current with what actually shipped**: when the code later moves a file, renames a module, or changes a key/default, the Agent Note is updated in the same change to match (facts only — paths, names, structure — not the decision itself). See [implemented/AGENTS.md](implemented/AGENTS.md).
  - **`rejected/`** — the proposal was considered and declined. Keep it only while its rationale prevents a tempting, meaningful mistake; otherwise delete it entirely.
- **Class** (the nested folder) is the _kind_ of decision — see [Classification](#classification) below.

The date in the filename is when the topic was **first proposed** (per git history). Cross-references between Agent Notes use relative markdown links (`[topic](../../implemented/architecture/2026-…-….md)`) — never bare prose or numbers — so they survive moves between folders.

The active lifecycle tree is the working inventory: browse its lifecycle/class folders or search the repository. Do not add a centralized `INDEX.md` — the tree and search own discovery, and an index is a second cache that goes stale. Low-future-value implemented records move to the separate frozen [`archived/`](archived/AGENTS.md) tree described below.

## Classification

Each Agent Note belongs to exactly one path-encoded class from this closed set; adding a class requires updating this section and creating the class folder in every lifecycle.

| Class            | What it covers                                                                                                          |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `feature`        | A new user- or model-facing capability.                                                                                 |
| `bug-fix`        | Corrects a defect or closes a gap a postmortem surfaced.                                                                |
| `simplification` | Removes code, behavior, or surface area without adding a capability.                                                    |
| `architecture`   | A structural decision about the **shipped source** — how `src/` layers relate, what the runtime vocabulary is.          |
| `process`        | Tooling, policy, or workflow **around** the code — release flow, gates, CI, the package manager — not runtime behavior. |
| `testing`        | Test infrastructure and strategy.                                                                                       |

The `architecture` / `process` line: **architecture** is about the source we ship; **process** is the surrounding tooling and workflow. (`refactor` is deliberately absent — it overlaps `simplification`, whose discriminator, "does observable behavior change?", already covers it.)

## Archiving and deletion

Archive an implemented Agent Note when the shipped decision is complete and its rationale is unlikely to guide future work. Keep it active when its alternatives, ownership boundary, negative guarantee, durable or wire semantics, security rule, or reintroduction condition remains useful. Never archive a proposed note: reject an obsolete proposal. Keep a rejected note only while it prevents a plausible mistake; otherwise delete its English and Chinese files together. Use the calibrated `dsh-archive-agent-notes` workflow rather than word count, age, or a target quota.

The archive is path-encoded as `archived/{class}/yyyy-mm-dd-topic-title.md`; `implemented` is deliberately absent because only implemented notes can enter it. An archival change moves the complete English/Chinese pair, inserts the identical `Archived: YYYY-MM-DD` line immediately below `Status: implemented` in both files, and repairs or deletes inbound links. These are the only permitted content changes during archival. This repository has no seal verifier — the freeze is enforced by this rule and by review: once archived, a file is never edited, moved, translated, reformatted, or deleted, and is not authority for current behavior. Active prose may still link into an archived note when it intentionally cites history.

## When to write one

Every non-trivial change MUST add or update at least one Agent Note in the same PR. A change is non-trivial when it alters behavior, architecture, a contract shared across files, process or tooling, testing strategy, an on-disk, wire, or configuration format, or another decision a maintainer may reasonably revisit. A proposal for substantial future work starts in `proposed/`; a decision already made starts in `implemented/`. Pick the class folder that matches the decision (see [Classification](#classification)).

Updating the Agent Note that already owns the decision satisfies the rule; do not create a duplicate. Every new note triggers a supersession audit of active notes covering the same decision — classify full or partial supersession in the same change. Only a purely mechanical or local edit with no change to behavior, contracts, structure, process, or rationale is exempt. An Agent Note is never edited into a _different decision_: supersede it with a new one, and keep both notes cross-linked unless the old note is later fully consolidated.

An implemented Agent Note that is fully superseded may be consolidated into the current owning note and deleted only when the owner preserves every unique rationale, alternative, consequence, and required verification, and repairs every inbound link. Partial supersession does not qualify: keep both notes cross-linked and update every fact that remains current.

## The file format

### The header block

The first three lines of every Agent Note are exactly:

```markdown
# Agent Note: <title>

Status: <status>
```

followed by a blank line. The `Status:` value is one of three forms, and must agree with the lifecycle folder the file sits in:

- `Status: proposed`
- `Status: implemented`
- `Status: rejected — <why, in one line>`

The status carries no dates and no parentheticals: the filename holds the first-proposed date, git holds everything else, and an "accepted in amended form" note is body content. The rejection reason is the one status with content, because a rejected Agent Note's verdict is the fact readers come for.

### The body skeleton

Every Agent Note opens its body with `## Problem` — the motivation, written to stand without the solution. Recurring sections use these canonical names and nothing else, while genuinely bespoke technical sections (schema details, mount lifecycles, wire contracts) remain free-form between the required ones.

#### `proposed/`

```markdown
## Problem

## Proposal

…bespoke sections…

## Alternatives considered

## Acceptance criteria

## Risks
```

`## Proposal` is the intended change and may legitimately speak in the future tense — plans, migration steps, and open questions belong here while the work is unbuilt. `## Acceptance criteria` says what observable state means done. `## Risks` covers both what could go wrong and what the change knowingly gives up.

#### `implemented/`

```markdown
## Problem

## Decision

…bespoke sections…

## Alternatives considered

## Consequences
```

`## Decision` describes shipped reality in the present tense, and the whole file is kept current with it per [implemented/AGENTS.md](implemented/AGENTS.md). `## Consequences` records what the trade-off cost **and** bought. Proposal-era headings are spec-speak here: `## Proposal`, `## Plan`, `## Migration plan`, and `## Acceptance criteria` do not appear in an implemented Agent Note. A `## Testing`, `## Deferred`, or `## Related` section is fine where it states present-tense fact.

#### `rejected/`

A rejected Agent Note is the proposal, frozen: it keeps whatever proposal-time sections it had (including `## Acceptance criteria` or `## Plan`), and the verdict lives on the `Status:` line. Only the header block, the `## Problem` opener, a `## Proposal` section, and the Alternatives-considered mandate below apply.

### Alternatives considered — mandatory

Every Agent Note carries an `## Alternatives considered` section: each genuine alternative and why it lost, one bold-led paragraph per alternative. A decision recorded without what it beat invites re-litigation — the failure Agent Notes exist to prevent. Alternatives are recorded from the real deliberation, never invented after the fact.

### Moving between lifecycles

Moving a file between lifecycle folders means updating the `Status:` line and re-satisfying that folder's skeleton in the same change. Concretely, `proposed/` → `implemented/` rewrites `## Proposal` into a present-tense `## Decision`, folds `## Acceptance criteria` and `## Risks` into `## Consequences` (or a present-tense `## Testing` section for what now pins the behavior), and drops plans in favor of what shipped. `proposed/` → `rejected/` only adds the reason to the `Status:` line and freezes the file.

### Chinese counterparts

A `.zh.md` counterpart mirrors its English sibling's structure section-for-section; the machine-readable header tokens (`# Agent Note: ` and the `Status:` line) stay in English verbatim. This repository has no pairing gate — the mirror is maintained by the same bilingual discipline as `README.zh.md` and `locales.ts`.
