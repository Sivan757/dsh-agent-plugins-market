/**
 * MCP result projection: turn the content blocks an MCP server returns into
 * the host content vocabulary the model sees.
 *
 * Text-like blocks collapse into newline-joined text runs; declared images are
 * decoded, admitted against the live model route, and saved to the durable
 * attachment store. Every refusal — an unsupported media type, a model that
 * does not declare image input, a storage fault — projects the block as text
 * explaining why, and the canonical raw value stays available to programmatic
 * callers in the tool result.
 *
 * Everything here reads an untrusted network payload: the MCP server is an
 * external process and the SDK's declared-required fields may be absent at
 * runtime, so each block is narrowed field by field.
 *
 * @module runtime/mcp-client/projection
 */

import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { JsonValue, McpResult, ToolExecution, ToolHost } from './host-contract.js'
import { isImageAdmissionError, type AttachmentStoreLike, type ImageMediaType, type SaveImageAttachment } from './host-seams.js'

/** Raster formats supported by the durable attachment vocabulary. */
const IMAGE_MEDIA_TYPES: readonly ImageMediaType[] = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']

/** Canonical RFC 4648 base64, excluding whitespace and URL-safe aliases. */
const CANONICAL_BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/

/**
 * The shape we read from each MCP content block. Intentionally looser than the
 * SDK's `ContentBlock` type: we're at a network trust boundary (data arrives
 * from an external MCP server process via JSON-RPC), so fields that the SDK
 * declares required may be absent at runtime if the server is buggy.
 */
interface McpContentBlock {
  type: string
  text?: string
  mimeType?: string
  data?: string
  name?: string
  uri?: string
}

/** Async rich projection staged for one exact execution. */
export interface PreparedProjection {
  /** Canonical MCP value returned by execute before registry materialization. */
  value: McpResult
  /** Synchronous output.render projection expected before finalization. */
  fallback: ContentBlock[]
  /** Image-enriched or explicit-refusal projection prepared during execute. */
  content: ContentBlock[]
}

/** Whether an untrusted MCP content array contains a declared image block. */
export function containsImage(content: JsonValue[]): boolean {
  return content.some(value => isRecord(value) && value.type === 'image')
}

