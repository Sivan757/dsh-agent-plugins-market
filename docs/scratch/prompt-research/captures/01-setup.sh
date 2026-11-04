#!/bin/bash
# Rebuild a fresh probe workspace: one project CLAUDE.md, one skill, one slash
# command, one subagent, one hook set, and an isolated Claude config dir.
set -uo pipefail
ROOT=/tmp/cc-state
MOCK=/tmp/cc-mock
rm -rf $ROOT
mkdir -p $ROOT/work/.claude/skills/db-audit $ROOT/work/.claude/commands $ROOT/work/.claude/agents $ROOT/config

cat > $ROOT/work/CLAUDE.md <<'EOF'
# Project rules

Run the tests before claiming a change works.
Prefer small diffs.
EOF

cat > $ROOT/config/CLAUDE.md <<'EOF'
# User rules

Answer in Chinese.
EOF

cat > $ROOT/work/.claude/skills/db-audit/SKILL.md <<'EOF'
---
name: db-audit
description: Audit a database schema for missing indexes. Use when asked about slow queries.
---

Inspect the schema, list every missing index, and rank by estimated cost.
EOF

cat > $ROOT/work/.claude/commands/ship.md <<'EOF'
---
description: Ship one change
argument-hint: <branch>
---

Ship $1: run the gate suite, then open a PR titled "$1".
EOF

cat > $ROOT/work/.claude/agents/auditor.md <<'EOF'
---
name: auditor
description: Reviews a diff for missed edge cases
tools: Read, Grep
---

You are a diff auditor. Report only findings you can point at a line for.
EOF

cat > $ROOT/config/settings.json <<'EOF'
{
  "cleanupPeriodDays": 3650,
  "env": {
    "ANTHROPIC_AUTH_TOKEN": "sk-mock",
    "ANTHROPIC_BASE_URL": "http://127.0.0.1:8789",
    "ANTHROPIC_MODEL": "claude-sonnet-4-5-20250929",
    "NO_PROXY": "localhost,127.0.0.1,::1",
    "API_TIMEOUT_MS": "600000",
    "CLAUDE_CODE_MAX_RETRIES": "0"
  },
  "permissions": { "defaultMode": "bypassPermissions" }
}
EOF

echo '{"type":"text","text":"ok"}' > $MOCK/SCRIPT.json
echo "prepared $ROOT"