/**
 * The host seams the self-built MCP client consumes, re-exported from the
 * packages that own them.
 *
 * These are small pure functions and constants, but each one encodes a rule
 * this plugin must obey rather than a choice it gets to make: which credential
 * keys the host accepts, how long a timer may be, which environment names never
 * reach a child process, and which image failures a caller can correct. Reading
 * them from the host keeps one owner per rule, so a host change reaches this
 * plugin instead of leaving a copy behind.
 *
 * The OAuth provider and attachment admission reach their services through the
 * optional `credentials` / `attachments` seams at runtime, so the service types
 * here stay structural — only the rules are imported.
 *
 * @module runtime/mcp-client/host-seams
 */
import type { CredentialKey } from '@deepseek-ai/dsh-credentials'
import type { SaveImageAttachment } from '@deepseek-ai/dsh-attachment'

// ---- dsh-timeout: timer bounds ----

export { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'

// ---- dsh-subprocess: the canonical child environment ----

export { scrubbedParentEnv } from '@deepseek-ai/dsh-subprocess'

// ---- dsh-credentials: key grammar ----

export { credentialKey, type CredentialKey } from '@deepseek-ai/dsh-credentials'

/**
 * Structural mirror of the host `CredentialProvider` record surface the OAuth
 * provider needs. Typed structurally because the store arrives via the
 * optional `credentials` service; the OAuth provider narrows at runtime and
 * falls back to memory-only state when the service is absent.
 */
export interface CredentialRecordStore {
  describeRecord(key: CredentialKey): Promise<{ configured: boolean; writable: boolean }>
  readRecord(key: CredentialKey): Promise<unknown>
  modifyRecord(key: CredentialKey, mutate: (current: unknown) => Promise<unknown>): Promise<unknown>
}

// ---- dsh-attachment: durable image vocabulary ----

export { isImageAdmissionError, type ImageMediaType, type SaveImageAttachment } from '@deepseek-ai/dsh-attachment'

/**
 * Structural mirror of the host attachment store surface this plugin writes
 * through. The service is resolved off the tool host at call time, so its
 * concrete class is deliberately not imported.
 */
export interface AttachmentStoreLike {
  saveImages(images: readonly SaveImageAttachment[]): Promise<readonly unknown[]>
}
