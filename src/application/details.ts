/** Suite detail and preview projections owned by the application layer. */
import { readFile } from 'node:fs/promises'
import { parse as parseYaml } from 'yaml'
import { discoverLspEntries, listMdFiles } from '../catalog/surfaces.js'
import type { SkillContent, SuiteDetail } from '../contracts/market.js'
import { effectiveSurfaces, type InstalledEntry, type Suite } from '../model/types.js'

interface McpDiagnostic {
  suiteId: string
  serverKey: string
  reason: string
}

/** Build the detail response for one normalized suite. */
export async function buildSuiteDetail(
  suite: Suite,
  installed: InstalledEntry | undefined,
  diagnostics: readonly McpDiagnostic[],
  mcpOverrides: Record<string, Record<string, unknown>> = {}
): Promise<SuiteDetail> {
  const remoteUrl = suite.remote?.url
  return {
    sourceId: suite.sourceId,
    suiteId: suite.id,
    name: suite.manifest.name,
    version: suite.manifest.version ?? null,
    description: suite.manifest.description ?? null,
    author: suite.manifest.author ?? null,
    keywords: suite.manifest.keywords ?? [],
    layout: suite.manifest.layout,
    dimension: suite.dimension,
    root: remoteUrl ?? suite.root,
    remoteUrl: remoteUrl ?? null,
    installed: installed !== undefined,
    enabled: installed?.enabled === true,
    surfaceToggles: effectiveSurfaces(installed?.surfaces),
    mcpOverrides,
    skills: suite.skills.map(skill => ({
      name: skill.name,
      description: skill.description,
      ...(skill.whenToUse === undefined ? {} : { whenToUse: skill.whenToUse }),
      path: skill.file
    })),
    mcpServers: suite.mcp === undefined ? [] : Object.entries(suite.mcp.servers).map(([key, server]) => ({ key, ...server })),
    hooks: remoteUrl === undefined ? await hooksPreviews(suite.root) : { count: 0, entries: [] },
    commands: remoteUrl === undefined ? await markdownPreviews(`${suite.root}/commands`) : [],
    agents: remoteUrl === undefined ? await markdownPreviews(`${suite.root}/agents`) : [],
    lsp: remoteUrl === undefined ? await lspPreviews(suite.root) : [],
    errors: suite.errors,
    mcpErrors: diagnostics.filter(diagnostic => diagnostic.suiteId === suite.id).map(diagnostic => `${diagnostic.serverKey}: ${diagnostic.reason}`)
  }
}

/** Read one skill body from a normalized suite. */
export async function readSkillContent(suite: Suite, skillName: string): Promise<SkillContent> {
  const skill = suite.skills.find(entry => entry.name === skillName)
  if (skill === undefined) throw new Error(`skill "${skillName}" not found in suite "${suite.id}"`)
  let content: string
  try {
    content = await readFile(skill.file, 'utf8')
  } catch (error) {
    throw new Error(`skill file unreadable: ${error instanceof Error ? error.message : String(error)}`)
  }
  return { name: skill.name, description: skill.description, content, path: skill.file }
}

async function readPreview(path: string, capBytes = 64 * 1024): Promise<string> {
  const text = await readFile(path, 'utf8')
  return text.length > capBytes ? `${text.slice(0, capBytes)}\n… (truncated)` : text
}

async function markdownPreviews(dir: string): Promise<Array<{ name: string; description?: string; content: string }>> {
  const names = await listMdFiles(dir)
  const previews: Array<{ name: string; description?: string; content: string }> = []
  for (const name of names) {
    const file = `${dir}/${name}`
    try {
      const content = await readPreview(file)
      const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content)
      let description: string | undefined
      if (match !== null) {
        const yaml = parseYaml(match[1])
        if (typeof yaml === 'object' && yaml !== null) {
          const desc = (yaml as Record<string, unknown>)['description']
          if (typeof desc === 'string') description = desc
        }
      }
      previews.push({ name: name.slice(0, -3), ...(description === undefined ? {} : { description }), content })
    } catch {
      // Unreadable preview files are omitted from the detail response.
    }
  }
  return previews
}

async function hooksPreviews(root: string): Promise<{ count: number; entries: Array<{ event: string; matcher?: string; command: string }> }> {
  for (const relative of ['hooks/hooks.json', 'hooks.json'] as const) {
    let text: string
    try {
      text = await readFile(`${root}/${relative}`, 'utf8')
    } catch {
      continue
    }
    try {
      const parsed: unknown = JSON.parse(text)
      if (typeof parsed !== 'object' || parsed === null) continue
      const hooks = (parsed as Record<string, unknown>)['hooks']
      if (typeof hooks !== 'object' || hooks === null) continue
      const entries: Array<{ event: string; matcher?: string; command: string }> = []
      for (const [event, groups] of Object.entries(hooks as Record<string, unknown>)) {
        if (!Array.isArray(groups)) continue
        for (const group of groups) {
          if (typeof group !== 'object' || group === null) continue
          const record = group as Record<string, unknown>
          const matcher = typeof record['matcher'] === 'string' ? record['matcher'] : undefined
          const hooksList = record['hooks']
          if (!Array.isArray(hooksList)) continue
          for (const hook of hooksList) {
            if (typeof hook !== 'object' || hook === null) continue
            const hookRecord = hook as Record<string, unknown>
            if (typeof hookRecord['command'] === 'string') entries.push({ event, ...(matcher === undefined ? {} : { matcher }), command: hookRecord['command'] })
          }
        }
      }
      return { count: entries.length, entries }
    } catch {
      // Unparsable hook files yield zero entries.
    }
  }
  return { count: 0, entries: [] }
}

async function lspPreviews(root: string): Promise<Array<{ name: string; content: string }>> {
  const previews: Array<{ name: string; content: string }> = []
  for (const entry of await discoverLspEntries(root)) {
    try {
      previews.push({ name: entry.name, content: await readPreview(entry.path) })
    } catch {
      // Unreadable LSP files are omitted from the detail response.
    }
  }
  return previews
}
