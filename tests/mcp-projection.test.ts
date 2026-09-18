import { describe, expect, it } from 'vitest'
import { AttachmentError } from '@deepseek-ai/dsh-attachment'
import { containsImage, extractText, prepareImageProjection } from '../src/runtime/mcp-client/projection.js'
import type { JsonValue } from '../src/runtime/mcp-client/host-contract.js'
import type { ToolExecution, ToolHost } from '../src/runtime/mcp-client/host-contract.js'

const PNG_BASE64 = Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString('base64')
const TOOL = 'weather__lookup'

function exec(agent?: unknown): ToolExecution {
  return { signal: new AbortController().signal, ...(agent === undefined ? {} : { agent: agent as ToolExecution['agent'] }) }
}

/** A host whose attachments and LLM services are supplied per test. */
function hostOf(services: Record<string, unknown>): ToolHost {
  return {
    logger: { error: () => {}, warn: () => {}, info: () => {} },
    tools: { register: () => () => {} },
    getService: (name: string) => services[name]
  }
}

function attachmentStore(overrides: Partial<{ saveImages: (...args: unknown[]) => Promise<unknown> }> = {}) {
  return {
    saveImages:
      overrides.saveImages ?? (async (images: ReadonlyArray<{ data: Buffer; mediaType: string }>) => images.map(image => `att:${image.mediaType}:${image.data.toString('hex')}`))
  }
}

function llmService(modalities?: string[], failure?: Error) {
  return {
    resolveModelInfo: async () => {
      if (failure !== undefined) throw failure
      return modalities === undefined ? undefined : { inputModalities: modalities }
    }
  }
}

/** The image-admitting agent shape the bridge hands to tools. */
const imageAgent = { options: { provider: 'deepseek', model: 'glm' } }

/** Wire blocks are plain JSON: every optional field absent stays absent. */
type WireBlock = Record<string, JsonValue>
const textOnly: WireBlock[] = [{ type: 'text', text: 'hello' }]
const imageBlock: WireBlock = { type: 'image', data: PNG_BASE64, mimeType: 'image/png' }

describe('MCP result text projection', () => {
  it('joins text runs and replaces every non-text block with its diagnostic', () => {
    const content: WireBlock[] = [
      { type: 'text', text: 'second' },
      { type: 'image', data: 'AAAA', mimeType: 'image/png' },
      { type: 'audio', mimeType: 'audio/wav' },
      { type: 'audio', data: 'AAAA' },
      { type: 'resource', uri: 'file:///tmp/a' },
      { type: 'resource_link', name: 'docs', uri: 'https://example.com/docs' },
      { type: 'resource_link', name: 'no-uri' },
      { type: 'resource_link', uri: 'https://example.com/anonymous' },
      { type: 'weird-type' }
    ]
    // Non-object wire values reach the projector too: the network boundary
    // sends them, and each one projects as its own unsupported-block note.
    const nonObjects: JsonValue[] = ['first', 42, null, [1, 2]]
    expect(extractText([...nonObjects, ...content], TOOL)).toBe(
      [
        '[unsupported MCP content block: expected an object]',
        '[unsupported MCP content block: expected an object]',
        '[unsupported MCP content block: expected an object]',
        '[unsupported MCP content block: expected an object]',
        'second',
        '[image unavailable: image/png; this result was not admitted to durable model context; raw image data remains available to programmatic callers]',
        '[audio result unsupported: audio/wav; raw audio data remains available to programmatic callers]',
        '[audio result unsupported: unknown media type; raw audio data remains available to programmatic callers]',
        '[embedded resource unsupported; raw resource data remains available to programmatic callers]',
        'Resource link: docs (https://example.com/docs)',
        '[resource link unavailable: the MCP block is missing its name or URI]',
        '[resource link unavailable: the MCP block is missing its name or URI]',
        '[unsupported MCP content type: weird-type]'
      ].join('\n')
    )
  })

  it('coalesces adjacent text into one run, skips an empty text block, and labels an empty result', () => {
    expect(extractText([{ type: 'text', text: 'a' }, { type: 'text' }, 'b', { type: 'text', text: 'c' }], TOOL)).toBe('a\n[unsupported MCP content block: expected an object]\nc')
    expect(
      extractText(
        [
          { type: 'text', text: 'a' },
          { type: 'text', text: 'b' }
        ],
        TOOL
      )
    ).toBe('a\nb')
    expect(extractText([], TOOL)).toBe(`(${TOOL} returned no model-visible content)`)
    expect(extractText([{ type: 'unknown' }], TOOL)).toBe('[unsupported MCP content type: unknown]')
  })

  it('reports whether any block is a declared image', () => {
    expect(containsImage(textOnly)).toBe(false)
    expect(containsImage([imageBlock])).toBe(true)
    expect(containsImage([{ type: 'image' }, imageBlock])).toBe(true)
    expect(containsImage(['nope'])).toBe(false)
  })
})

