---
name: command-development
description: This skill should be used when the user asks to "create a slash command", "add a command", "write a custom command", "define command arguments", "use command frontmatter", "organize commands", "create command with file references", "interactive command", "use ask_user_question in command", or needs guidance on slash command structure, YAML frontmatter fields, dynamic arguments, bash execution in commands, user interaction patterns, or command development best practices for DeepSeek Harness.
---

# Command Development for DeepSeek Harness

> **Note:** Inside a plugin, commands live at `com.deepseek.harness/commands/*.md`. Project-level commands (outside a plugin) live at `.agents/commands/*.md` and load when the market plugin's project-layout scan is enabled. The frontmatter and body contract below is the same in both places.

## Overview

Slash commands are frequently-used prompts defined as Markdown files that the agent executes during interactive sessions. Understanding command structure, frontmatter options, and dynamic features enables creating powerful, reusable workflows.

**Key concepts:**

- Markdown file format for commands
- YAML frontmatter for configuration
- Dynamic arguments and file references
- Dynamic context in commands
- Command organization and namespacing

## Command Basics

### What is a Slash Command?

A slash command is a Markdown file containing a prompt that the agent executes when invoked. Commands provide:

- **Reusability**: Define once, use repeatedly
- **Consistency**: Standardize common workflows
- **Sharing**: Distribute across team or projects
- **Efficiency**: Quick access to complex prompts

### Critical: Commands are Instructions for the agent

**Commands are written for agent consumption, not human consumption.**

When a user invokes `/command-name`, the command content becomes the agent's instructions. Write commands as directives TO the agent about what to do, not as messages TO the user.

**Correct approach (instructions for the agent):**

```markdown
Review this code for security vulnerabilities including:

- SQL injection
- XSS attacks
- Authentication issues

Provide specific line numbers and severity ratings.
```

**Incorrect approach (messages to user):**

```markdown
This command will review your code for security issues.
You'll receive a report with vulnerability details.
```

The first example tells the agent what to do. The second tells the user what will happen but doesn't instruct the agent. Always use the first approach.

### Command Locations

**Project commands** (shared with team):

- Location: `.agents/commands/`
- Scope: Available in that project; loads when the market plugin's project-layout scan is enabled
- Use for: Team workflows, project-specific tasks

**Personal commands** (available everywhere):

- Location: `~/.agents/commands/`
- Scope: Available in all projects
- Use for: Personal workflows, cross-project utilities

**Plugin commands** (bundled with plugins):

- Location: `com.deepseek.harness/commands/` inside the plugin
- Scope: Available when the plugin is installed
- Use for: Plugin-specific functionality

## File Format

### Basic Structure

Commands are Markdown files with `.md` extension:

```
.agents/commands/
├── review.md           # /review command
├── test.md             # /test command
└── deploy.md           # /deploy command
```

**Simple command:**

```markdown
Review this code for security vulnerabilities including:

- SQL injection
- XSS attacks
- Authentication bypass
- Insecure data handling
```

No frontmatter needed for basic commands.

### With YAML Frontmatter

Add configuration using YAML frontmatter:

```markdown
---
description: Review code for security issues
allowed-tools: Read, Grep, Bash(git:*)
model: inherit
---

Review this code for security vulnerabilities...
```

## YAML Frontmatter Fields

### description

**Purpose:** Brief description shown in the command list
**Type:** String
**Default:** First line of command prompt

```yaml
---
description: Review pull request for code quality
---
```

**Best practice:** Clear, actionable description (under 60 characters)

### allowed-tools

**Purpose:** Specify which tools the command can use. A harness-side frontmatter key: the market passes it through; sessions that do not support it ignore it. Keep restrictions in the prompt body when in doubt.

**Type:** String or Array
**Default:** Inherits from conversation

```yaml
---
allowed-tools: Read, Write, Edit, Bash(git:*)
---
```

**Patterns:**

- `Read, Write, Edit` - Specific tools
- `Bash(git:*)` - Bash with git commands only
- `*` - All tools (rarely needed)

**Use when:** Command requires specific tool access

### model

**Purpose:** Specify model for command execution
**Type:** String (exact model ids)
**Default:** Inherits from conversation

```yaml
---
model: inherit
---
```

**Use cases:**

- Omit it entirely for commands that should run on the session's own model
- `inherit` when you want to state the routing explicitly
- An exact `provider` + `model` pair when a command must run on a specific model

### argument-hint

**Purpose:** Document expected arguments for autocomplete
**Type:** String — always quoted
**Default:** None

```yaml
---
argument-hint: "[pr-number] [priority] [assignee]"
---
```

