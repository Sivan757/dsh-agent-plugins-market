/** Suite detail and preview projections owned by the application layer. */
import { readFile, stat } from 'node:fs/promises'
import { parse as parseYaml } from 'yaml'
import { discoverLspEntries } from '../catalog/surfaces.js'
import { defaultMarkdownResources, resourceText } from '../catalog/component-files.js'
import { credentialRefsInServer } from './mcp/mcp-config.js'
import { redactMcpConfig, redactMcpOverrides } from './mcp/mcp-redaction.js'
import { applyOverride } from './mcp/mcp-overrides.js'
import type { LspSurfaceDetail, McpServerDetail, SuiteDetail, SuiteDocumentMeta, UserPanelKind } from '../contracts/market.js'
import { effectiveSurfaces, type InstalledEntry, type ProjectHooks, type Suite, type SuiteMarkdownResource } from '../model/types.js'
import type { McpMountDiagnostic as McpDiagnostic } from '../contracts/mcp.js'

/** The checkout's last modification, or null when the path cannot be read. */
async function rootModifiedAt(root: string): Promise<string | null> {
  try {
    const stats = await stat(root)
    return new Date(stats.mtimeMs).toISOString()
  } catch {
    return null
  }
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
    updatedAt: await rootModifiedAt(suite.root),
    layout: suite.manifest.layout,
    dimension: suite.dimension,
    root: remoteUrl ?? suite.root,
    remoteUrl: remoteUrl ?? null,
    installed: installed !== undefined,
    enabled: installed?.enabled === true,
    surfaceToggles: effectiveSurfaces(installed?.surfaces),
    mcpOverrides: redactMcpOverrides(mcpOverrides),
    skills: suite.skills.map(skill => ({
      name: skill.name,
      description: skill.description,
      ...(skill.whenToUse === undefined ? {} : { whenToUse: skill.whenToUse }),
      path: skill.file
    })),
    mcpServers:
      suite.mcp === undefined
        ? []
        : Object.entries(suite.mcp.servers).map(([key, server]) => {
            const effective = applyOverride(server, mcpOverrides[key])
            return {
              key,
              ...(redactMcpConfig(server) as Omit<McpServerDetail, 'key' | 'credentialRefs'>),
              credentialRefs: credentialRefsInServer(effective)
            }
          }),
    hooks:
      remoteUrl === undefined
        ? suite.hooks === undefined
          ? suite.resources === undefined
            ? await hooksPreviews(suite.root)
            : { count: 0, entries: [] }
          : normalizedHookPreviews(suite.hooks)
        : { count: 0, entries: [] },
    commands: remoteUrl === undefined ? await documentMetas(suite.resources?.commands ?? (await defaultMarkdownResources(suite.root, 'commands'))) : [],
    agents: remoteUrl === undefined ? await documentMetas(suite.resources?.agents ?? (await defaultMarkdownResources(suite.root, 'agents'))) : [],
    lsp: remoteUrl === undefined ? await lspDetail(suite) : { servers: [], raw: [] },
    errors: suite.errors,
    mcpErrors: diagnostics.filter(diagnostic => diagnostic.suiteId === suite.id).map(diagnostic => `${diagnostic.serverKey}: ${diagnostic.reason}`)
  }
}

/**
 * Read one skill's authored text from a normalized suite.
 *
 * A skill's file is resolved by the scan; commands and agents resolve theirs
 * through the suite's own resource list ({@link readSuiteDocument}). A skill a
 * suite does not carry is a miss, not a lookup.
 */
async function readSkillText(suite: Suite, skillName: string): Promise<string> {
  const skill = suite.skills.find(entry => entry.name === skillName)
  if (skill === undefined) throw new Error(`skill "${skillName}" not found in suite "${suite.id}"`)
  try {
    return await readFile(skill.file, 'utf8')
  } catch (error) {
    throw new Error(`skill file unreadable: ${error instanceof Error ? error.message : String(error)}`, { cause: error })
  }
}

