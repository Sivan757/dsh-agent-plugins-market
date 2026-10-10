/**
 * The credential record one MCP server's OAuth grant lives under.
 *
 * `runtime/mcp-client/oauth.ts` writes those records; this module addresses
 * the same key so a grant can be dropped without waking the transport that
 * wrote it. The scope and the name fold must stay identical to that writer's,
 * or the delete silently misses the record.
 *
 * @module runtime/mcp-auth-record
 */
import { credentialKey, type CredentialKey } from './bridge/host-seams.js'

/** Credential-record scope for MCP OAuth state; per-server ids follow it. */
export const MCP_AUTH_RECORD_SCOPE = 'mcp-auth'

/** The credentials seam surface a grant is dropped through. */
interface GrantRecordStore {
  deleteRecord?(key: CredentialKey): Promise<void>
}

/**
 * Fold a `serverName` into a credential-key id segment. Server names carry
 * `__` separators (e.g. `cloudflare__cloudflare-api`), and the key grammar
 * admits only `[a-z0-9-]`, so non-conforming characters collapse to `-` —
 * deterministic, so the same server always reads and writes one record.
 *
 * One pass over the characters: a name arrives from a third-party suite, and
 * the previous `[^a-z0-9-]+` replace with an anchored trim cost time quadratic
 * in the length of a separator-only name.
 */
export function mcpAuthRecordId(serverName: string): string {
  const folded = foldSegment(serverName.toLowerCase(), character => (character >= 'a' && character <= 'z') || (character >= '0' && character <= '9') || character === '-')
  return folded === '' ? 'server' : folded
}

/**
 * Fold a name into `[a-z0-9-]`: a character the predicate accepts survives as
 * written, a run of characters it rejects becomes one `-`, and the `-` that
 * leads or trails the result is dropped.
 *
 * One pass over the characters. The pattern pair this replaces re-scanned the
 * rejected runs, so a name of nothing but separators cost time quadratic in
 * its length, and the name arrives from a third-party suite.
 */
function foldSegment(value: string, keep: (character: string) => boolean): string {
  const parts: string[] = []
  let rejected = false
  for (const character of value) {
    if (keep(character)) {
      if (rejected && parts.length > 0) parts.push('-')
      rejected = false
      parts.push(character)
    } else {
      rejected = true
    }
  }
  let folded = parts.join('')
  while (folded.startsWith('-')) folded = folded.slice(1)
  while (folded.endsWith('-')) folded = folded.slice(0, -1)
  return folded
}

/** The credential record key one MCP server's OAuth grant is stored under. */
export function mcpAuthRecordKey(serverName: string): CredentialKey {
  return credentialKey(MCP_AUTH_RECORD_SCOPE, mcpAuthRecordId(serverName))
}

/**
 * Drop one MCP server's OAuth grant record so the next mount re-runs the
 * browser authorization — the path for "I picked too narrow a scope".
 * @param store - the host credentials service, when one is mounted.
 * @throws when the credentials service is not mounted.
 */
export async function deleteMcpAuthGrant(store: unknown, serverName: string): Promise<void> {
  const records = store as GrantRecordStore | undefined
  if (typeof records?.deleteRecord !== 'function') throw new Error('credentials service is not mounted')
  await records.deleteRecord(mcpAuthRecordKey(serverName))
}
