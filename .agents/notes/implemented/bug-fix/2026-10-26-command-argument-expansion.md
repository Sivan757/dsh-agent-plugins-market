# Agent Note: command bodies expand their declared arguments

Status: implemented

## Problem

Marketplace suites ship Claude Code commands whose frontmatter declares named arguments:

```markdown
---
description: Security scan of the legacy system with a reviewable remediation patch
argument-hint: <system> [--show-secrets]
arguments: system
---

Run a **security hardening pass** on `legacy/$system` ...
```

The published `code-modernization` suite declares arguments in all 13 of its commands and refers to `$system` 246 times. Eight of its bodies carry no `$ARGUMENTS` at all.

The mount handler replaced one spelling only, `.replaceAll('$ARGUMENTS', invocation.rawInput.trim())`. Every named placeholder reached the model literally. A body without `$ARGUMENTS` lost the user's text completely, so `/modernize-harden payment-service` arrived with a literal `$system` and no `payment-service`. Issues #125 and #127 report the same defect, and #127 is the duplicate.

The defect is not a missing feature in one suite. Claude Code fills a command body from the invocation before the model reads it, and any suite written for that dialect keeps the same authoring style.

## Decision

`packages/market-runtime/src/application/command-arguments.ts` owns the expansion as one pure function of the author text, the invocation text and the declared names. The mount handler calls it after plugin path variables are resolved and before dynamic context runs.

`parseCommandResource` records the declaration on `CommandSpec.args` in the author's order. It accepts the one space- or comma-separated string the published suites write and the YAML list, because both spellings exist in the wild. A name that cannot be a placeholder, a duplicate or a non-string entry, is reported through the `onIssue` sink that also reports a refused command file, and the remaining names still bind.

`expandCommandArguments` makes one pass over the body and recognizes exactly three spellings:

- `$ARGUMENTS` is the whole trimmed invocation text, unchanged from before.
- `$1` to `$9` are one argument each, by position.
- `$name` is the argument at that name's declaration index.

Every other dollar sequence stays literal, so `$HOME`, `${CLAUDE_PLUGIN_ROOT}`, `$?` and text that merely starts with a dollar reach the model as the author wrote them. A substituted value is never rescanned, so an argument that itself contains `$system` stays that text.

The invocation text splits the way Claude Code splits it: on whitespace, with a single- or double-quoted phrase kept as one argument and its quotes removed. There is no escape syntax, and an unterminated quote runs to the end of the text.

An argument the body uses and the text leaves unfilled expands to nothing, and the command's acknowledgement line names it: `/modernize-uplift did not receive these declared arguments, left empty: $target_version`. The sentence is a host locale key pair, so it follows the interface language.

Empty text, not a refusal, is the dialect's own behavior and the only one that keeps the published commands working. Claude Code renders a missing argument as an empty string, and the bodies that carry a trailing argument branch on exactly that emptiness. `code-modernization/commands/modernize-brief.md` reads `$target_stack` and, when it is blank, takes the one in `analysis/$system/INTENT.md` or recommends one from the assessment. `code-modernization/commands/modernize-transform.md` says `If $module or $target_stack is empty`, read further before acting. Failing the invocation instead would replace a branch those authors wrote and tested with a refusal they never accounted for.

A body that carries no placeholder at all receives the text after one blank line, rendered `User input: <text>`. Nothing the user typed is ever dropped.

Placeholders expand inside code fences exactly as elsewhere. The suites that declare arguments also write them inside shell snippets the model is meant to run with those values, and a fence-aware rule would make one author's text behave differently for no stated gain.

## Alternatives considered

**Refuse the invocation when a declared argument has no value.** A refusal fails closed and is the strictest reading of "never an empty string". It also breaks the commands as their authors wrote them: three published commands document what to do when the trailing argument is empty, and a refusal never lets that branch run.

**Leave the placeholder literal when no value arrived.** This is the reported defect. The model reasons about a token that names nothing, and the body's own "if blank" branch never runs because the token is not blank.

**Report the gap as a reconcile diagnostic, beside a refused command file.** A reconcile diagnostic describes the file and appears once per pass. Emptiness is a property of one invocation, so it belongs in the reply to the person who typed that command, which is also the surface that already reports a command refusing to run.

**Append the unclaimed text with no label.** The bare text reads as a continuation of the author's last paragraph. One label line tells the model where the author's text stops, and the rendering is stable to test.

**Skip substitution inside code fences.** Fence-aware expansion makes the author's own script snippets keep a literal `$system` while the prose around them is filled, which is worse than either uniform rule. The published suites rely on the uniform one.

**Add an escape for a literal `$name`.** No suite needs one yet. An escape would be an extension of the dialect, and a name that a body must keep literal is an argument the author can rename.

**Share the expansion with the user-authored command panel.** The panel reads its own frontmatter from the workspace store and substitutes `$ARGUMENTS` itself. Extending it is the same dialect and the same fix, and it is left as a separate change so this one keeps one reader per surface.

## Testing

`packages/market-runtime/test/command-arguments.test.ts` covers splitting (whitespace, quoted phrases, an empty quoted argument, an unterminated quote) and expansion (positional names, quoted values, a missing name with its report, `$ARGUMENTS`, `$1` to `$N`, unknown dollars, no re-scan, the appended text, an empty invocation and a code fence).

`packages/market-runtime/test/command-resources.test.ts` covers the declaration reader: one space-separated string, a comma-separated string, a YAML list, no declaration, an unusable name with the rest still binding, a duplicate name, and a value that is neither a string nor a list.

`packages/market-bundle/test/integration/commands-mounts.test.ts` drives the mount registry with `packages/market-bundle/test/integration/fixtures/code-modernization-commands`, a trimmed copy of two published commands whose frontmatter is unchanged. It checks that `/modernize-harden payment-service` reaches the model with `payment-service` and no `$system`, that two declared names bind with a quoted phrase, that positional placeholders expand without a declaration, that a missing name is named in the acknowledgement, that a body without a placeholder receives `User input: <text>`, and that `$ARGUMENTS` stays the whole text beside a declared name.

## Consequences

A suite command now reaches the model with the user's words in the places its author marked. The 13 `code-modernization` commands bind their declared names, and a command that author forgot to mark still receives the text at the end.

The empty substitution for a missing argument is a deliberate trade. It keeps the published commands working with their own documented "if blank" behavior, and the acknowledgement names what was missing. A reader who wants the model to see a hard stop will not get one.

The user-authored command panel keeps `$ARGUMENTS` only. The same authoring style there still ends with a literal placeholder, and the deferred change noted above closes that gap with the same function.

Registration fingerprints include the declaration, so editing `arguments` remounts the command on the next pass, exactly as editing another frontmatter field does.

## Related

This extends the placeholder surface that [suite text paths and dynamic context](../bug-fix/2026-09-14-suite-text-paths-and-dynamic-context.md) established, and it keeps that note's resolution order: plugin path variables first, then the invocation placeholders, then `!`command`` dynamic context. The refusal reporting this note leans on for a malformed declaration is the one [#126](https://github.com/Sivan757/dsh-agent-plugins-market/issues/126) closed.