/** Narrow one JSON value to a string-keyed object. */
function isRecord(value: JsonValue): value is { [key: string]: JsonValue } {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Narrow a declared MIME string to the durable image vocabulary. */
function isImageMediaType(value: string): value is ImageMediaType {
  return IMAGE_MEDIA_TYPES.includes(value as ImageMediaType)
}

/** Decode one untrusted MCP image block without accepting base64 aliases. */
function decodeImage(block: McpContentBlock): SaveImageAttachment {
  if (block.mimeType === undefined || !isImageMediaType(block.mimeType)) {
    throw new Error('the declared media type is not PNG, JPEG, WebP, or GIF')
  }
  if (block.data === undefined || !CANONICAL_BASE64.test(block.data)) {
    throw new Error('the image data is not canonical base64')
  }
  const data = Buffer.from(block.data, 'base64')
  if (data.toString('base64') !== block.data) {
    throw new Error('the image data is not canonical base64')
  }
  return { data, mediaType: block.mimeType }
}

/** The optional model service image admission consults (structural mirror). */
interface LlmServiceLike {
  resolveModelInfo(provider: string, model: string, signal: AbortSignal): Promise<{ inputModalities?: string[] } | undefined>
}

/**
 * Resolve the active model route and durable store for an image-bearing result.
 * @param host - bridge host with optional services.
 * @param exec - exact tool execution whose agent supplies the latest route.
 * @returns the attachment store after exact positive image-capability proof.
 */
async function resolveImageAdmission(host: ToolHost, exec: ToolExecution): Promise<AttachmentStoreLike> {
  const attachments = host.getService?.('attachments') as AttachmentStoreLike | undefined
  if (attachments === undefined || typeof attachments.saveImages !== 'function') {
    throw new Error('no attachment store is mounted')
  }
  const routed = exec.agent?.session?.requestHeader?.()?.config
  const provider = routed?.provider ?? exec.agent?.options?.provider
  const model = routed?.model ?? exec.agent?.options?.model
  const llm = host.getService?.('llm') as LlmServiceLike | undefined
  if (provider === undefined || model === undefined || llm === undefined) {
    throw new Error('the current model route could not be resolved')
  }
  let info: Awaited<ReturnType<LlmServiceLike['resolveModelInfo']>>
  try {
    info = await llm.resolveModelInfo(provider, model, exec.signal)
  } catch {
    throw new Error('the current model route could not be verified')
  }
  if (info?.inputModalities === undefined || !info.inputModalities.includes('image')) {
    throw new Error(`model "${model}" does not declare image input`)
  }
  if (exec.signal.aborted) throw new Error('the tool call was canceled before image storage')
  return attachments
}

/** Stable diagnostic text for an image block that was not admitted. */
function imageDiagnostic(block: McpContentBlock, reason: string): string {
  return `[image unavailable: ${block.mimeType ?? 'unknown media type'}; ${reason}; raw image data remains available to programmatic callers]`
}

/**
 * Decode, preflight, and durably save one MCP result's ordered image batch.
 * Any refusal projects every image as text while retaining the canonical raw
 * value for programmatic callers.
 */
export async function prepareImageProjection(host: ToolHost, exec: ToolExecution, content: JsonValue[], toolName: string): Promise<ContentBlock[]> {
  const decoded: SaveImageAttachment[] = []
  const validationErrors = new Map<number, string>()
  const imageIndexes: number[] = []
  for (const [index, value] of content.entries()) {
    if (!isRecord(value) || value.type !== 'image') continue
    imageIndexes.push(index)
    try {
      decoded.push(decodeImage(value as unknown as McpContentBlock))
    } catch (error: unknown) {
      // decodeImage owns every throw above and always produces Error.
      validationErrors.set(index, (error as Error).message)
    }
  }
  if (validationErrors.size > 0) {
    return projectContent(content, toolName, (block, index) => ({
      type: 'text',
      text: imageDiagnostic(block, validationErrors.get(index) ?? 'another image in the same result was invalid')
    }))
  }

  let attachments: AttachmentStoreLike
  try {
    attachments = await resolveImageAdmission(host, exec)
  } catch (error: unknown) {
    // resolveImageAdmission contains provider failures and throws Error only.
    const reason = (error as Error).message
    return projectContent(content, toolName, block => ({ type: 'text', text: imageDiagnostic(block, reason) }))
  }

  try {
    const refs = await attachments.saveImages(decoded)
    const byIndex = new Map(imageIndexes.map((index, offset) => [index, refs[offset]] as const))
    return projectContent(
      content,
      toolName,
      (_block, index) =>
        ({
          type: 'image',
          attachment: byIndex.get(index)
        }) as ContentBlock
    )
  } catch (error: unknown) {
    const reason = isImageAdmissionError(error) ? `image admission rejected the result: ${(error as Error).message}` : 'durable image storage rejected the result'
    return projectContent(content, toolName, block => ({
      type: 'text',
      text: imageDiagnostic(block, reason)
    }))
  }
}

/**
 * Extract text from an MCP content array into a single string.
 * - text blocks: join with '\n'
 * - image/audio/resource blocks: replaced with a placeholder
 *
 * Defensive: fields that the MCP spec declares required (mimeType, text) are
 * guarded with fallbacks because this is a network trust boundary.
 */
export function extractText(mcpContent: JsonValue[], toolName: string): string {
  const content = projectContent(mcpContent, toolName)
  // The default image projector below also returns text, so this local call
  // cannot produce a core image block.
  return content.map(block => (block as Extract<ContentBlock, { type: 'text' }>).text).join('\n')
}

/**
 * Project ordered MCP blocks into the core content vocabulary.
 * Text-like runs are newline-coalesced; admitted images split those runs at
 * their original position.
 */
function projectContent(
  mcpContent: JsonValue[],
  toolName: string,
  image: (block: McpContentBlock, index: number) => ContentBlock = block => ({
    type: 'text',
    text: imageDiagnostic(block, 'this result was not admitted to durable model context')
  })
): ContentBlock[] {
  const projected: ContentBlock[] = []
  const text: string[] = []
  const flushText = (): void => {
    if (text.length === 0) return
    projected.push({ type: 'text', text: text.splice(0).join('\n') })
  }

  for (const [index, value] of mcpContent.entries()) {
    if (!isRecord(value)) {
      text.push('[unsupported MCP content block: expected an object]')
      continue
    }
    const block = value as unknown as McpContentBlock
    switch (block.type) {
      case 'text':
        if (block.text !== undefined) text.push(block.text)
        break
      case 'image':
        flushText()
        projected.push(image(block, index))
        break
      case 'resource_link':
        if (block.name === undefined || block.uri === undefined) {
          text.push('[resource link unavailable: the MCP block is missing its name or URI]')
        } else {
          text.push(`Resource link: ${block.name} (${block.uri})`)
        }
        break
      case 'audio':
        text.push(`[audio result unsupported: ${block.mimeType ?? 'unknown media type'}; raw audio data remains available to programmatic callers]`)
        break
      case 'resource':
        text.push('[embedded resource unsupported; raw resource data remains available to programmatic callers]')
        break
      default:
        text.push(`[unsupported MCP content type: ${block.type}]`)
    }
  }
  flushText()
  return projected.length > 0 ? projected : [{ type: 'text', text: `(${toolName} returned no model-visible content)` }]
}
