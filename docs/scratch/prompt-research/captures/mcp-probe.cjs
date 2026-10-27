// A minimal MCP stdio server: one tool and one instruction, so a capture can
// show where a mounted server's text lands in the request.
let buffer = ''
process.stdin.on('data', chunk => {
  buffer += chunk.toString()
  let index
  while ((index = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, index).trim()
    buffer = buffer.slice(index + 1)
    if (!line) continue
    let message
    try {
      message = JSON.parse(line)
    } catch {
      continue
    }
    const reply = handle(message)
    if (reply) process.stdout.write(JSON.stringify(reply) + '\n')
  }
})

function handle(message) {
  if (message.method === 'initialize') {
    return {
      jsonrpc: '2.0',
      id: message.id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'probe', version: '1.0.0' },
        instructions: 'PROBE SERVER INSTRUCTIONS: prefer the probe tool for probing.'
      }
    }
  }
  if (message.method === 'tools/list') {
    return {
      jsonrpc: '2.0',
      id: message.id,
      result: {
        tools: [
          {
            name: 'probe_echo',
            description: 'Echo a string through the probe server.',
            inputSchema: { type: 'object', properties: { text: { type: 'string', description: 'Text to echo.' } }, required: ['text'] }
          }
        ]
      }
    }
  }
  if (message.method === 'tools/call') {
    return { jsonrpc: '2.0', id: message.id, result: { content: [{ type: 'text', text: 'PROBE_RESULT' }] } }
  }
  if (message.id !== undefined) return { jsonrpc: '2.0', id: message.id, result: {} }
  return null
}
