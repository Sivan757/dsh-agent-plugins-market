const http = require('node:http')
const fs = require('node:fs')
const path = require('node:path')

const OUT = '/tmp/cc-mock'
fs.mkdirSync(OUT, { recursive: true })
let seq = 0

function label() {
  try {
    return fs.readFileSync(path.join(OUT, 'CURRENT'), 'utf8').trim() || 'unlabeled'
  } catch {
    return 'unlabeled'
  }
}

function script() {
  try {
    return JSON.parse(fs.readFileSync(path.join(OUT, 'SCRIPT.json'), 'utf8'))
  } catch {
    return { type: 'text', text: 'ok' }
  }
}

function turnCount(tag) {
  const file = path.join(OUT, 'turns-' + tag + '.txt')
  let n = 0
  try {
    n = Number(fs.readFileSync(file, 'utf8')) || 0
  } catch {}
  fs.writeFileSync(file, String(n + 1))
  return n
}

function record(bodyText) {
  seq += 1
  const id =
    String(seq).padStart(3, '0') +
    '-' +
    label()
      .replace(/[^a-zA-Z0-9._-]+/g, '-')
      .slice(0, 70)
  let parsed = null
  try {
    parsed = JSON.parse(bodyText)
  } catch {}
  fs.writeFileSync(path.join(OUT, id + '.json'), JSON.stringify(parsed === null ? bodyText : parsed, null, 2))
  const indexFile = path.join(OUT, 'index.json')
  let index = []
  try {
    index = JSON.parse(fs.readFileSync(indexFile, 'utf8'))
  } catch {}
  const text = parsed === null ? bodyText : JSON.stringify(parsed)
  index.push({
    id,
    label: label(),
    model: parsed && parsed.model,
    stream: !!(parsed && parsed.stream),
    systemBlocks: parsed && Array.isArray(parsed.system) ? parsed.system.length : 0,
    systemChars: parsed && Array.isArray(parsed.system) ? parsed.system.reduce((n, b) => n + String(b.text || '').length, 0) : 0,
    messages: parsed && Array.isArray(parsed.messages) ? parsed.messages.length : 0,
    tools: parsed && Array.isArray(parsed.tools) ? parsed.tools.length : 0,
    toolNames: parsed && Array.isArray(parsed.tools) ? parsed.tools.map(t => t.name) : [],
    requestBytes: bodyText.length,
    reminder: text.includes('system-reminder'),
    tags: [...new Set(text.match(/<[a-zA-Z][a-zA-Z0-9_-]*>/g) || [])]
  })
  fs.writeFileSync(indexFile, JSON.stringify(index, null, 2))
  return id
}

function sse(res, events) {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' })
  for (const pair of events) {
    res.write('event: ' + pair[0] + '\n')
    res.write('data: ' + JSON.stringify(pair[1]) + '\n\n')
  }
  res.end()
}

function emitText(res, text) {
  sse(res, [
    [
      'message_start',
      {
        type: 'message_start',
        message: {
          id: 'msg_mock',
          type: 'message',
          role: 'assistant',
          model: 'mock',
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 1, output_tokens: 1 }
        }
      }
    ],
    ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }],
    ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } }],
    ['content_block_stop', { type: 'content_block_stop', index: 0 }],
    ['message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 5 } }],
    ['message_stop', { type: 'message_stop' }]
  ])
}

function emitTool(res, tool) {
  sse(res, [
    [
      'message_start',
      {
        type: 'message_start',
        message: {
          id: 'msg_mock',
          type: 'message',
          role: 'assistant',
          model: 'mock',
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 1, output_tokens: 1 }
        }
      }
    ],
    ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'toolu_mock_1', name: tool.name, input: {} } }],
    ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: JSON.stringify(tool.input) } }],
    ['content_block_stop', { type: 'content_block_stop', index: 0 }],
    ['message_delta', { type: 'message_delta', delta: { stop_reason: 'tool_use', stop_sequence: null }, usage: { output_tokens: 5 } }],
    ['message_stop', { type: 'message_stop' }]
  ])
}

http
  .createServer((req, res) => {
    const chunks = []
    req.on('data', c => chunks.push(c))
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8')
      const id = body ? record(body) : 'no-body'
      console.log('[mock]', id, req.method, req.url, body.length + 'B')
      if (String(req.url).includes('count_tokens')) {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ input_tokens: 1234 }))
        return
      }
      if (req.method !== 'POST' || !String(req.url).includes('messages')) {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ ok: true }))
        return
      }
      const plan = script()
      const step = plan.steps ? plan.steps[Math.min(turnCount(label()), plan.steps.length - 1)] : plan
      if (step.type === 'tool_use') emitTool(res, step.tool)
      else emitText(res, step.text || 'ok')
    })
  })
  .listen(8789, '127.0.0.1', () => console.log('mock anthropic on 8789'))
