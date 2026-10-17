# Skills Recommendations

Skills are packaged expertise with workflows, reference materials, and best practices. Create them in `.agents/skills/<name>/SKILL.md`. Skills can be invoked by the agent automatically when relevant, or by users directly with `/skill-name`.

Some pre-built skills are available through official plugins (install from the agent plugins market page).

**Note**: These are common patterns. Use web search to find skill ideas specific to the codebase's tools and frameworks.

---

## Available from Official Plugins

### Plugin Development (plugin-dev)

| Skill | Best For |
|-------|----------|
| **skill-development** | Creating new skills with proper structure |
| **hook-development** | Building hooks for automation |
| **command-development** | Creating slash commands |
| **agent-development** | Building specialized subagents |
| **mcp-integration** | Integrating MCP servers into plugins |
| **plugin-structure** | Understanding plugin architecture |

### Git Workflows (commit-commands)

| Skill | Best For |
|-------|----------|
| **commit** | Creating git commits with proper messages |
| **commit-push-pr** | Full commit, push, and PR workflow |

### Frontend (frontend-design)

| Skill | Best For |
|-------|----------|
| **frontend-design** | Creating polished UI components |

**Value**: Creates distinctive, high-quality UI instead of generic AI aesthetics.

### Automation Rules (hookify)

| Skill | Best For |
|-------|----------|
| **writing-rules** | Creating hookify rules for automation |

### Feature Development (feature-dev)

| Skill | Best For |
|-------|----------|
| **feature-dev** | End-to-end feature development workflow |

---

## Quick Reference: Official Plugin Skills

| Codebase Signal | Skill | Plugin |
|-----------------|-------|--------|
| Building plugins | skill-development | plugin-dev |
| Git commits | commit | commit-commands |
| React/Vue/Angular | frontend-design | frontend-design |
| Automation rules | writing-rules | hookify |
| Feature planning | feature-dev | feature-dev |

---

## Custom Project Skills

Create project-specific skills in `.agents/skills/<name>/SKILL.md`; the project contributes them only while the market plugin's project-layout scan is on.

### Skill Structure

```
.agents/skills/
└── my-skill/
    ├── SKILL.md           # Main instructions (required)
    ├── template.yaml      # Template to apply
    ├── scripts/
    │   └── validate.sh    # Script to run
    └── examples/          # Reference examples
```

### Frontmatter Reference

```yaml
---
name: skill-name
description: What this skill does and when to use it
disable-model-invocation: true  # Only user can invoke (for side effects)
user-invocable: false           # Only the model can invoke (for background knowledge)
---
```

A skill's body runs in the calling session. To keep heavy work out of the main context, have the body delegate through `subagent_run` to an agent role card rather than looking for a forked-context setting.

### Invocation Control

| Setting | User | Model | Use for |
|---------|------|--------|---------|
| (default) | ✓ | ✓ | General-purpose skills |
| `disable-model-invocation: true` | ✓ | ✗ | Side effects (deploy, send) |
| `user-invocable: false` | ✗ | ✓ | Background knowledge |

---

## Custom Skill Examples

### API Documentation with OpenAPI Template

Apply a YAML template to generate consistent API docs:

```
.agents/skills/api-doc/
├── SKILL.md
└── openapi-template.yaml
```

**SKILL.md:**
```yaml
---
name: api-doc
description: Generate OpenAPI documentation for an endpoint. Use when documenting API routes.
---

Generate OpenAPI documentation for the endpoint at $ARGUMENTS.

Use the template in [openapi-template.yaml](openapi-template.yaml) as the structure.

1. Read the endpoint code
2. Extract path, method, parameters, request/response schemas
3. Fill in the template with actual values
4. Output the completed YAML
```

**openapi-template.yaml:**
```yaml
paths:
  /{path}:
    {method}:
      summary: ""
      description: ""
      parameters: []
      requestBody:
        content:
          application/json:
            schema: {}
      responses:
        "200":
          description: ""
          content:
            application/json:
              schema: {}
```

---

### Database Migration Generator with Script

Generate and validate migrations using a bundled script:

```
.agents/skills/create-migration/
├── SKILL.md
└── scripts/
    └── validate-migration.sh
```

**SKILL.md:**
```yaml
---
name: create-migration
description: Create a database migration file
disable-model-invocation: true
---

Create a migration for: $ARGUMENTS

1. Generate migration file in `migrations/` with timestamp prefix
2. Include up and down functions
3. Run validation: `bash ~/.dsh/skills/create-migration/scripts/validate-migration.sh`
4. Report any issues found
```

**scripts/validate-migration.sh:**
```bash
#!/bin/bash
# Validate migration syntax
npx prisma validate 2>&1 || echo "Validation failed"
```

