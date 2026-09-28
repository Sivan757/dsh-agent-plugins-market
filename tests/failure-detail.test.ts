import { describe, expect, it } from 'vitest'
import { causeMessages } from '../src/runtime/host/failure-detail.js'

describe('failure detail', () => {
  it('collects the messages under the outermost error, outermost first', () => {
    const error = new Error('wrapper', { cause: new Error('middle', { cause: new Error('root') }) })
    expect(causeMessages(error)).toEqual(['middle', 'root'])
  })

  it('reads a thrown string and a plain object carrying a message', () => {
    expect(causeMessages(new Error('wrapper', { cause: 'spawn npx ENOENT' }))).toEqual(['spawn npx ENOENT'])
    expect(causeMessages({ cause: { message: 'McpError: Request timed out' } })).toEqual(['McpError: Request timed out'])
  })

  it('redacts a URL the failure echoed', () => {
    const error = new Error('wrapper', { cause: new Error('connect failed: https://mcp.example.test/sse?token=abc123') })
    expect(causeMessages(error)).toEqual(['connect failed: https://mcp.example.test/sse?token=[redacted]'])
  })

  it('repeats nothing and stops when a chain points back at itself', () => {
    expect(causeMessages(new Error('wrapper', { cause: new Error('same', { cause: new Error('same') }) }))).toEqual(['same'])
    const loop = new Error('loop')
    ;(loop as { cause?: unknown }).cause = loop
    expect(causeMessages(new Error('wrapper', { cause: loop }))).toEqual(['loop'])
  })

  it('keeps the chain short', () => {
    let error = new Error('root')
    for (let depth = 0; depth < 8; depth++) error = new Error(`level ${depth}`, { cause: error })
    expect(causeMessages(error)).toHaveLength(4)
  })

  it('reports nothing when the error carries no chain', () => {
    expect(causeMessages(new Error('plain'))).toEqual([])
    expect(causeMessages(undefined)).toEqual([])
  })
})