Quote the value whenever it starts with `[`, `{`, `*`, `&`, `!`, `%`, `@`, `>`, `|`, or contains `: `. Unquoted, `[a] [b]` is two adjacent YAML flow sequences and the command fails to load; a single `[a]` becomes a one-item list, which reads as no hint at all.

**Benefits:**

- Helps users understand command arguments
- Improves command discovery
- Documents command interface

### Restricting invocation

**Purpose:** Keep a side-effectful command out of the agent's reach — only the user triggers it
**Type:** Frontmatter in the source format; harness support varies

Write the restriction into the command itself when the harness has no frontmatter key:

```markdown
This command runs only on the user's explicit invocation. Do not invoke it on your own; if the task seems to need it, ask the user to run /command-name with the required arguments.
```

**Use when:** Command has side effects (deploy, publish, delete) and must not fire as part of a larger task

## Dynamic Arguments

### Using $ARGUMENTS

Capture all arguments as single string:

```markdown
---
description: Fix issue by number
argument-hint: "[issue-number]"
---

Fix issue #$ARGUMENTS following our coding standards and best practices.
```

**Usage:**

```
> /fix-issue 123
> /fix-issue 456
```

**Expands to:**

```
Fix issue #123 following our coding standards...
Fix issue #456 following our coding standards...
```

### Using Positional Arguments

Capture individual arguments with `$1`, `$2`, `$3`, etc.:

```markdown
---
description: Review PR with priority and assignee
argument-hint: "[pr-number] [priority] [assignee]"
---

Review pull request #$1 with priority level $2.
After review, assign to $3 for follow-up.
```

**Usage:**

```
> /review-pr 123 high alice
```

**Expands to:**

```
Review pull request #123 with priority level high.
After review, assign to alice for follow-up.
```

### Combining Arguments

Mix positional and remaining arguments:

```markdown
Deploy $1 to $2 environment with options: $3
```

**Usage:**

```
> /deploy api staging --force --skip-tests
```

**Expands to:**

```
Deploy api to staging environment with options: --force --skip-tests
```

## File References

### Referencing Files by Path

Name the file in the prompt and let the agent read it:

```markdown
---
description: Review specific file
argument-hint: "[file-path]"
---

Review the file at $1 for:

- Code quality
- Best practices
- Potential bugs
```

**Usage:**

```
> /review-file src/api/users.ts
```

**Effect:** the agent reads `src/api/users.ts` before processing the command

### Multiple File References

Reference multiple files:

```markdown
Compare src/old-version.js with src/new-version.js. Read both files first.

Identify:

- Breaking changes
- New features
- Bug fixes
```

### Static File References

Reference known files without arguments:

```markdown
Review package.json and tsconfig.json for consistency. Read both first.

Ensure:

- TypeScript version matches
- Dependencies are aligned
- Build configuration is correct
```

## Bash Execution in Commands

The source format supports inline bash with the `` !`command` `` syntax: the command runs before the prompt reaches the model and its output is spliced into the prompt text. Harness support for inline execution varies — verify the target runtime before relying on it. The portable pattern is a first instruction in the body that runs the command with the bash tool and reads its output before continuing:

```markdown
---
description: Review code changes
---

First run `git diff --name-only` and review each listed file.
```

**When to use:**

- Include dynamic context (git status, environment vars, etc.)
- Gather project/repository state
- Build context-aware workflows

For the complete source-format syntax and examples, see `references/plugin-features-reference.md` section on bash execution.

## Command Organization

### Flat Structure

Simple organization for small command sets:

```
.agents/commands/
├── build.md
├── test.md
├── deploy.md
├── review.md
└── docs.md
```

**Use when:** 5-15 commands, no clear categories

### Namespaced Structure

Organize commands in subdirectories:

```
.agents/commands/
├── ci/
│   ├── build.md        # /build (project:ci)
│   ├── test.md         # /test (project:ci)
│   └── lint.md         # /lint (project:ci)
├── git/
│   ├── commit.md       # /commit (project:git)
│   └── pr.md           # /pr (project:git)
└── docs/
    ├── generate.md     # /generate (project:docs)
    └── publish.md      # /publish (project:docs)
```

**Benefits:**

- Logical grouping by category
- Namespace visible in the command id
- Easier to find related commands

**Use when:** 15+ commands, clear categories

## Best Practices

### Command Design

1. **Single responsibility:** One command, one task
2. **Clear descriptions:** Self-explanatory in the command list
3. **Explicit dependencies:** Use `allowed-tools` when needed
4. **Document arguments:** Always provide `argument-hint`
5. **Consistent naming:** Use verb-noun pattern (review-pr, fix-issue)

### Argument Handling

1. **Validate arguments:** Check for required arguments in prompt
2. **Provide defaults:** Suggest defaults when arguments missing
3. **Document format:** Explain expected argument format
4. **Handle edge cases:** Consider missing or invalid arguments