describe('MCP image projection refusals', () => {
  it('rejects undeclared media types and non-canonical base64 per block, keeping the batch ordering', async () => {
    const content: WireBlock[] = [
      { type: 'text', text: 'before' },
      { type: 'image', data: PNG_BASE64, mimeType: 'image/svg+xml' },
      { type: 'image', data: 'A===', mimeType: 'image/png' },
      { type: 'image', data: PNG_BASE64 },
      { type: 'image', data: PNG_BASE64, mimeType: 'image/png' },
      { type: 'text', text: 'after' }
    ]
    const blocks = await prepareImageProjection(hostOf({ attachments: attachmentStore(), llm: llmService(['image']) }), exec(), content, TOOL)
    expect(blocks).toEqual([
      { type: 'text', text: 'before' },
      {
        type: 'text',
        text: '[image unavailable: image/svg+xml; the declared media type is not PNG, JPEG, WebP, or GIF; raw image data remains available to programmatic callers]'
      },
      { type: 'text', text: '[image unavailable: image/png; the image data is not canonical base64; raw image data remains available to programmatic callers]' },
      {
        type: 'text',
        text: '[image unavailable: unknown media type; the declared media type is not PNG, JPEG, WebP, or GIF; raw image data remains available to programmatic callers]'
      },
      { type: 'text', text: '[image unavailable: image/png; another image in the same result was invalid; raw image data remains available to programmatic callers]' },
      { type: 'text', text: 'after' }
    ])
  })

  it('decodes only canonical bytes: URL-safe aliases fail the canonical form', async () => {
    // '-A' is a URL-safe spelling of '+A'; canonical base64 must differ.
    const urlSafe = { type: 'image', data: '-A', mimeType: 'image/png' }
    const blocks = await prepareImageProjection(hostOf({ attachments: attachmentStore(), llm: llmService(['image']) }), exec(imageAgent), [urlSafe], TOOL)
    expect((blocks[0] as { text: string }).text).toContain('the image data is not canonical base64')
  })

  it('refuses the whole batch when no attachment store is mounted, leaving text blocks intact', async () => {
    const blocks = await prepareImageProjection(hostOf({}), exec(), [imageBlock, { type: 'text', text: 'x' }], TOOL)
    const [first, second] = blocks as Array<{ type: string; text: string }>
    if (first === undefined || second === undefined) throw new Error('expected both blocks to project')
    expect(first.text).toContain('no attachment store is mounted')
    expect(second.text).toBe('x')
  })

  it('refuses the batch when the model route cannot be resolved or verified', async () => {
    const unresolvable = await prepareImageProjection(hostOf({ attachments: attachmentStore(), llm: llmService(['image']) }), exec(), [imageBlock], TOOL)
    expect((unresolvable[0] as { text: string }).text).toContain('the current model route could not be resolved')

    const routed = { session: { requestHeader: () => ({ config: { provider: 'deepseek', model: 'glm' } }) } }
    const rejectedRoute = await prepareImageProjection(
      hostOf({ attachments: attachmentStore(), llm: llmService(undefined, new Error('registry offline')) }),
      exec(routed),
      [imageBlock],
      TOOL
    )
    expect((rejectedRoute[0] as { text: string }).text).toContain('the current model route could not be verified')
  })

  it('refuses a model that does not declare image input and honours a caller cancel', async () => {
    const textOnlyModel = await prepareImageProjection(hostOf({ attachments: attachmentStore(), llm: llmService(['text']) }), exec(imageAgent), [imageBlock], TOOL)
    expect((textOnlyModel[0] as { text: string }).text).toContain('model "glm" does not declare image input')

    const controller = new AbortController()
    controller.abort()
    const canceled = await prepareImageProjection(
      hostOf({ attachments: attachmentStore(), llm: llmService(['image']) }),
      { signal: controller.signal, agent: imageAgent },
      [imageBlock],
      TOOL
    )
    expect((canceled[0] as { text: string }).text).toContain('the tool call was canceled before image storage')
  })

  it('keeps raw availability wording when durable storage rejects the batch', async () => {
    const store = attachmentStore({
      saveImages: async () => {
        throw new Error('disk full')
      }
    })
    const blocks = await prepareImageProjection(hostOf({ attachments: store, llm: llmService(['image']) }), exec(imageAgent), [imageBlock], TOOL)
    expect((blocks[0] as { text: string }).text).toBe(
      '[image unavailable: image/png; durable image storage rejected the result; raw image data remains available to programmatic callers]'
    )
  })

  it('tells a caller-correctable admission failure apart from a storage fault', async () => {
    const admission = attachmentStore({
      saveImages: async () => {
        throw new AttachmentError('Image upload is not canonical base64.', 'INVALID_IMAGE_BASE64')
      }
    })
    const admitted = await prepareImageProjection(hostOf({ attachments: admission, llm: llmService(['image']) }), exec(imageAgent), [imageBlock], TOOL)
    expect((admitted[0] as { text: string }).text).toContain('image admission rejected the result: Image upload is not canonical base64.')

    const fault = attachmentStore({
      saveImages: async () => {
        throw new AttachmentError('attachment write failed', 'ATTACHMENT_WRITE_FAILED')
      }
    })
    const refused = await prepareImageProjection(hostOf({ attachments: fault, llm: llmService(['image']) }), exec(imageAgent), [imageBlock], TOOL)
    expect((refused[0] as { text: string }).text).toContain('durable image storage rejected the result')
  })
})