---

### Test Generator with Examples

Generate tests following project patterns:

```
.agents/skills/gen-test/
├── SKILL.md
└── examples/
    ├── unit-test.ts
    └── integration-test.ts
```

**SKILL.md:**
```yaml
---
name: gen-test
description: Generate tests for a file following project conventions
disable-model-invocation: true
---

Generate tests for: $ARGUMENTS

Reference these examples for the expected patterns:
- Unit tests: [examples/unit-test.ts](examples/unit-test.ts)
- Integration tests: [examples/integration-test.ts](examples/integration-test.ts)

1. Analyze the source file
2. Identify functions/methods to test
3. Generate tests matching project conventions
4. Place in appropriate test directory
```

---

### Component Generator with Template

Scaffold new components from a template:

```
.agents/skills/new-component/
├── SKILL.md
└── templates/
    ├── component.tsx.template
    ├── component.test.tsx.template
    └── component.stories.tsx.template
```

**SKILL.md:**
```yaml
---
name: new-component
description: Scaffold a new React component with tests and stories
disable-model-invocation: true
---

Create component: $ARGUMENTS

Use templates in [templates/](templates/) directory:
1. Generate component from component.tsx.template
2. Generate tests from component.test.tsx.template
3. Generate Storybook story from component.stories.tsx.template

Replace {{ComponentName}} with the PascalCase name.
Replace {{component-name}} with the kebab-case name.
```

---

### PR Review with Checklist

Review PRs against a project-specific checklist:

```
.agents/skills/pr-check/
├── SKILL.md
└── checklist.md
```

**SKILL.md:**
```yaml
---
name: pr-check
description: Review PR against project checklist
disable-model-invocation: true
---

## PR Context
- Diff: run `gh pr diff` first
- Description: run `gh pr view` first

Review against [checklist.md](checklist.md).

For each item, mark ✅ or ❌ with explanation.
```

**checklist.md:**
```markdown
## PR Checklist

- [ ] Tests added for new functionality
- [ ] No console.log statements
- [ ] Error handling includes user-facing messages
- [ ] API changes are backwards compatible
- [ ] Database migrations are reversible
```

---

### Release Notes Generator

Generate release notes from git history:

**SKILL.md:**
```yaml
---
name: release-notes
description: Generate release notes from commits since last tag
disable-model-invocation: true
---

## Recent Changes
- Commits since last tag: run `git log $(git describe --tags --abbrev=0)..HEAD --oneline` first
- Last tag: run `git describe --tags --abbrev=0` first

Generate release notes:
1. Group commits by type (feat, fix, docs, etc.)
2. Write user-friendly descriptions
3. Highlight breaking changes
4. Format as markdown
```

---

### Project Conventions (Model-only)

Background knowledge the agent applies automatically:

**SKILL.md:**
```yaml
---
name: project-conventions
description: Code style and patterns for this project. Apply when writing or reviewing code.
user-invocable: false
---

## Naming Conventions
- React components: PascalCase
- Utilities: camelCase
- Constants: UPPER_SNAKE_CASE
- Files: kebab-case

## Patterns
- Use `Result<T, E>` for fallible operations, not exceptions
- Prefer composition over inheritance
- All API responses use `{ data, error, meta }` shape

## Forbidden
- No `any` types
- No `console.log` in production code
- No synchronous file I/O
```

---

### Environment Setup

Onboard new developers with setup script:

```
.agents/skills/setup-dev/
├── SKILL.md
└── scripts/
    └── check-prerequisites.sh
```

**SKILL.md:**
```yaml
---
name: setup-dev
description: Set up development environment for new contributors
disable-model-invocation: true
---

Set up development environment:

1. Check prerequisites: `bash scripts/check-prerequisites.sh`
2. Install dependencies: `npm install`
3. Copy environment template: `cp .env.example .env`
4. Set up database: `npm run db:setup`
5. Verify setup: `npm test`

Report any issues encountered.
```

---

## Argument Patterns

| Pattern | Meaning | Example |
|---------|---------|---------|
| `$ARGUMENTS` | All args as string | `/deploy staging` → "staging" |

Arguments are appended as `ARGUMENTS: <value>` if `$ARGUMENTS` isn't in the skill.

## Dynamic Context Injection

The source format supports inline bash with the `` !`command` `` syntax: the command runs before the skill content reaches the model and its output replaces the placeholder. Support for inline execution varies by runtime, so the portable form is a first instruction that runs the command and reads its output before continuing:

```markdown
## Current State
- Branch: run `git branch --show-current` and report it
- Status: run `git status --short` and report it
```
