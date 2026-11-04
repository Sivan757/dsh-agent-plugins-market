#!/bin/bash
set -uo pipefail
ROOT=/tmp/cc-state
CFG=$ROOT/config
MOCK=/tmp/cc-mock
RUN=/tmp/cc-scenarios/run.sh

# 10 — a second user turn in the same session (resume), to see what repeats.
echo '{"type":"text","text":"ok"}' > $MOCK/SCRIPT.json
$RUN 10-turn1 -p 'first turn' --output-format json >/dev/null 2>&1
$RUN 10-resume -p 'second turn' --continue --output-format json >/dev/null 2>&1
echo 'ran 10-resume'

# 11 — thinking on.
echo '{"type":"text","text":"ok"}' > $MOCK/SCRIPT.json
$RUN 11-thinking -p 'hello' --output-format json --append-system-prompt 'EXTRA_APPENDED_LINE' >/dev/null 2>&1
echo 'ran 11-thinking'

# 12 — an MCP server mounted, to see how its tool and instructions appear.
cat > $ROOT/mcp.json <<'EOF'
{ "mcpServers": { "probe": { "type": "stdio", "command": "node", "args": ["/tmp/cc-scenarios/mcp-probe.cjs"] } } }
EOF
$RUN 12-mcp -p 'hello' --output-format json --mcp-config $ROOT/mcp.json >/dev/null 2>&1
echo 'ran 12-mcp'

# 13 — a bare /compact.
echo '{"type":"text","text":"ok"}' > $MOCK/SCRIPT.json
$RUN 13-compact-cmd -p '/compact' --output-format json >/dev/null 2>&1
echo 'ran 13-compact-cmd'

node -e "
  const fs=require('fs');
  const idx=JSON.parse(fs.readFileSync('/tmp/cc-mock/index.json','utf8'));
  for (const r of idx.filter(r=>/^(10|11|12|13)-/.test(r.label))) console.log(r.label.padEnd(14), r.id.padEnd(22), 'sys', r.systemBlocks, 'msgs', r.messages, 'tools', r.tools, r.requestBytes+'B');
"