```markdown
---
argument-hint: "[pr-number]"
---

$IF($1,
Review PR #$1,
Please provide a PR number. Usage: /review-pr [number]
)
```

### File References

1. **Explicit paths:** Use clear file paths
2. **Check existence:** Handle missing files gracefully
3. **Relative paths:** Use project-relative paths
4. **Glob support:** Consider using the glob tool for patterns

### Bash Commands

1. **Limit scope:** Use `Bash(git:*)` not `Bash(*)`
2. **Safe commands:** Avoid destructive operations
3. **Handle errors:** Consider command failures
4. **Keep fast:** Long-running commands slow invocation

### Documentation

1. **Add comments:** Explain complex logic
2. **Provide examples:** Show usage in comments
3. **List requirements:** Document dependencies
4. **Version commands:** Note breaking changes

```markdown
---
description: Deploy application to environment
argument-hint: "[environment] [version]"
---

<!--
Usage: /deploy [staging|production] [version]
Requires: AWS credentials configured
Example: /deploy staging v1.2.3
-->

Deploy application to $1 environment using version $2...
```

## Common Patterns

### Review Pattern

```markdown
---
description: Review code changes
allowed-tools: Read, Bash(git:*)
---

Files changed: run `git diff --name-only`

Review each file for:

1. Code quality and style
2. Potential bugs or issues
3. Test coverage
4. Documentation needs

Provide specific feedback for each file.
```

### Testing Pattern

```markdown
---
description: Run tests for specific file
argument-hint: "[test-file]"
allowed-tools: Bash(npm:*)
---

Run tests: run `npm test Run tests: `

Analyze results and suggest fixes for failures.
```

### Documentation Pattern

```markdown
---
description: Generate documentation for file
argument-hint: "[source-file]"
---

Generate comprehensive documentation for @$1 including:

- Function/class descriptions
- Parameter documentation
- Return value descriptions
- Usage examples
- Edge cases and errors
```

### Workflow Pattern

```markdown
---
description: Complete PR workflow
argument-hint: "[pr-number]"
allowed-tools: Bash(gh:*), Read
---

PR #$1 Workflow:

1. Fetch PR: run `gh pr view 1. Fetch PR: `
2. Review changes
3. Run checks
4. Approve or request changes
```

## Troubleshooting

**Command not appearing:**

- Check file is in correct directory
- Verify `.md` extension present
- Ensure valid Markdown format
- Restart DeepSeek Harness

**Arguments not working:**

- Verify `$1`, `$2` syntax correct
- Check `argument-hint` matches usage
- Ensure no extra spaces

**Bash execution failing:**

- Check `allowed-tools` includes Bash
- Verify command syntax in backticks
- Test command in terminal first
- Check for required permissions

**File references not working:**

- Reference the file in the prompt and let the agent read it with its read tool
- Check the file path is valid
- Use `${PLUGIN_ROOT}`-relative paths for plugin files

## Plugin-Specific Features

### PLUGIN_ROOT Variable

Plugin commands have access to `${PLUGIN_ROOT}`, an environment variable that resolves to the plugin's absolute path.

**Purpose:**

- Reference plugin files portably
- Execute plugin scripts
- Load plugin configuration
- Access plugin templates

**Basic usage:**

```markdown
---
description: Analyze using plugin script
allowed-tools: Bash(node:*)
---

Run analysis: run `node ${PLUGIN_ROOT}/scripts/analyze.js`

Review results and report findings.
```

**Common patterns:**

```markdown
# Execute plugin script

Run `bash ${PLUGIN_ROOT}/scripts/script.sh` first.

# Load plugin configuration

Read `${PLUGIN_ROOT}/config/settings.json`

# Use plugin template

Read `${PLUGIN_ROOT}/templates/report.md`

# Access plugin resources

Read `${PLUGIN_ROOT}/docs/reference.md`
```

**Why use it:**

- Works across all installations
- Portable between systems
- No hardcoded paths needed
- Essential for multi-file plugins

### Plugin Command Organization

Plugin commands discovered automatically from `com.deepseek.harness/commands/`:

```
plugin-name/
└── com.deepseek.harness/
    └── commands/
        ├── foo.md              # /foo
        ├── bar.md              # /bar
        └── utils/
            └── helper.md       # /helper (namespaced)
```

**Namespace benefits:**

- Logical command grouping
- Shown in the slash menu
- Avoid name conflicts
- Organize related commands

**Naming conventions:**

- Use descriptive action names
- Avoid generic names (test, run)
- Consider plugin-specific prefix
- Use hyphens for multi-word names

### Plugin Command Patterns

**Configuration-based pattern:**

