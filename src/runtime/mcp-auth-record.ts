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
import { credentialKey, type CredentialKey } from './mcp-client/host-seams.js'

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
 */
export function mcpAuthRecordId(serverName: string): string {
  const folded = serverName
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return folded === '' ? 'server' : folded
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
