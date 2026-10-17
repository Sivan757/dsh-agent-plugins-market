---
description: "Code review the current changes using specialized review agents"
argument-hint: "[review-aspects]"
---

# Code Review

Review the current changes using specialized review agents, each focusing on a different aspect of code quality. This plugin ships two of them: `code-reviewer` (guidelines, bugs, general quality) and `code-simplifier` (clarity and refinement after review).

**Review aspects (optional):** "$ARGUMENTS"

## Review Workflow

1. **Determine review scope**
   - Check `git status` and `git diff --name-only` to identify changed files
   - Parse arguments to see if the user requested specific review aspects
   - Default: run all applicable reviews
   - In a pull-request context, read the PR's diff too: `gh pr diff`

2. **Available review aspects**

   - **code** - General code review for project guidelines (default)
   - **errors** - Check error handling for silent failures, inadequate catch blocks, unjustified fallbacks
   - **tests** - Review test coverage quality and completeness for the changed behavior
   - **simplify** - Simplify code for clarity and maintainability after the review passes
   - **all** - Run all applicable reviews (default)

3. **Determine applicable reviews**

   Based on the changes:
   - **Always applicable**: the `code-reviewer` agent (guidelines, bugs, quality)
   - **If error handling changed**: review silent failures — error swallowing, broad catches, fallbacks without user awareness
   - **If behavior changed without tests**: review coverage gaps for the changed behavior
   - **After the review passes and the user asks**: the `code-simplifier` agent polishes and refines

4. **Launch review agents**

   Delegate each applicable aspect with `subagent_run`, giving every agent the full diff plus the file paths to focus on. Launch independent agents in one message so they run in parallel; results come back together.

   Each agent reviews only — findings come back as a list with file, line, the problem, a confidence score, and a concrete fix suggestion.

5. **Aggregate results**

   After the agents complete, summarize:
   - **Critical issues** (must fix before merge)
   - **Important issues** (should fix)
   - **Suggestions** (nice to have)
   - **Positive observations** (what's good)

6. **Provide action plan**

   Organize the findings:

   ```markdown
   # Code Review Summary

   ## Critical Issues (X found)
   - Issue description [file:line] (confidence: N)

   ## Important Issues (X found)
   - Issue description [file:line] (confidence: N)

   ## Suggestions (X found)
   - Suggestion [file:line]

   ## Strengths
   - What's well done in these changes

   ## Recommended Action
   1. Fix critical issues first
   2. Address important issues
   3. Consider suggestions
   4. Re-run /code-reviewer after fixes
   ```

## Filtering

Drop findings that are:
- Pre-existing issues the diff did not touch
- Things a linter, typechecker, or compiler would catch (they run in CI)
- Pedantic nitpicks a senior engineer would not raise
- General quality complaints (test coverage, documentation) unless the project's AGENTS.md requires them
- Intentional changes directly related to the broader change

## Usage Examples

**Full review (default):**
```
/code-reviewer
```

**Specific aspects:**
```
/code-reviewer errors
# Reviews only error handling

/code-reviewer errors tests
# Reviews error handling and test coverage
```

## Tips

- **Run early**: before creating the PR, not after
- **Focus on changes**: agents analyze `git diff` by default
- **Address critical first**: fix high-priority issues before lower priority
- **Re-run after fixes**: verify issues are resolved
