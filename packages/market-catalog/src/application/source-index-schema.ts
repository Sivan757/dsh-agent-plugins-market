/** The private, versioned discovery document; cached declarations pass the same typed boundary after restart. */
import { z } from 'zod'
import { PLUGIN_LAYOUTS } from '../../../market-contracts/src/model/layouts.js'
import type { DiscoveredSuite } from '../../../market-contracts/src/model/types.js'

const strings = z.array(z.string())
const stringTable = z.record(z.string(), z.string())
const policy = {
  enabledTools: strings.optional(),
  disabledTools: strings.optional(),
  startupTimeoutMs: z.number().optional(),
  toolCallTimeoutMs: z.number().optional()
}
const auth = z.strictObject({ enabled: z.boolean(), scope: z.string().optional() }).optional()
// Native MCP metadata (such as OAuth client hints) passes through the existing discovery parser.
// Preserve those fields while validating the transport and policy fields that this plugin consumes.
const mcpServer = z.discriminatedUnion('type', [
  z.looseObject({ type: z.literal('stdio'), command: z.string(), args: strings.optional(), env: stringTable.optional(), cwd: z.string().optional(), ...policy }),
  z.looseObject({ type: z.literal('streamable-http'), url: z.string(), headers: stringTable.optional(), auth, ...policy }),
  z.looseObject({ type: z.literal('sse'), url: z.string(), headers: stringTable.optional(), auth, ...policy })
])
const markdown = z.strictObject({ name: z.string(), file: z.string(), content: z.string().optional() })
const surfaceCounts = {
  skills: z.number().int().nonnegative(),
  mcp: z.number().int().nonnegative(),
  hooks: z.number().int().nonnegative(),
  commands: z.number().int().nonnegative(),
  agents: z.number().int().nonnegative(),
  lsp: z.number().int().nonnegative()
}
const surfaceFlags = { skills: z.boolean(), mcp: z.boolean(), hooks: z.boolean(), commands: z.boolean(), agents: z.boolean(), lsp: z.boolean() }

/** Bump the document version when discovery semantics or the normalized shape changes. */
export const SOURCE_INDEX_VERSION = 1

const discoveredSuite: z.ZodType<DiscoveredSuite> = z.strictObject({
  sourceId: z.string(),
  id: z.string(),
  root: z.string(),
  manifest: z.strictObject({
    layout: z.enum([...PLUGIN_LAYOUTS.map(layout => layout.kind), 'skill-collection', 'remote', 'project-native']),
    path: z.string(),
    id: z.string(),
    name: z.string(),
    version: z.string().optional(),
    description: z.string().optional(),
    author: z.string().optional(),
    keywords: strings.optional(),
    schemaVersion: z.string().optional(),
    skillInstructions: z.string().optional(),
    startupSkill: z.string().optional(),
    systemPrompt: z.string().optional(),
    systemPromptPath: z.string().optional(),
    components: z
      .strictObject({
        skills: z.unknown().optional(),
        commands: z.unknown().optional(),
        agents: z.unknown().optional(),
        hooks: z.unknown().optional(),
        mcpServers: z.unknown().optional(),
        lspServers: z.unknown().optional(),
        outputStyles: z.unknown().optional()
      })
      .optional(),
    harness: z.strictObject({ schemaVersion: z.string(), mcpServers: z.record(z.string(), z.strictObject({ ...policy, auth })) }).optional()
  }),
  skills: z.array(
    z.strictObject({
      name: z.string(),
      directory: z.string(),
      file: z.string(),
      description: z.string(),
      whenToUse: z.string().optional(),
      invocation: z.strictObject({ modelInvocable: z.boolean(), userInvocable: z.boolean() })
    })
  ),
  resources: z.strictObject({ commands: z.array(markdown), agents: z.array(markdown) }).optional(),
  systemPrompt: z.string().optional(),
  hooks: z
    .strictObject({
      projectRoot: z.string().optional(),
      events: z.record(
        z.string(),
        z.array(
          z.strictObject({ matcher: z.string().optional(), hooks: z.array(z.strictObject({ type: z.literal('command'), command: z.string(), timeout: z.number().optional() })) })
        )
      )
    })
    .optional(),
  mcp: z.strictObject({ root: z.string().optional(), schema: z.string(), servers: z.record(z.string(), mcpServer) }).optional(),
  lsp: z
    .strictObject({
      servers: z.record(
        z.string(),
        z.strictObject({
          key: z.string(),
          command: z.string(),
          args: strings,
          extensionToLanguage: stringTable,
          env: stringTable.optional(),
          initializationOptions: z.unknown().optional(),
          configuration: z.unknown().optional()
        })
      )
    })
    .optional(),
  styles: z.array(z.strictObject({ name: z.string(), description: z.string(), keepCodingInstructions: z.boolean(), file: z.string(), body: z.string() })).optional(),
  surfaces: z.strictObject({ ...surfaceCounts, outputStyles: z.number().int().nonnegative().optional() }),
  dimension: z.enum(['user', 'project']),
  enabled: z.boolean(),
  activeSurfaces: z.strictObject(surfaceFlags).optional(),
  lockCommit: z.string().optional(),
  installedAt: z.string().optional(),
  remote: z.strictObject({ url: z.string() }).optional(),
  errors: strings
})

/** Mutable sources persist routing hints only; their declarations are reparsed before use. */
export const sourceBindingsSchema = z.strictObject({
  version: z.literal(SOURCE_INDEX_VERSION),
  identity: z.string(),
  routingSignature: z.string(),
  marketplacePath: z.string().optional(),
  roots: z.array(z.strictObject({ id: z.string(), root: z.string(), entryIndex: z.number().int().nonnegative().optional() }))
})

export type SourceBindingsDocument = z.infer<typeof sourceBindingsSchema>

export const sourceIndexSchema = z.strictObject({
  version: z.literal(SOURCE_INDEX_VERSION),
  identity: z.string(),
  revision: z.string().optional(),
  suites: z.array(discoveredSuite),
  notes: strings
})
