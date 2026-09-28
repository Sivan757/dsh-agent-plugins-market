import { join } from 'node:path'
import { readJsonFile, writeJsonDocument } from '../json-file.js'

export function lspServerStatePath(dataRoot: string): string {
  return join(dataRoot, 'lsp-server-state.json')
}
export async function loadDisabledLspServers(dataRoot: string): Promise<Set<string>> {
  try {
    const value = (await readJsonFile(lspServerStatePath(dataRoot))) as { disabled?: unknown } | undefined
    return new Set(Array.isArray(value?.disabled) ? value.disabled.filter((id): id is string => typeof id === 'string') : [])
  } catch {
    return new Set()
  }
}
export async function saveDisabledLspServers(dataRoot: string, disabled: Iterable<string>): Promise<void> {
  await writeJsonDocument(lspServerStatePath(dataRoot), { disabled: [...new Set(disabled)].sort() })
}
