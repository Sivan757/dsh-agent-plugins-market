#!/bin/bash
set -uo pipefail
ROOT=/tmp/cc-state
CFG=$ROOT/config
MOCK=/tmp/cc-mock
RUN=/tmp/cc-scenarios/run.sh

# 16 — the todo tool family, to see how planning state reaches the model.
cat > $MOCK/SCRIPT.json <<'EOF'
{"steps":[
  {"type":"tool_use","tool":{"name":"TaskCreate","input":{"subject":"Audit schema","description":"List missing indexes"}}},
  {"type":"text","text":"created"}
]}
EOF
$RUN 16-todo -p 'track the audit' --output-format json >/dev/null 2>&1
echo 'ran 16-todo'

# 17 — a denied tool, to see the error envelope.
node -e "
  const fs=require('fs');
  const p='$CFG/settings.json';
  const s=JSON.parse(fs.readFileSync(p,'utf8'));
  s.permissions={ deny: ['Bash(echo blocked_*)'] };
  fs.writeFileSync(p, JSON.stringify(s, null, 2));
"
echo '{"steps":[{"type":"tool_use","tool":{"name":"Bash","input":{"command":"echo blocked_thing"}}},{"type":"text","text":"done"}]}' > $MOCK/SCRIPT.json
$RUN 17-denied -p 'run the blocked command' --output-format json >/dev/null 2>&1
node -e "
  const fs=require('fs');
  const p='$CFG/settings.json';
  const s=JSON.parse(fs.readFileSync(p,'utf8'));
  delete s.permissions.deny;
  fs.writeFileSync(p, JSON.stringify(s, null, 2));
"
echo 'ran 17-denied'

# 18 — a failing tool, to see how an error result is framed.
echo '{"steps":[{"type":"tool_use","tool":{"name":"Read","input":{"file_path":"/tmp/cc-state/does-not-exist.txt"}}},{"type":"text","text":"done"}]}' > $MOCK/SCRIPT.json
$RUN 18-tool-error -p 'read a missing file' --output-format json >/dev/null 2>&1
echo 'ran 18-tool-error'

node -e "
  const fs=require('fs');
  const idx=JSON.parse(fs.readFileSync('$MOCK/index.json','utf8'));
  for (const r of idx.filter(r=>/^(16|17|18)-/.test(r.label))) console.log(r.label.padEnd(14), r.id.padEnd(22), 'msgs', r.messages, r.requestBytes+'B');
"