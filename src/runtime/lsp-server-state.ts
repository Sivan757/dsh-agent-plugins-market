import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'

export function lspServerStatePath(dataRoot: string): string {
  return join(dataRoot, 'lsp-server-state.json')
}
export async function loadDisabledLspServers(dataRoot: string): Promise<Set<string>> {
  try {
    const value = JSON.parse(await readFile(lspServerStatePath(dataRoot), 'utf8')) as { disabled?: unknown }
    return new Set(Array.isArray(value.disabled) ? value.disabled.filter((id): id is string => typeof id === 'string') : [])
  } catch {
    return new Set()
  }
}
export async function saveDisabledLspServers(dataRoot: string, disabled: Iterable<string>): Promise<void> {
  const path = lspServerStatePath(dataRoot)
  await writeFileAtomic(path, `${JSON.stringify({ disabled: [...new Set(disabled)].sort() }, null, 2)}\n`, { mode: 0o600, dirMode: 0o700 })
}