describe('MCP image projection success', () => {
  it('saves the ordered batch and splits text runs at each image position', async () => {
    const saved: Array<{ data: Buffer; mediaType: string }> = []
    const store = {
      saveImages: async (images: ReadonlyArray<{ data: Buffer; mediaType: string }>) => {
        saved.push(...images)
        return ['ref-a', 'ref-b']
      }
    }
    const content: WireBlock[] = [
      { type: 'text', text: 'one' },
      { type: 'image', data: PNG_BASE64, mimeType: 'image/png' },
      { type: 'text', text: 'two' },
      { type: 'image', data: Buffer.from('gif89a').toString('base64'), mimeType: 'image/gif' }
    ]
    const blocks = await prepareImageProjection(hostOf({ attachments: store, llm: llmService(['image']) }), exec(imageAgent), content, TOOL)
    expect(blocks).toEqual([
      { type: 'text', text: 'one' },
      { type: 'image', attachment: 'ref-a' },
      { type: 'text', text: 'two' },
      { type: 'image', attachment: 'ref-b' }
    ])
    expect(saved.map(image => image.mediaType)).toEqual(['image/png', 'image/gif'])
  })

  it('prefers the session-routed model over agent options', async () => {
    const routes: Array<{ provider?: string; model?: string }> = []
    const llm = {
      resolveModelInfo: async (provider: string, model: string) => {
        routes.push({ provider, model })
        return { inputModalities: ['image'] }
      }
    }
    const agent = {
      session: { requestHeader: () => ({ config: { provider: 'routed-provider', model: 'routed-model' } }) },
      options: { provider: 'fallback-provider', model: 'fallback-model' }
    }
    await prepareImageProjection(hostOf({ attachments: attachmentStore(), llm }), exec(agent), [imageBlock], TOOL)
    expect(routes).toEqual([{ provider: 'routed-provider', model: 'routed-model' }])
  })
})
