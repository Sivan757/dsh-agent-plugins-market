/**
 * Tests for login-shell command resolution: the marker parse, every probe
 * failure mode, memoization, the append-only `PATH` merge, and the
 * "resolve first, extend only on failure" rule the MCP bridge and LSP mounts
 * both rely on.
 *
 * The login shell and the host's lookup seam are both faked: the point is the
 * plugin's own contract, not the machine's shell. The marker literal is
 * repeated here on purpose — it is the wire between the probe and the parse.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { delimiter } from 'node:path'
import { SubprocessExecutableNotFoundError } from '@deepseek-ai/dsh-subprocess'

const MARKER = '__DSH_MARKET_LOGIN_PATH__'

/**
 * The product splits and joins `PATH` with the host's own separator, so every
 * case that spells a multi-entry `PATH` builds it with `delimiter`. Written as
 * `:` it would be one entry on Windows and assert a different contract there.
 */
const joined = (...entries: string[]): string => entries.join(delimiter)

const { execFileMock } = vi.hoisted(() => ({ execFileMock: vi.fn() }))

vi.mock('node:child_process', () => ({ execFile: execFileMock }))

/** Hand the probe one completed `execFile` call. */
function shellResult(stdout: string | undefined, error: Error | null = null): void {
  execFileMock.mockImplementation((_file: string, _args: string[], _options: unknown, callback: (error: Error | null, stdout: string, stderr: string) => void) => {
    callback(error, stdout ?? '', '')
  })
}

/** Replace `process.platform` for the duration of one test. */
function withPlatform<T>(platform: NodeJS.Platform, run: () => Promise<T>): Promise<T> {
  const original = process.platform
  Object.defineProperty(process, 'platform', { value: platform, configurable: true })
  return run().finally(() => {
    Object.defineProperty(process, 'platform', { value: original, configurable: true })
  })
}

/** A fresh module graph, so the process-wide probe memo starts empty. */
async function load(): Promise<typeof import('../packages/market-runtime/src/runtime/host/shell-path.js')> {
  vi.resetModules()
  return import('../packages/market-runtime/src/runtime/host/shell-path.js')
}

/** A ctx exposing only the host lookup seam. */
function resolverCtx(resolveExecutable: (command: string, env: Record<string, string>) => Promise<string>): unknown {
  return { subprocess: { resolveExecutable } }
}

const notFound = (): SubprocessExecutableNotFoundError => new SubprocessExecutableNotFoundError('subprocess-local: command "npx" was not found on PATH')

