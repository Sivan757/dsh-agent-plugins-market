#!/bin/bash
set -uo pipefail
ROOT=/tmp/cc-state
CFG=$ROOT/config
MOCK=/tmp/cc-mock
RUN=/tmp/cc-scenarios/run.sh

# 14 — an output style, set through settings.
node -e "
  const fs=require('fs');
  const p='$CFG/settings.json';
  const s=JSON.parse(fs.readFileSync(p,'utf8'));
  s.outputStyle='Probe Style';
  fs.writeFileSync(p, JSON.stringify(s, null, 2));
"
mkdir -p $ROOT/work/.claude/output-styles
cat > $ROOT/work/.claude/output-styles/probe-style.md <<'EOF'
---
name: Probe Style
description: Answer like a telegraph operator.
---

Answer in short telegrams. Drop articles.
EOF
echo '{"type":"text","text":"ok"}' > $MOCK/SCRIPT.json
$RUN 14-style -p 'hello' --output-format json >/dev/null 2>&1
node -e "
  const fs=require('fs');
  const p='$CFG/settings.json';
  const s=JSON.parse(fs.readFileSync(p,'utf8'));
  delete s.outputStyle;
  fs.writeFileSync(p, JSON.stringify(s, null, 2));
"
echo 'ran 14-style'

# 15 — hook JSON output with additionalContext and a deny, the two shapes our
# own hook support has to reproduce.
cat > $ROOT/hook-ctx.sh <<'EOF'
#!/bin/bash
cat > /dev/null
printf '%s' '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"PROBE_DENY_REASON"},"systemMessage":"PROBE_SYSTEM_MESSAGE","additionalContext":"PROBE_ADDITIONAL_CONTEXT"}'
EOF
cat > $ROOT/hook-ctx2.sh <<'EOF'
#!/bin/bash
cat > /dev/null
printf '%s' '{"hookSpecificOutput":{"hookEventName":"UserPromptSubmit","additionalContext":"PROBE_PROMPT_CONTEXT"}}'
EOF
chmod +x $ROOT/hook-ctx.sh $ROOT/hook-ctx2.sh
cat > $CFG/settings-hooks2.json <<'EOF'
{
  "hooks": {
    "UserPromptSubmit": [{ "hooks": [{ "type": "command", "command": "/tmp/cc-state/hook-ctx2.sh" }] }],
    "PreToolUse": [{ "matcher": "Bash", "hooks": [{ "type": "command", "command": "/tmp/cc-state/hook-ctx.sh" }] }]
  }
}
EOF
node -e "
  const fs=require('fs');
  const base=JSON.parse(fs.readFileSync('$CFG/settings.json','utf8'));
  const hooks=JSON.parse(fs.readFileSync('$CFG/settings-hooks2.json','utf8')).hooks;
  fs.writeFileSync('$CFG/settings.json', JSON.stringify({...base, hooks}, null, 2));
"
echo '{"steps":[{"type":"tool_use","tool":{"name":"Bash","input":{"command":"echo hi"}}},{"type":"text","text":"done"}]}' > $MOCK/SCRIPT.json
$RUN 15-hook-json -p 'run echo hi' --output-format json >/dev/null 2>&1
node -e "
  const fs=require('fs');
  const p='$CFG/settings.json';
  const s=JSON.parse(fs.readFileSync(p,'utf8'));
  delete s.hooks;
  fs.writeFileSync(p, JSON.stringify(s, null, 2));
"
echo 'ran 15-hook-json'

node -e "
  const fs=require('fs');
  const idx=JSON.parse(fs.readFileSync('$MOCK/index.json','utf8'));
  for (const r of idx.filter(r=>/^(14|15)-/.test(r.label))) console.log(r.label.padEnd(14), r.id.padEnd(22), 'sys', r.systemBlocks, 'msgs', r.messages, r.requestBytes+'B');
"