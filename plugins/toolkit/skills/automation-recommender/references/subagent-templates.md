# Subagent Recommendations

Subagents are specialized agent instances that run in parallel, each with their own context window and tool access. They're ideal for focused reviews, analysis, or generation tasks.

**Note**: These are common patterns. Design custom subagents based on the codebase's specific review and analysis needs.

## Code Review Agents

### code-reviewer
**Best for**: Automated code quality checks on large codebases

| Recommend When | Detection |
|----------------|-----------|
| Large codebase (>500 files) | File count |
| Frequent code changes | Active development |
| Team wants consistent review | Quality focus |

**Value**: Runs code review in parallel while you continue working
**Model**: inherit (balanced quality/speed)
**Tools**: read, grep, glob, bash

---

### security-reviewer
**Best for**: Security-focused code review

| Recommend When | Detection |
|----------------|-----------|
| Auth code present | `auth/`, `login`, `session` patterns |
| Payment processing | `stripe`, `payment`, `billing` patterns |
| User data handling | `user`, `profile`, `pii` patterns |
| API keys in code | Environment variable patterns |

**Value**: Catches OWASP vulnerabilities, auth issues, data exposure
**Model**: inherit
**Tools**: read, grep, glob (read-only for safety)

---

### test-writer
**Best for**: Generating comprehensive test coverage

| Recommend When | Detection |
|----------------|-----------|
| Low test coverage | Few test files vs source files |
| Test suite exists | `tests/`, `__tests__/` present |
| Testing framework configured | jest, pytest, vitest in deps |

**Value**: Generates tests matching project conventions
**Model**: inherit
**Tools**: read, write, grep, glob

---

## Specialized Agents

### api-documenter
**Best for**: API documentation generation

| Recommend When | Detection |
|----------------|-----------|
| REST endpoints | Express routes, FastAPI paths |
| GraphQL schema | `.graphql` files |
| OpenAPI exists | `openapi.yaml`, `swagger.json` |
| Undocumented APIs | Routes without docs |

**Value**: Generates OpenAPI specs, endpoint documentation
**Model**: inherit
**Tools**: read, write, grep, glob

---

### performance-analyzer
**Best for**: Finding performance bottlenecks

| Recommend When | Detection |
|----------------|-----------|
| Database queries | ORM usage, raw SQL |
| High-traffic code | API endpoints, hot paths |
| Performance complaints | User reports slowness |
| Complex algorithms | Nested loops, recursion |

**Value**: Finds N+1 queries, O(n²) algorithms, memory leaks
**Model**: inherit
**Tools**: read, grep, glob, bash

---

### ui-reviewer
**Best for**: Frontend accessibility and UX review

| Recommend When | Detection |
|----------------|-----------|
| React/Vue/Angular | Frontend framework detected |
| Component library | `components/` directory |
| User-facing UI | Not just API project |

**Value**: Catches accessibility issues, UX problems, responsive design gaps
**Model**: inherit
**Tools**: read, grep, glob

---

## Utility Agents

### dependency-updater
**Best for**: Safe dependency updates

| Recommend When | Detection |
|----------------|-----------|
| Outdated deps | `npm outdated` has results |
| Security advisories | `npm audit` warnings |
| Major version behind | Significant version gaps |

**Value**: Updates dependencies incrementally with testing
**Model**: inherit
**Tools**: read, write, bash, grep

---

### migration-helper
**Best for**: Framework/version migrations

| Recommend When | Detection |
|----------------|-----------|
| Major upgrade needed | Framework version very old |
| Breaking changes coming | Deprecation warnings |
| Refactoring planned | Architectural changes |

**Value**: Plans and executes migrations incrementally
**Model**: inherit (complex reasoning needed)
**Tools**: read, write, grep, glob, bash

---

## Quick Reference: Detection → Recommendation

| If You See | Recommend Subagent |
|------------|-------------------|
| Large codebase | code-reviewer |
| Auth/payment code | security-reviewer |
| Few tests | test-writer |
| API routes | api-documenter |
| Database heavy | performance-analyzer |
| Frontend components | ui-reviewer |
| Outdated packages | dependency-updater |
| Old framework version | migration-helper |

---

## Subagent Placement

Subagents are agent role cards under a plugin's `com.deepseek.harness/agents/` or the project's `.agents/agents/`, delegated to with `subagent_run`:

```
.agents/
└── agents/
    ├── code-reviewer.md
    ├── security-reviewer.md
    └── test-writer.md
```

---

## Model Selection Guide

Agent role cards inherit the session's route with `model: inherit` unless they pin an exact `provider` and `model`. Choose the depth of reasoning per card:

| `reasoningEffort` | Best For | Trade-off |
|-------------------|----------|-----------|
| **low** | Simple, repetitive checks | Fast, cheap, less thorough |
| **medium** | Most review/analysis tasks | Balanced (recommended default) |
| **high** | Complex migrations, architecture | Thorough, slower, more expensive |

---

## Tool Access Guide

| Access Level | Tools | Use Case |
|--------------|-------|----------|
| Read-only | read, grep, glob | Reviews, analysis |
| Writing | + write | Code generation, docs |
| Full | + bash | Migrations, testing |
