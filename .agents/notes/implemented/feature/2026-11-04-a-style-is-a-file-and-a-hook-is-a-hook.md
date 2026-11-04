# Agent Note: a style is a file, and a hook is a hook

Status: implemented

## Problem

Research into other marketplaces found the ecosystem ships output styles in two shapes, and the plugin supported neither well. GitHub code search returns 940 Markdown files under `output-styles/`, and the official plugin reference lists `output-styles/` as a plugin component (the manifest's `outputStyles` field replaces it). Claude Code resolves a plugin style as a namespaced Markdown file with frontmatter (`name`, `description`, `keep-coding-instructions`). The only shape this plugin handled was the one official demo plugin uses: a SessionStart hook that prints the text, which the page captured by running that hook.

That design read a suite's program on a page read, made the reader press a button per row, and still showed nothing for a suite that ships style files. It also put a hook in the wrong surface: a SessionStart hook is a hook, not an output style.

## Decision

- **A suite's Markdown styles are read as files.** `discoverSuiteStyles` reads `output-styles/*.md` (or the manifest's `outputStyles` declaration, in the same shapes the other Markdown components take) and keeps the frontmatter metadata plus the body. The catalog row carries them as `styles`, and the runtime lists one row per style with id `suite:<sourceId>/<suiteId>:<name>`.
- **A workspace's project styles are read from `.claude/output-styles/`.** Every directory between the session's working directory and the repository root is read, nearest wins, the same rule Claude Code applies. The row id is `project:<name>`.
- **A page with no session lists neither project styles nor a process-directory chain.** This is the rule the instruction chain already follows: settings belongs to no workspace.
- **Hook-injected persona text is left to the hooks surface.** The capture route, its state document field, its UI and its tests are gone. The hooks face already lists the SessionStart hook and the command it runs, which is where a hook belongs.

## Alternatives considered

- **Keep the capture as a fallback for hook-only suites.** Rejected by the decision above: a SessionStart hook that prints `additionalContext` is a hook the host already runs, and duplicating it as a selected style makes the same text arrive through two channels.
- **Copy a suite's style text into the plugin's data at scan time.** Rejected: the file is the source of truth, and a copy goes stale the moment the suite updates. Read the file on each read.
- **Namespace the style name into the label (`suite:style`).** Rejected for the label; the suite is shown on the row (`suiteName`) instead, and the id carries the namespace.
- **Read project styles in settings from `process.cwd()`.** Rejected: that is the arbitrary directory the harness was started in, and the same defect the instruction page just fixed.

## Consequences

- Installing a suite with `output-styles/` now shows its styles; the rows are read-only because the suite's file is the source of truth.
- A selected suite or project style follows its file: a changed file shows changed text, and a removed file stops injecting without a stale state to report.
- The selection document holds only `styleId`; the `captured` field and the capture route are gone from the contract.
- The hooks surface is the only place a SessionStart hook appears.

## Verification

- New tests: the scanner reads the conventional directory, a manifest declaration, an inline table and an absent directory; the service lists suite files, follows a changed file, stops injecting a removed one, reads project styles with nearest-wins, and omits project styles for a page with no workspace; the route answers a suite style and refuses an unknown id.
- Live in `market-demo` (recreated after the environment reset): a `.claude/output-styles/team-voice.md` in the working directory is absent from the settings read (no session), as intended. Browser automation was unavailable this round, so the session-scoped read and the panel were verified by tests, not in the GUI.
- Full suite: 2,559 tests pass; gate clean.
