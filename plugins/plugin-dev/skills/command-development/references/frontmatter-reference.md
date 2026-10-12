# Command Frontmatter Reference

Complete reference for YAML frontmatter fields in slash commands.

## Frontmatter Overview

YAML frontmatter is optional metadata at the start of command files:

```markdown
---
description: Brief description
allowed-tools: Read, Write
model: inherit
argument-hint: "[arg1] [arg2]"
---

Command prompt content here...
```

All fields are optional. Commands work without any frontmatter.

## Field Specifications

### description

**Type:** String
**Required:** No
**Default:** First line of command prompt
**Max Length:** ~60 characters recommended for the command list

**Purpose:** Describes what the command does, shown in the command list

**Examples:**
```yaml
description: Review code for security issues
```
```yaml
description: Deploy to staging environment
```
```yaml
description: Generate API documentation
```

**Best practices:**
- Keep under 60 characters for clean display
- Start with verb (Review, Deploy, Generate)
- Be specific about what command does
- Avoid redundant "command" or "slash command"

**Good:**
- ✅ "Review PR for code quality and security"
- ✅ "Deploy application to specified environment"
- ✅ "Generate comprehensive API documentation"

**Bad:**
- ❌ "This command reviews PRs" (unnecessary "This command")
- ❌ "Review" (too vague)
- ❌ "A command that reviews pull requests for code quality, security issues, and best practices" (too long)

### allowed-tools

**Type:** String or Array of strings
**Required:** No
**Default:** Inherits from conversation permissions

**Purpose:** Restrict or specify which tools command can use

**Formats:**

**Single tool:**
```yaml
allowed-tools: Read
```

**Multiple tools (comma-separated):**
```yaml
allowed-tools: Read, Write, Edit
```

**Multiple tools (array):**
```yaml
allowed-tools:
  - Read
  - Write
  - Bash(git:*)
```

**Tool Patterns:**

**Specific tools:**
```yaml
allowed-tools: Read, Grep, Edit
```

**Bash with command filter:**
```yaml
allowed-tools: Bash(git:*)           # Only git commands
allowed-tools: Bash(npm:*)           # Only npm commands
allowed-tools: Bash(docker:*)        # Only docker commands
```

**All tools (not recommended):**
```yaml
allowed-tools: "*"
```

**When to use:**

1. **Security:** Restrict command to safe operations
   ```yaml
   allowed-tools: Read, Grep  # Read-only command
   ```

2. **Clarity:** Document required tools
   ```yaml
   allowed-tools: Bash(git:*), Read
   ```

3. **Bash execution:** Enable bash command output
   ```yaml
   allowed-tools: Bash(git status:*), Bash(git diff:*)
   ```

**Best practices:**
- Be as restrictive as possible
- Use command filters for Bash (e.g., `git:*` not `*`)
- Only specify when different from conversation permissions
- Document why specific tools are needed

### model

**Type:** String
**Required:** No
**Default:** Inherits from conversation
**Values:** exact model ids or inherit

**Purpose:** Specify which host model executes the command

**Examples:**
```yaml
model: inherit
```

**When to use:**

Omit the field for most commands — the command then runs on the session's own model. Set an exact `provider` + `model` pair only when a command must run on a specific model regardless of the session's route. `inherit` states that routing explicitly.

```yaml
---
description: Format code file
---
```

```yaml
---
description: Review code changes
model: inherit
---
```

```yaml
---
description: Analyze system architecture
model: inherit
---
```

**Best practices:**
- Omit unless specific need
- Prefer the session's own model — pin an exact pair only when the command demands one
- Test the pinned pair before committing to it

### argument-hint

**Type:** String
**Required:** No
**Default:** None

**Purpose:** Document expected arguments for users and autocomplete

**Format:**
```yaml
argument-hint: "[arg1] [arg2] [optional-arg]"
```

**Always quote the value.** A bracket value is valid YAML only when quoted: bare, `[arg1] [arg2]` is two adjacent flow sequences, which fails to parse and stops the whole command from loading. A single group like `[pr-number]` parses as a one-item list, which the loader does not accept as a string, so the hint silently disappears. The same quoting rule applies to any value starting with `{`, `*`, `&`, `!`, `%`, `@`, `>`, `|`, or containing `: `.

**Examples:**

**Single argument:**
```yaml
argument-hint: "[pr-number]"
```

**Multiple required arguments:**
```yaml
argument-hint: "[environment] [version]"
```

**Optional arguments:**
```yaml
argument-hint: "[file-path] [options]"
```

**Descriptive names:**
```yaml
argument-hint: "[source-branch] [target-branch] [commit-message]"
```

