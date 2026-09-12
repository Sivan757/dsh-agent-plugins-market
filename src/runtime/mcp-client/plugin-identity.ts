/**
 * This plugin's own identity as advertised to the servers it talks to: the MCP
 * client implementation name and version, and the RFC 7591 `software_id` /
 * `software_version` carried in OAuth dynamic-registration metadata.
 *
 * The version is read from the installed manifest through Node's package
 * self-reference, so a release bumps exactly one number — `package.json`. A
 * copy that can no longer resolve its own manifest (a bundle that inlined this
 * module) reports {@link UNKNOWN_VERSION} rather than failing the connection.
 *
 * @module runtime/mcp-client/plugin-identity
 */

import { createRequire } from 'node:module'

/** Name npm and the harness know this plugin by. */
export const PLUGIN_NAME = 'dsh-agent-plugins-market'

/** Reported when the plugin cannot read its own manifest; never a released version. */
const UNKNOWN_VERSION = '0.0.0'

function readVersion(): string {
  try {
    const manifest = createRequire(import.meta.url)('dsh-agent-plugins-market/package.json') as { version?: unknown }
    return typeof manifest.version === 'string' && manifest.version !== '' ? manifest.version : UNKNOWN_VERSION
  } catch {
    return UNKNOWN_VERSION
  }
}

/** This plugin's release version. */
export const PLUGIN_VERSION: string = readVersion()
