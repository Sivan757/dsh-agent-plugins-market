import { describe, expect, it } from 'vitest'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply } from '../src/index.js'

interface RegisteredTool {
  name: string
}

describe('dsh-agent-plugins-market host entry', () => {
  it('does not register a redundant agent_plugins model tool', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-agent-plugins-apply-'))
    const registrations: RegisteredTool[] = []
    const tools = {
      register: (definition: RegisteredTool) => {
        registrations.push(definition)
        return () => {}
      }
    }
    const context = {
      inject: (services: string[], callback: (value: unknown) => void) => {
        if (services.includes('tools')) callback({ tools })
        if (services.includes('webServer')) callback({ effect: () => {} })
      },
      skills: {
        registerProvider: (create: (control: { signal: AbortSignal; invalidate: () => void }) => unknown) => {
          create({ signal: new AbortController().signal, invalidate: () => {} })
          return () => {}
        }
      },
      effect: () => {},
      logger: { warn: () => {} }
    }

    apply(context as never, { userRoot: root, dataRoot: join(root, 'data') })

    expect(registrations.map(tool => tool.name)).not.toContain('agent_plugins')
  })
})
