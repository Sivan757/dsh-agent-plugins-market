---
name: init
description: Set up a minimal AGENTS.md (and optionally skills and hooks) for this repo. Use when the user asks to "initialize the project", "generate AGENTS.md", "set up project instructions", or runs /init.
---

Set up a minimal AGENTS.md (and optionally skills and hooks) for this repo. AGENTS.md is loaded into every session, so it must be concise — only include what the agent would get wrong without it.

## Phase 1: Ask what to set up

When the invocation names `--local`, `--skills` or `--hooks`, preselect the matching choice below instead of asking that question; otherwise ask both questions.

Use `ask_user_question` to find out what the user wants:

- "Which AGENTS.md files should /init set up?"
  Options: "Project AGENTS.md" | "Personal AGENTS.local.md" | "Both project + personal"
  Description for project: "Team-shared instructions checked into source control — architecture, coding standards, common workflows."
  Description for personal: "Your private preferences for this project (gitignored, not shared) — your role, sandbox URLs, preferred test data, workflow quirks."

- "Also set up skills and hooks?"
  Options: "Skills + hooks" | "Skills only" | "Hooks only" | "Neither, just AGENTS.md"
  Description for skills: "On-demand capabilities you or the agent invoke with `/skill-name` — good for repeatable workflows and reference knowledge."
  Description for hooks: "Deterministic shell commands that run on tool events (e.g., format after every edit). The agent can't skip them."

If an AGENTS.md already exists with content in this shape, read it first and ask whether to improve it in place as diffs or rewrite it.

## Phase 2: Explore the codebase

Launch a subagent to survey the codebase, and ask it to read key files to understand the project: manifest files (package.json, Cargo.toml, pyproject.toml, go.mod, pom.xml, etc.), README, Makefile/build configs, CI config, existing AGENTS.md, assistant or editor rule files, `.mcp.json`.

Detect:
- Build, test, and lint commands (especially non-standard ones)
- Languages, frameworks, and package manager
- Project structure (monorepo with workspaces, multi-module, or single project)
- Code style rules that differ from language defaults
- Non-obvious gotchas, required env vars, or workflow quirks
- Existing `.agents/skills/` directories and nested AGENTS.md files
- Formatter configuration (prettier, biome, ruff, black, gofmt, rustfmt, or a unified format script like `npm run format` / `make fmt`)
- Git worktree usage: run `git worktree list` to check if this repo has multiple worktrees (only relevant if the user wants a personal AGENTS.local.md)

Note what you could NOT figure out from code alone — these become interview questions.

## Phase 3: Fill in the gaps

Use `ask_user_question` to gather what you still need to write good AGENTS.md files and skills. Ask only things the code can't answer.

If the user chose project AGENTS.md or both: ask about codebase practices — non-obvious commands, gotchas, branch/PR conventions, required env setup, testing quirks. Skip things already in README or obvious from manifest files. Do not mark any options as "recommended" — this is about how their team works, not best practices.

If the user chose personal AGENTS.local.md or both: ask about them, not the codebase. Do not mark any options as "recommended" — this is about their personal preferences, not best practices. Examples of questions:
- What's their role on the team?
- How familiar are they with this codebase and its languages/frameworks?
- Do they have personal sandbox URLs, test accounts, API key paths, or local setup details the agent should know?
- Only if Phase 2 found multiple git worktrees: ask whether their worktrees are nested inside the main repo or siblings/external. If nested, the upward file walk finds the main repo's AGENTS.local.md automatically — no special handling needed. If sibling/external, the personal content should live in a home-directory file (e.g., `~/.dsh/<project-name>-instructions.md`) and each worktree gets a one-line AGENTS.local.md stub that imports it. Never put this import in the project AGENTS.md — that would check a personal reference into the team-shared file.
- Any communication preferences? (e.g., "be terse", "always explain tradeoffs", "don't summarize at the end")

**Synthesize a proposal from Phase 2 findings** — e.g., format-on-edit if a formatter exists, a `/verify` skill if tests exist, an AGENTS.md note for anything from the gap-fill answers that's a guideline rather than a workflow. For each, pick the artifact type that fits, **constrained by the Phase 1 skills+hooks choice**:

- **Hook** (stricter) — deterministic shell command on a tool event; the agent can't skip it. Fits mechanical, fast, per-edit steps: formatting, linting, running a quick test on the changed file.
- **Skill** (on-demand) — you or the agent invoke `/skill-name` when you want it. Fits workflows that don't belong on every edit: deep verification, session reports, deploys.
- **AGENTS.md note** (looser) — influences behavior but not enforced. Fits communication/thinking preferences: "plan before coding", "be terse", "explain tradeoffs".

**Respect Phase 1's skills+hooks choice as a hard filter**: if the user picked "Skills only", downgrade any hook you'd suggest to a skill or a note. If "Hooks only", downgrade skills to hooks (where mechanically possible) or notes. If "Neither", everything becomes an AGENTS.md note. Never propose an artifact type the user didn't opt into.

Show the proposal and get explicit acceptance before writing anything. Option labels stay short ("Looks good", "Drop the hook", "Drop the skill").

**Build the preference queue** from the accepted proposal. Each entry: {type: hook|skill|note, description, target file, any Phase-2-sourced details like the actual test/format command}. Phases 4-7 consume this queue.

## Phase 4: Write AGENTS.md (if user chose project or both)

Write a minimal AGENTS.md at the project root. Every line must pass this test: "Would removing this cause the agent to make mistakes?" If no, cut it.

**Consume `note` entries from the Phase 3 preference queue whose target is AGENTS.md** (team-level notes) — add each as a concise line in the most relevant section. Leave personal-targeted notes for Phase 5.

Include:
- Build/test/lint commands the agent can't guess (non-standard scripts, flags, or sequences)
- Code style rules that DIFFER from language defaults (e.g., "prefer type over interface")
- Testing instructions and quirks (e.g., "run single test with: pytest -k 'test_name'")
- Repo etiquette (branch naming, PR conventions, commit style)
- Required env vars or setup steps
- Non-obvious gotchas or architectural decisions
- Important parts from existing AI coding tool configs if they exist

Exclude:
- File-by-file structure or component lists (the agent can discover these by reading the codebase)
- Standard language conventions the agent already knows
- Generic advice ("write clean code", "handle errors")
- Detailed API docs or long references — reference the file instead
- Information that changes frequently — reference the source so the agent always reads the current version
- Long tutorials or walkthroughs (move to a separate file and reference it, or put in a skill)
- Commands obvious from manifest files (e.g., standard "npm test", "cargo test", "pytest")

Be specific: "Use 2-space indentation in TypeScript" is better than "Format code properly."

Do not repeat yourself and do not make up sections like "Common Development Tasks" or "Tips for Development" — only include information expressly found in files you read.

Prefix the file with:

```
# AGENTS.md
```

If AGENTS.md already exists: read it, propose specific changes as diffs, and explain why each change improves it. Do not silently overwrite.

For projects with multiple concerns, suggest organizing instructions into separate focused files (e.g., `code-style.md`, `testing.md`, `security.md`) referenced from AGENTS.md.

For projects with distinct subdirectories (monorepos, multi-module projects, etc.): mention that subdirectory AGENTS.md files can be added for module-specific instructions (they're loaded automatically when the agent works in those directories). Offer to create them if the user wants.

## Phase 5: Write AGENTS.local.md (if user chose personal or both)

Write a minimal AGENTS.local.md at the project root. After creating it, add `AGENTS.local.md` to the project's .gitignore so it stays private.

**Consume `note` entries from the Phase 3 preference queue whose target is AGENTS.local.md** (personal-level notes) — add each as a concise line. If the user chose personal-only in Phase 1, this is the sole consumer of note entries.

Include:
- The user's role and familiarity with the codebase (so explanations can be calibrated)
- Personal sandbox URLs, test accounts, or local setup details
- Personal workflow or communication preferences

Keep it short — only include what would make responses noticeably better for this user.

If Phase 2 found multiple git worktrees and the user confirmed they use sibling/external worktrees (not nested inside the main repo): the upward file walk won't find a single AGENTS.local.md from all worktrees. Write the actual personal content to the home-directory file and make AGENTS.local.md a one-line stub that imports it. The user can copy this one-line stub to each sibling worktree. Never put this import in the project AGENTS.md. If worktrees are nested inside the main repo, no special handling is needed — the main repo's AGENTS.local.md is found automatically.

If AGENTS.local.md already exists: read it, propose specific additions, and do not silently overwrite.

## Phase 6: Suggest and create skills (if user chose "Skills + hooks" or "Skills only")

Skills add capabilities the agent can use on demand without bloating every session.

**First, consume `skill` entries from the Phase 3 preference queue.** Each queued skill preference becomes a SKILL.md tailored to what the user described. For each:
- Name it from the preference (e.g., "verify-deep", "session-report", "deploy-sandbox")
- Write the body using the user's own words from the interview plus whatever Phase 2 found (test commands, report format, deploy target). If the preference maps to a skill the user already has installed (e.g., a market plugin's `/verify`), write a project skill that adds the user's specific constraints on top — tell the user the installed one still exists and theirs is additive.
- Ask a quick follow-up if the preference is underspecified (e.g., "which test command should verify-deep run?")

