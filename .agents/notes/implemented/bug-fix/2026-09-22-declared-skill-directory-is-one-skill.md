# Agent Note: A path carrying SKILL.md is one skill

Status: implemented

## Problem

A manifest may declare its skills as individual directories rather than as one container. `mattpocock/skills` does exactly that: `.claude-plugin/plugin.json` lists all 25 skill directories (`./skills/engineering/codebase-design`, …). A skill directory holds the skill's own documents beside its `SKILL.md` — `DESIGN-IT-TWICE.md`, `DEEPENING.md`, `MISSION-FORMAT.md`, `references/`, `scripts/`.

Skill discovery ran its flat `*.md` scan on each declared path before checking whether that path carried its own `SKILL.md`, so every document beside the skill was read as a flat skill. Scanning the real checkout produced 22 `skill "<name>": missing YAML frontmatter` diagnostics naming reference documents (`PHASE-BOUNDARIES`, `DESIGN-IT-TWICE`, `LOGIC`, …) on the suite's detail panel. The failure was not limited to noise: a reference document that happens to carry `name` and `description` frontmatter was registered as a skill nobody declared.

## Decision

A path that carries `SKILL.md` is one skill directory. Discovery reads that document and stops: the flat `*.md` scan, the child-directory scan and the category scan all apply only to a path with no `SKILL.md` of its own.

The rule is about the path being read, not about its depth, so it holds whether a manifest declares the skill directory, the conventional `skills/` container contains it, or a category directory two levels above contains it. `discoverSkills` checks `SKILL.md` before it lists anything.

## Alternatives considered

**Skip documents whose names look like references** (uppercase stems, a `references/` parent directory). Rejected: the name is a convention, not a contract, and a rule built on guessing which Markdown files are "real" skills would drop legitimate flat skills the moment a collection spelled them differently.

**Stop the nested scans from entering a skill directory.** Rejected: they never did. The child and category scans look only for `child/SKILL.md`, so a skill's `references/` was already invisible to them. The defect was the flat scan running on a path that is itself a skill.

**Require manifests to declare a container.** Rejected: declaring individual skills is valid, the plugin already accepts it (`declaredSkillDirs` resolves each entry), and refusing the shape would break a working source to avoid reading its own files.

## Consequences

A path that carries `SKILL.md` and also holds flat `*.md` skills now contributes only the one skill. That combination is self-contradictory — the same directory cannot be one skill and a collection of skills — and no source in the compatibility set ships it: no directory named `skills` in the fourteen configured checkouts carries a `SKILL.md` of its own.

Suites whose manifests list individual skill directories stop reporting their reference documents, and stop registering frontmatter-bearing references as skills. The count on the market card matches what sessions can invoke.

## Testing

`tests/discovery.test.ts` scans `tests/fixtures/declared-skill-dirs/`, a mattpocock-shaped fixture whose two declared skill directories each carry reference documents, one of them with valid `name` and `description` frontmatter. The test pins the discovered skill set to the two declared names, the empty diagnostic list, and the absence of the frontmatter-bearing reference. Scanning the fourteen configured source checkouts before this change reported 22 such diagnostics from the mattpocock checkout; afterwards it reports none.