/**
 * Read one of a suite's document surfaces — a skill, a command, or an agent —
 * by the identity the market detail page addresses it with.
 *
 * This is the only body the market ever serves. The detail payload carries a
 * document's name and description so its row can render, and the text arrives
 * here when a reader opens that row, whole and uncut.
 *
 * The suite's own scanned resource list is the only source of a path: the
 * caller names a document, never a path, and a name the scan did not produce is
 * a miss rather than a lookup. Commands and agents read the same resource the
 * scan that built the detail payload found, so a document read here is the
 * document that payload named — re-read rather than taken from the request.
 * @param suite - the normalized suite the document belongs to.
 * @param kind - which of the three document surfaces the name belongs to.
 * @param name - the document's name inside that surface.
 * @returns the document's text exactly as authored.
 */
export async function readSuiteDocument(suite: Suite, kind: UserPanelKind, name: string): Promise<string> {
  if (kind === 'skills') return readSkillText(suite, name)
  const resources = suite.resources?.[kind] ?? (await defaultMarkdownResources(suite.root, kind))
  const resource = resources.find(entry => entry.name === name)
  if (resource === undefined) throw new Error(`no ${kind} document named "${name}" in suite "${suite.id}"`)
  return resourceText(resource)
}

/**
 * A capped preview of a file whose bytes still travel inside the detail
 * payload — the directory-style LSP definition files, and nothing else. The
 * cap is written into the text it produces, so a reader who gets one never
 * mistakes a cut document for a whole one.
 */
async function readPreview(path: string, capBytes = 64 * 1024): Promise<string> {
  const text = await readFile(path, 'utf8')
  return text.length > capBytes ? `${text.slice(0, capBytes)}\n… (truncated)` : text
}

/**
 * One document's identity as the suite detail payload carries it: the name its
 * row shows and the description its frontmatter declares. The body is not part
 * of the payload — it is read on demand, by the document route, when a reader
 * opens the row.
 */
async function documentMetas(resources: SuiteMarkdownResource[]): Promise<SuiteDocumentMeta[]> {
  const metas: SuiteDocumentMeta[] = []
  for (const resource of resources) {
    try {
      const description = frontmatterDescription(await resourceText(resource))
      metas.push({ name: resource.name, ...(description === undefined ? {} : { description }) })
    } catch {
      // Unreadable document files are omitted from the detail response.
    }
  }
  return metas
}

/** The `description` a document's YAML frontmatter declares, when it declares one. */
function frontmatterDescription(text: string): string | undefined {
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1]
  if (frontmatter === undefined) return undefined
  const yaml: unknown = parseYaml(frontmatter)
  if (typeof yaml !== 'object' || yaml === null) return undefined
  const description = (yaml as Record<string, unknown>)['description']
  return typeof description === 'string' ? description : undefined
}

function normalizedHookPreviews(hooks: ProjectHooks) {
  const entries = Object.entries(hooks.events).flatMap(([event, groups]) =>
    groups.flatMap(group => group.hooks.map(hook => ({ event, ...(group.matcher === undefined ? {} : { matcher: group.matcher }), command: hook.command })))
  )
  return { count: entries.length, entries }
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

/**
 * The suite's LSP surface: inline-declared `lspServers` (already parsed into
 * `suite.lsp` at discovery) rendered as structured server previews, plus the
 * directory-style `.claude-plugin/lsp/*.json` / reverse-domain files as raw
 * previews. Remote suites (not cloned) carry an empty detail.
 */
async function lspDetail(suite: Suite): Promise<LspSurfaceDetail> {
  const servers = Object.values(suite.lsp?.servers ?? {}).map(spec => ({
    key: spec.key,
    command: spec.command,
    args: spec.args,
    extensions: spec.extensionToLanguage,
    ...(spec.env === undefined ? {} : { env: spec.env })
  }))
  const raw: Array<{ name: string; content: string }> = []
  if (suite.remote?.url === undefined) {
    for (const entry of await discoverLspEntries(suite.root)) {
      try {
        raw.push({ name: entry.name, content: await readPreview(entry.path) })
      } catch {
        // Unreadable LSP files are omitted from the detail response.
      }
    }
  }
  return { servers, raw }
}
