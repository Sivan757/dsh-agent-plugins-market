#!/bin/bash
# One scenario run: label it, run Claude Code against the local mock, keep every
# request body it sent. All state that could leak between scenarios lives under
# /tmp/cc-state and is rebuilt per run.
set -uo pipefail

LABEL="$1"; shift
ROOT=/tmp/cc-state
WORK=$ROOT/work
CFG=$ROOT/config
MOCK=/tmp/cc-mock

echo "$LABEL" > $MOCK/CURRENT
rm -f $MOCK/turns-*.txt

cd "$WORK" || exit 1
CLAUDE_CONFIG_DIR=$CFG claude "$@" 2>&1 | head -c 2000
echo
echo "=== $LABEL done; captures:"
node -e "
  const fs=require('fs');
  const idx=JSON.parse(fs.readFileSync('$MOCK/index.json','utf8'));
  const rows=idx.filter(r=>r.label==='$LABEL');
  for (const r of rows) console.log(' ', r.id, 'sys', r.systemBlocks, 'msgs', r.messages, 'tools', r.tools, r.requestBytes+'B');
"