**Best practices:**
- Use square brackets `[]` for each argument
- Use descriptive names (not `arg1`, `arg2`)
- Indicate optional vs required in description
- Match order to positional arguments in command
- Keep concise but clear

**Examples by pattern:**

**Simple command:**
```yaml
---
description: Fix issue by number
argument-hint: "[issue-number]"
---

Fix issue #$1...
```

**Multi-argument:**
```yaml
---
description: Deploy to environment
argument-hint: "[app-name] [environment] [version]"
---

Deploy $1 to $2 using version $3...
```

**With options:**
```yaml
---
description: Run tests with options
argument-hint: "[test-pattern] [options]"
---

Run tests matching $1 with options: $2
```

### disable-model-invocation

**Type:** Boolean
**Required:** No
**Default:** false

**Purpose:** Prevent SlashCommand tool from programmatically invoking command

**Examples:**
```yaml
disable-model-invocation: true
```

**When to use:**

1. **Manual-only commands:** Commands requiring user judgment
   ```yaml
   ---
   description: Approve deployment to production
   disable-model-invocation: true
   ---
   ```

2. **Destructive operations:** Commands with irreversible effects
   ```yaml
   ---
   description: Delete all test data
   disable-model-invocation: true
   ---
   ```

3. **Interactive workflows:** Commands needing user input
   ```yaml
   ---
   description: Walk through setup wizard
   disable-model-invocation: true
   ---
   ```

**Default behavior (false):**
- Command available to SlashCommand tool
- the agent can invoke programmatically
- Still available for manual invocation

**When true:**
- Command only invokable by user typing `/command`
- Not available to SlashCommand tool
- Safer for sensitive operations

**Best practices:**
- Use sparingly (limits the agent's autonomy)
- Document why in command comments
- Consider if command should exist if always manual

## Complete Examples

### Minimal Command

No frontmatter needed:

```markdown
Review this code for common issues and suggest improvements.
```

### Simple Command

Just description:

```markdown
---
description: Review code for issues
---

Review this code for common issues and suggest improvements.
```

### Standard Command

Description and tools:

```markdown
---
description: Review Git changes
allowed-tools: Bash(git:*), Read
---

Current changes: run `git diff --name-only`

Review each changed file for:
- Code quality
- Potential bugs
- Best practices
```

### Complex Command

All common fields:

```markdown
---
description: Deploy application to environment
argument-hint: "[app-name] [environment] [version]"
allowed-tools: Bash(kubectl:*), Bash(helm:*), Read
model: inherit
---

Deploy $1 to $2 environment using version $3

Pre-deployment checks:
- Verify $2 configuration
- Check cluster status: run `kubectl cluster-info`
- Validate version $3 exists

Proceed with deployment following deployment runbook.
```

### Manual-Only Command

Restricted invocation:

```markdown
---
description: Approve production deployment
argument-hint: "[deployment-id]"
disable-model-invocation: true
allowed-tools: Bash(gh:*)
---

<!--
MANUAL APPROVAL REQUIRED
This command requires human judgment and cannot be automated.
-->

Review deployment $1 for production approval:

Deployment details: run `gh api /deployments/$1`

Verify:
- All tests passed
- Security scan clean
- Stakeholder approval
- Rollback plan ready

Type "APPROVED" to confirm deployment.
```

## Validation

### Common Errors

**Invalid YAML syntax:**
```yaml
---
description: Missing quote
allowed-tools: Read, Write
model: inherit
---  # ❌ Missing closing quote above
```

**Fix:** Validate YAML syntax

**Incorrect tool specification:**
```yaml
allowed-tools: Bash  # ❌ Missing command filter
```

**Fix:** Use `Bash(git:*)` format

**Invalid model name:**
```yaml
model: gpt4  # ❌ Not a valid host model
```

**Fix:** Use `inherit`, `inherit`, or `inherit`

### Validation Checklist

Before committing command:
- [ ] YAML syntax valid (no errors)
- [ ] Description under 60 characters
- [ ] allowed-tools uses proper format
- [ ] model is valid value if specified
- [ ] argument-hint matches positional arguments
- [ ] disable-model-invocation used appropriately

## Best Practices Summary

1. **Start minimal:** Add frontmatter only when needed
2. **Document arguments:** Always use argument-hint with arguments
3. **Restrict tools:** Use most restrictive allowed-tools that works
4. **Choose right model:** Use inherit for speed, inherit for complexity
5. **Manual-only sparingly:** Only use disable-model-invocation when necessary
6. **Clear descriptions:** Make commands discoverable in the command list
7. **Test thoroughly:** Verify frontmatter works as expected
