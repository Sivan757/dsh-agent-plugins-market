#!/bin/bash
# Every scenario: label, scripted mock reply, and the flags. One label per
# question, so the capture index can be filtered afterwards.
set -uo pipefail
ROOT=/tmp/cc-state
WORK=$ROOT/work
CFG=$ROOT/config
MOCK=/tmp/cc-mock
RUN=/tmp/cc-scenarios/run.sh

script() { echo "$1" > $MOCK/SCRIPT.json; }
text_ok() { script '{"type":"text","text":"ok"}'; }

# 00 — nothing configured: the cleanest baseline.
mkdir -p $ROOT/empty
text_ok
( cd $ROOT/empty && echo 00-empty > $MOCK/CURRENT && rm -f $MOCK/turns-*.txt && CLAUDE_CONFIG_DIR=$CFG claude -p 'hello' --output-format json >/dev/null 2>&1 )
echo 'ran 00-empty'

# 01 — project and user memory.
text_ok; $RUN 01-memory -p 'hello' --output-format json >/dev/null 2>&1; echo 'ran 01-memory'

# 02 — a Bash tool call and its result envelope.
script '{"steps":[{"type":"tool_use","tool":{"name":"Bash","input":{"command":"echo hi","description":"Print hi"}}},{"type":"text","text":"done"}]}'
$RUN 02-bash -p 'run echo hi' --output-format json >/dev/null 2>&1; echo 'ran 02-bash'

# 03 — plan mode.
text_ok; $RUN 03-plan -p 'plan a refactor' --permission-mode plan --output-format json >/dev/null 2>&1; echo 'ran 03-plan'

# 04 — a skill invoked by name.
text_ok; $RUN 04-skill -p '/db-audit the orders table' --output-format json >/dev/null 2>&1; echo 'ran 04-skill'

# 05 — a project slash command with an argument.
text_ok; $RUN 05-command -p '/ship feat/x' --output-format json >/dev/null 2>&1; echo 'ran 05-command'

# 06 — a subagent spawn.
script '{"steps":[{"type":"tool_use","tool":{"name":"Agent","input":{"description":"audit","subagent_type":"auditor","prompt":"audit src/index.ts"}}},{"type":"text","text":"done"}]}'
$RUN 06-subagent -p 'audit the diff' --output-format json >/dev/null 2>&1; echo 'ran 06-subagent'

# 07 — hooks on every event.
cat > $CFG/settings-hooks.json <<'EOF'
{
  "hooks": {
    "SessionStart": [{ "hooks": [{ "type": "command", "command": "echo SESSION_START_CONTEXT" }] }],
    "UserPromptSubmit": [{ "hooks": [{ "type": "command", "command": "echo USER_PROMPT_CONTEXT" }] }],
    "PreToolUse": [{ "matcher": "Bash", "hooks": [{ "type": "command", "command": "echo PRE_TOOL_CONTEXT" }] }],
    "PostToolUse": [{ "matcher": "Bash", "hooks": [{ "type": "command", "command": "echo POST_TOOL_CONTEXT" }] }],
    "Stop": [{ "hooks": [{ "type": "command", "command": "echo STOP_CONTEXT" }] }]
  }
}
EOF
node -e "
  const fs=require('fs');
  const base=JSON.parse(fs.readFileSync('$CFG/settings.json','utf8'));
  const hooks=JSON.parse(fs.readFileSync('$CFG/settings-hooks.json','utf8')).hooks;
  fs.writeFileSync('$CFG/settings.json', JSON.stringify({...base, hooks}, null, 2));
"
script '{"steps":[{"type":"tool_use","tool":{"name":"Bash","input":{"command":"echo hi"}}},{"type":"text","text":"done"}]}'
$RUN 07-hooks -p 'run echo hi' --output-format json >/dev/null 2>&1; echo 'ran 07-hooks'
node -e "
  const fs=require('fs');
  const s=JSON.parse(fs.readFileSync('$CFG/settings.json','utf8'));
  delete s.hooks;
  fs.writeFileSync('$CFG/settings.json', JSON.stringify(s, null, 2));
"

# 08 — the tool-result advice path with a read of a big file.
script '{"steps":[{"type":"tool_use","tool":{"name":"Read","input":{"file_path":"CLAUDE.md"}}},{"type":"text","text":"done"}]}'
$RUN 08-read -p 'read CLAUDE.md' --output-format json >/dev/null 2>&1; echo 'ran 08-read'

# 09 — after compaction: force it with the documented override.
text_ok; CLAUDE_AUTOCOMPACT_PCT_OVERRIDE=1 $RUN 09-compact -p 'hello' --output-format json >/dev/null 2>&1; echo 'ran 09-compact'

echo '=== all scenarios done'
node -e "
  const fs=require('fs');
  const idx=JSON.parse(fs.readFileSync('/tmp/cc-mock/index.json','utf8'));
  for (const r of idx) console.log(r.label.padEnd(12), r.id.padEnd(20), 'sys', r.systemBlocks, 'msgs', r.messages, 'tools', r.tools, r.requestBytes+'B', r.tags.filter(t=>t.includes('system')||t.includes('hook')).join(','));
"