```markdown
---
description: Deploy using plugin configuration
argument-hint: "[environment]"
allowed-tools: Read, Bash(*)
---

Load configuration: @${PLUGIN_ROOT}/config/$1-deploy.json

Deploy to $1 using configuration settings.
Monitor deployment and report status.
```

**Template-based pattern:**

```markdown
---
description: Generate docs from template
argument-hint: "[component]"
---

Template: @${PLUGIN_ROOT}/templates/docs.md

Generate documentation for $1 following template structure.
```

**Multi-script pattern:**

```markdown
---
description: Complete build workflow
allowed-tools: Bash(*)
---

Build: `bash /scripts/build.sh`
Test: `bash /scripts/test.sh`
Package: `bash /scripts/package.sh`

Review outputs and report workflow status.
```

**See `references/plugin-features-reference.md` for detailed patterns.**

## Integration with Plugin Components

Commands can integrate with other plugin components for powerful workflows.

### Agent Integration

Launch plugin agents for complex tasks:

```markdown
---
description: Deep code review
argument-hint: "[file-path]"
---

Initiate comprehensive review of @$1 using the code-reviewer agent.

The agent will analyze:

- Code structure
- Security issues
- Performance
- Best practices

Agent uses plugin resources:

- ${PLUGIN_ROOT}/config/rules.json
- ${PLUGIN_ROOT}/checklists/review.md
```

**Key points:**

- Agent must exist in `plugin/agents/` directory
- the agent uses subagent_run tool to launch agent
- Document agent capabilities
- Reference plugin resources agent uses

### Skill Integration

Leverage plugin skills for specialized knowledge:

```markdown
---
description: Document API with standards
argument-hint: "[api-file]"
---

Document API in @$1 following plugin standards.

Use the api-docs-standards skill to ensure:

- Complete endpoint documentation
- Consistent formatting
- Example quality
- Error documentation

Generate production-ready API docs.
```

**Key points:**

- Skill must exist in `plugin/skills/` directory
- Mention skill name to trigger invocation
- Document skill purpose
- Explain what skill provides

### Hook Coordination

Design commands that work with plugin hooks:

- Commands can prepare state for hooks to process
- Hooks execute automatically on tool events
- Commands should document expected hook behavior
- Guide the agent on interpreting hook output

See `references/plugin-features-reference.md` for examples of commands that coordinate with hooks

### Multi-Component Workflows

Combine agents, skills, and scripts:

```markdown
---
description: Comprehensive review workflow
argument-hint: "[file]"
allowed-tools: Bash(node:*), Read
---

Target: @$1

Phase 1 - Static Analysis:
Run `node /scripts/lint.js ` first.

Phase 2 - Deep Review:
Launch code-reviewer agent for detailed analysis.

Phase 3 - Standards Check:
Use coding-standards skill for validation.

Phase 4 - Report:
Template: @${PLUGIN_ROOT}/templates/review.md

Compile findings into report following template.
```

**When to use:**

- Complex multi-step workflows
- Leverage multiple plugin capabilities
- Require specialized analysis
- Need structured outputs

## Validation Patterns

Commands should validate inputs and resources before processing.

### Argument Validation

```markdown
---
description: Deploy with validation
argument-hint: "[environment]"
---

Validate environment: run `echo "Validate environment: " | grep -E "^(dev|staging|prod)  || echo "INVALID"`

If $1 is valid environment:
Deploy to $1
Otherwise:
Explain valid environments: dev, staging, prod
Show usage: /deploy [environment]
```

### File Existence Checks

```markdown
---
description: Process configuration
argument-hint: "[config-file]"
---

Check file exists: run `test -f Check file exists:  && echo "EXISTS" || echo "MISSING"`

If file exists:
Process configuration: @$1
Otherwise:
Explain where to place config file
Show expected format
Provide example configuration
```

### Plugin Resource Validation

```markdown
---
description: Run plugin analyzer
allowed-tools: Bash(test:*)
---

Validate plugin setup:

- Script: run `test -x /bin/analyze && echo OK || echo MISSING`
- Config: run `test -f /config.json && echo OK || echo MISSING`

If all checks pass, run analysis.
Otherwise, report missing components.
```

### Error Handling

```markdown
---
description: Build with error handling
allowed-tools: Bash(*)
---

Execute build: run `bash /scripts/build.sh 2>&1 || echo "BUILD_FAILED"`

If build succeeded:
Report success and output location
If build failed:
Analyze error output
Suggest likely causes
Provide troubleshooting steps
```

**Best practices:**

- Validate early in command
- Provide helpful error messages
- Suggest corrective actions
- Handle edge cases gracefully

---

For detailed frontmatter field specifications, see `references/frontmatter-reference.md`.
For plugin-specific features and patterns, see `references/plugin-features-reference.md`.
For command pattern examples, see `examples/` directory.