beforeEach(() => {
  execFileMock.mockReset()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('loginShellPathEntries', () => {
  it('parses the marker line, drops relative and duplicate entries, keeps order', async () => {
    shellResult(`Welcome back\n${MARKER}\n${joined('/opt/homebrew/bin', '/usr/bin', '/opt/homebrew/bin', 'relative/bin', '/usr/bin')}\n`)
    const { loginShellPathEntries } = await load()
    await withPlatform('darwin', async () => {
      expect(await loginShellPathEntries()).toEqual(['/opt/homebrew/bin', '/usr/bin'])
    })
  })

  it('ignores banner text before the marker', async () => {
    shellResult(`some login banner\nanother line\n${MARKER}\n/custom/bin\n`)
    const { loginShellPathEntries } = await load()
    await withPlatform('darwin', async () => {
      expect(await loginShellPathEntries()).toEqual(['/custom/bin'])
    })
  })

  it('returns undefined when the shell cannot be spawned', async () => {
    shellResult(undefined, new Error('spawn /bin/zsh ENOENT'))
    const { loginShellPathEntries } = await load()
    await withPlatform('darwin', async () => {
      expect(await loginShellPathEntries()).toBeUndefined()
    })
  })

  it('returns undefined when the probe times out', async () => {
    shellResult(undefined, Object.assign(new Error('probe killed'), { killed: true, signal: 'SIGTERM' }))
    const { loginShellPathEntries } = await load()
    await withPlatform('darwin', async () => {
      expect(await loginShellPathEntries()).toBeUndefined()
    })
  })

  it('returns undefined when the marker is absent', async () => {
    shellResult('no marker in this output\n')
    const { loginShellPathEntries } = await load()
    await withPlatform('darwin', async () => {
      expect(await loginShellPathEntries()).toBeUndefined()
    })
  })

  it('returns undefined when the marker carries no value', async () => {
    shellResult(`${MARKER}\n\n`)
    const { loginShellPathEntries } = await load()
    await withPlatform('darwin', async () => {
      expect(await loginShellPathEntries()).toBeUndefined()
    })
  })

  it('returns undefined when every entry is relative', async () => {
    shellResult(`${MARKER}\n${joined('relative/bin', 'also/relative')}\n`)
    const { loginShellPathEntries } = await load()
    await withPlatform('darwin', async () => {
      expect(await loginShellPathEntries()).toBeUndefined()
    })
  })

  it('probes the login shell at most once per process', async () => {
    shellResult(`${MARKER}\n/opt/homebrew/bin\n`)
    const { loginShellPathEntries } = await load()
    await withPlatform('darwin', async () => {
      await loginShellPathEntries()
      await loginShellPathEntries()
      expect(execFileMock).toHaveBeenCalledTimes(1)
    })
  })

  it('is a no-op on non-darwin platforms', async () => {
    shellResult(`${MARKER}\n/opt/homebrew/bin\n`)
    await withPlatform('linux', async () => {
      const { loginShellPathEntries } = await load()
      expect(await loginShellPathEntries()).toBeUndefined()
    })
    expect(execFileMock).not.toHaveBeenCalled()
  })
})

describe('augmentChildPath', () => {
  it('appends only the missing directories, preserving the base order', async () => {
    shellResult(`${MARKER}\n${joined('/opt/homebrew/bin', '/usr/bin')}\n`)
    const { augmentChildPath } = await load()
    await withPlatform('darwin', async () => {
      expect(await augmentChildPath(joined('/usr/bin', '/bin'))).toEqual({ path: joined('/usr/bin', '/bin', '/opt/homebrew/bin'), added: ['/opt/homebrew/bin'] })
    })
  })

  it('returns undefined when the login shell adds nothing new', async () => {
    shellResult(`${MARKER}\n${joined('/usr/bin', '/bin')}\n`)
    const { augmentChildPath } = await load()
    await withPlatform('darwin', async () => {
      expect(await augmentChildPath(joined('/usr/bin', '/bin'))).toBeUndefined()
    })
  })

  it('returns undefined when the probe failed', async () => {
    shellResult(undefined, new Error('boom'))
    const { augmentChildPath } = await load()
    await withPlatform('darwin', async () => {
      expect(await augmentChildPath(joined('/usr/bin', '/bin'))).toBeUndefined()
    })
  })
})

describe('resolveDeclaredCommand', () => {
  it('leaves a command that the base environment already resolves untouched', async () => {
    const resolveExecutable = vi.fn(async () => '/usr/bin/tool')
    const { resolveDeclaredCommand } = await load()
    expect(await resolveDeclaredCommand(resolverCtx(resolveExecutable), 'tool', {})).toEqual({})
    expect(resolveExecutable).toHaveBeenCalledTimes(1)
    expect(execFileMock).not.toHaveBeenCalled()
  })

  it('extends PATH from the login shell only after the base lookup fails, and reports the added directories', async () => {
    shellResult(`${MARKER}\n/dsh-market-test/bin\n`)
    const resolveExecutable = vi.fn(async (_command: string, env: Record<string, string>) => {
      if (!(env.PATH ?? '').split(delimiter).includes('/dsh-market-test/bin')) throw notFound()
      return '/dsh-market-test/bin/npx'
    })
    const { resolveDeclaredCommand } = await load()
    const resolution = await withPlatform('darwin', async () => resolveDeclaredCommand(resolverCtx(resolveExecutable), 'npx', {}))
    expect(resolution?.path?.endsWith(`${delimiter}/dsh-market-test/bin`)).toBe(true)
    expect(resolution?.diagnostic).toBe('PATH extended from the login shell: /dsh-market-test/bin')
    expect(resolveExecutable).toHaveBeenCalledTimes(2)
  })

  it('reports the searched PATH when even the extended PATH cannot resolve the command', async () => {
    shellResult(`${MARKER}\n/dsh-market-test/bin\n`)
    const resolveExecutable = vi.fn(async () => {
      throw notFound()
    })
    const { resolveDeclaredCommand } = await load()
    const resolution = await withPlatform('darwin', async () => resolveDeclaredCommand(resolverCtx(resolveExecutable), 'npx', {}))
    expect(resolution?.path).toBeUndefined()
    expect(resolution?.diagnostic).toContain('searched:')
    expect(resolution?.diagnostic).toContain('/dsh-market-test/bin')
  })

  it('reports a failed probe without changing the environment', async () => {
    shellResult(undefined, new Error('no shell'))
    const resolveExecutable = vi.fn(async () => {
      throw notFound()
    })
    const { resolveDeclaredCommand } = await load()
    const resolution = await withPlatform('darwin', async () => resolveDeclaredCommand(resolverCtx(resolveExecutable), 'npx', {}))
    expect(resolution?.path).toBeUndefined()
    expect(resolution?.diagnostic).toContain('login shell could not supply')
  })

  it('never probes when the declaration carries its own PATH', async () => {
    const resolveExecutable = vi.fn(async () => '/custom/bin/tool')
    const { resolveDeclaredCommand } = await load()
    expect(await resolveDeclaredCommand(resolverCtx(resolveExecutable), 'tool', { PATH: '/custom/bin' })).toBeUndefined()
    expect(resolveExecutable).not.toHaveBeenCalled()
    expect(execFileMock).not.toHaveBeenCalled()
  })

  it('does nothing when the context carries no lookup seam', async () => {
    const { resolveDeclaredCommand } = await load()
    expect(await resolveDeclaredCommand({}, 'npx', {})).toBeUndefined()
    expect(execFileMock).not.toHaveBeenCalled()
  })

  it('tolerates a context that throws on service access', async () => {
    const throwing = Object.defineProperty({}, 'subprocess', {
      get() {
        throw new Error('service "subprocess" is not registered')
      }
    })
    const { resolveDeclaredCommand } = await load()
    expect(await resolveDeclaredCommand(throwing, 'npx', {})).toBeUndefined()
    expect(execFileMock).not.toHaveBeenCalled()
  })

  it('falls back to the get accessor when the direct service read is empty', async () => {
    const resolveExecutable = vi.fn(async () => '/usr/bin/tool')
    const ctx = { get: (name: string) => (name === 'subprocess' ? { resolveExecutable } : undefined) }
    const { resolveDeclaredCommand } = await load()
    expect(await resolveDeclaredCommand(ctx, 'tool', {})).toEqual({})
    expect(resolveExecutable).toHaveBeenCalledTimes(1)
  })

  it('does not probe for a non-lookup failure such as a rejected relative path', async () => {
    const resolveExecutable = vi.fn(async () => {
      throw new Error('subprocess-local: command "./tool" is a relative path; use an absolute path or a bare PATH name')
    })
    const { resolveDeclaredCommand } = await load()
    expect(await resolveDeclaredCommand(resolverCtx(resolveExecutable), './tool', {})).toBeUndefined()
    expect(execFileMock).not.toHaveBeenCalled()
  })
})
