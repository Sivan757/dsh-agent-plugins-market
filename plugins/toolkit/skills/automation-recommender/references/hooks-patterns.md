# Hooks Recommendations

Hooks automatically run commands in response to DeepSeek Harness events. They're ideal for enforcement and automation that should happen consistently.

**Note**: These are common patterns. Use web search to find hooks for tools/frameworks not listed here to recommend the best hooks for the user.

## Auto-Formatting Hooks

### Prettier (JavaScript/TypeScript)
| Detection | File Exists |
|-----------|-------------|
| `.prettierrc`, `.prettierrc.json`, `prettier.config.js` | ✓ |

**Recommend**: PostToolUse hook on edit/write to auto-format
**Value**: Code stays formatted without thinking about it

### ESLint (JavaScript/TypeScript)
| Detection | File Exists |
|-----------|-------------|
| `.eslintrc`, `.eslintrc.json`, `eslint.config.js` | ✓ |

**Recommend**: PostToolUse hook on edit/write to auto-fix
**Value**: Lint errors fixed automatically

### Black/isort (Python)
| Detection | File Exists |
|-----------|-------------|
| `pyproject.toml` with black/isort, `.black`, `setup.cfg` | ✓ |

**Recommend**: PostToolUse hook to format Python files
**Value**: Consistent Python formatting

### Ruff (Python - Modern)
| Detection | File Exists |
|-----------|-------------|
| `ruff.toml`, `pyproject.toml` with `[tool.ruff]` | ✓ |

**Recommend**: PostToolUse hook for lint + format
**Value**: Fast, comprehensive Python linting

### gofmt (Go)
| Detection | File Exists |
|-----------|-------------|
| `go.mod` | ✓ |

**Recommend**: PostToolUse hook to run gofmt
**Value**: Standard Go formatting

### rustfmt (Rust)
| Detection | File Exists |
|-----------|-------------|
| `Cargo.toml` | ✓ |

**Recommend**: PostToolUse hook to run rustfmt
**Value**: Standard Rust formatting

---

## Type Checking Hooks

### TypeScript
| Detection | File Exists |
|-----------|-------------|
| `tsconfig.json` | ✓ |

**Recommend**: PostToolUse hook to run tsc --noEmit
**Value**: Catch type errors immediately

### mypy/pyright (Python)
| Detection | File Exists |
|-----------|-------------|
| `mypy.ini`, `pyrightconfig.json`, pyproject.toml with mypy | ✓ |

**Recommend**: PostToolUse hook for type checking
**Value**: Catch type errors in Python

---

## Protection Hooks

### Block Sensitive File Edits
| Detection | Presence Of |
|-----------|-------------|
| `.env`, `.env.local`, `.env.production` | Environment files |
| `credentials.json`, `secrets.yaml` | Secret files |
| `.git/` directory | Git internals |

**Recommend**: PreToolUse hook that blocks edit/write to these paths
**Value**: Prevent accidental secret exposure or git corruption

### Block Lock File Edits
| Detection | Presence Of |
|-----------|-------------|
| `package-lock.json`, `yarn.lock`, `pnpm-lock.yaml` | JS lock files |
| `Cargo.lock`, `poetry.lock`, `Pipfile.lock` | Other lock files |

**Recommend**: PreToolUse hook that blocks direct edits
**Value**: Lock files should only change via package manager

---

## Test Runner Hooks

### Jest (JavaScript/TypeScript)
| Detection | Presence Of |
|-----------|-------------|
| `jest.config.js`, `jest` in package.json | Jest configured |
| `__tests__/`, `*.test.ts`, `*.spec.ts` | Test files exist |

**Recommend**: PostToolUse hook to run related tests after edit
**Value**: Immediate test feedback on changes

### pytest (Python)
| Detection | Presence Of |
|-----------|-------------|
| `pytest.ini`, `pyproject.toml` with pytest | pytest configured |
| `tests/`, `test_*.py` | Test files exist |

**Recommend**: PostToolUse hook to run pytest on changed files
**Value**: Immediate test feedback

---

## Quick Reference: Detection → Recommendation

| If You See | Recommend This Hook |
|------------|-------------------|
| Prettier config | Auto-format on edit/write |
| ESLint config | Auto-lint on edit/write |
| Ruff/Black config | Auto-format Python |
| tsconfig.json | Type-check on edit |
| Test directory | Run related tests on edit |
| .env files | Block .env edits |
| Lock files | Block lock file edits |
| Go project | gofmt on edit |
| Rust project | rustfmt on edit |

---

## Notification Hooks

Notification hooks run when DeepSeek Harness signals that the agent needs attention. The `Notification` event does not exist in this harness, so use the nearest supported events: `Stop` fires when the agent finishes a turn and is waiting for input, and `PreToolUse` fires before a tool runs. Use matchers to filter by tool name.

### Permission Alerts
| Event | Matcher | Use Case |
|-------|---------|----------|
| `PreToolUse` | `.*` | Alert before a tool runs |

**Recommend**: Play sound, send desktop notification, or log tool calls
**Value**: Never miss a tool call when multitasking

### Idle Notifications
| Event | Matcher | Use Case |
|-------|---------|----------|
| `Stop` | — | Alert when the agent is waiting for input |

**Recommend**: Play sound or send notification when the agent needs attention
**Value**: Know when the agent is ready for your input

### Example Configuration

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": ".*",
        "hooks": [
          {
            "type": "command",
            "command": "afplay /System/Library/Sounds/Ping.aiff"
          }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "osascript -e 'display notification \"The agent is waiting\" with title \"DeepSeek Harness\"'"
          }
        ]
      }
    ]
  }
}
```

### Available Matchers

| Event | Matcher | Triggers When |
|-------|---------|---------------|
| `PreToolUse` | tool-name regex | A tool is about to run |
| `Stop` | — | The agent finishes a turn |

---

## Quick Reference: Detection → Recommendation

| If You See | Recommend This Hook |
|------------|-------------------|
| Prettier config | Auto-format on edit/write |
| ESLint config | Auto-lint on edit/write |
| Ruff/Black config | Auto-format Python |
| tsconfig.json | Type-check on edit |
| Test directory | Run related tests on edit |
| .env files | Block .env edits |
| Lock files | Block lock file edits |
| Go project | gofmt on edit |
| Rust project | rustfmt on edit |
| Multitasking workflow | Stop hooks for alerts |

---

## Hook Placement

Hooks go in `.agents/hooks/hooks.json`:

```
.agents/
└── hooks/
    └── hooks.json  ← Hook configurations here
```

Recommend creating the `.agents/hooks/` directory if it doesn't exist.