**Then suggest additional skills** beyond the queue when you find:
- Reference knowledge for specific tasks (conventions, patterns, style guides for a subsystem)
- Repeatable workflows the user would want to trigger directly (deploy, fix an issue, release process, verify changes)

For each suggested skill, provide: name, one-line purpose, and why it fits this repo.

If `.agents/skills/` already exists with skills, review them first. Do not overwrite existing skills — only propose new ones that complement what is already there.

Create each skill at `.agents/skills/<skill-name>/SKILL.md`:

```yaml
---
name: <skill-name>
description: <what the skill does and when to use it>
---

<Instructions for the agent>
```

Both the user (`/<skill-name>`) and the agent can invoke skills by default. For workflows with side effects (e.g., `/deploy`, `/fix-issue 123`), say so in the description so the agent leaves the trigger to the user, and use `$ARGUMENTS` to accept input.

## Phase 7: Suggest and create hooks (if user chose "Skills + hooks" or "Hooks only")

**Consume `hook` entries from the Phase 3 preference queue.** If Phase 2 found a formatter and the queue has no formatting hook, offer format-on-edit as a fallback. If the user chose "Neither" or "Skills only" in Phase 1, skip this phase entirely.

For each hook preference (from the queue or the formatter fallback):

1. Target file: `.agents/hooks/hooks.json` in the project root. Note to the user that project hooks load when the market plugin's project-layout scan is enabled (`dsh-agent-plugins-market.scanProjectLayouts`).

2. Pick the event and matcher from the preference:
   - "after every edit" → `PostToolUse` with matcher `Write|Edit`
   - "when the agent finishes" / "before I review" → `Stop` event (fires at the end of every turn — including read-only ones)
   - "before running bash" → `PreToolUse` with matcher `Bash`
   - "before committing" (a literal git-commit gate) → **not a hooks.json hook.** Matchers can't filter Bash by command content, so there's no way to target only `git commit`. Route this to a git pre-commit hook (`.git/hooks/pre-commit`, husky, pre-commit framework) instead — offer to write one. If the user actually means "before I review and commit the agent's output", that's `Stop` — probe to disambiguate.

3. Follow the `create-hook` skill's flow for the declaration and the command contract: construct for THIS project, test the command by hand with a sample payload on stdin, write the JSON, and report the file and the events wired.

## Phase 8: Summary and next steps

Recap what was set up — which files were written and the key points included in each. Remind the user these files are a starting point: they should review and tweak them, and can run `/init` again anytime to re-scan.

Then suggest a few additional optimizations for this codebase and agent setup based on what you found. Present these as a single, well-formatted to-do list where every item is relevant to this repo. Put the most impactful items first.

When building the list, work through these checks and include only what applies:
- If frontend code was detected: suggest a browser-automation path so the agent can launch a real browser, screenshot what it built, and fix visual bugs itself.
- If Phase 2 found no lint config for the project's language: suggest setting up linting — it catches issues early and gives the agent fast feedback on its own edits.
- If tests are missing for code the team actively changes: suggest a minimal test entry point.
- If README is missing or stale: suggest the `create-readme` skill.
- Anything else you noticed that a to-do item could fix.
