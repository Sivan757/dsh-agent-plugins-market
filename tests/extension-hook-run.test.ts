/**
 * The hook detail modal's dry run.
 *
 * Three boundaries: the HTTP route (POST only, same-origin, result passthrough),
 * the server-side declaration resolution (the client names identity, never a
 * command), and the bounded run (home directory, synthetic stdin, capped
 * streams). The shell is faked, so no command from a fixture ever executes.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { homedir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mountExtensionPresetRoutes, type ExtensionRouteService } from '../packages/market-bundle/src/routes-extension-presets.js'
import { resolveHookDeclaration } from '../packages/market-bundle/src/session-extension.js'
import {
  HOOK_RUN_DEFAULT_TIMEOUT_SEC,
  HOOK_RUN_MAX_OUTPUT_CHARS,
  HOOK_RUN_MAX_TIMEOUT_MS,
  HOOK_RUN_NO_COMMAND,
  HOOK_RUN_SHELL_UNAVAILABLE,
  HOOK_RUN_UNKNOWN_DECLARATION,
  hookRunFailure,
  hookRunShellOf,
  runHookDryRun,
  type HookRunShell,
  type HookRunShellRequest,
  type HookRunShellResult
} from '../packages/market-runtime/src/runtime/surfaces/hook-dry-run.js'
import {
  captureExtensionSelection,
  EXTENSION_ROUTES,
  type ExtensionHookRunInput,
  type ExtensionHookRunResult,
  type ExtensionWindowPayload
} from '../packages/market-contracts/src/contracts/extension-presets.js'
import { effectiveSurfaces, type ProjectHooks, type Suite } from '../packages/market-contracts/src/model/types.js'

/** The user-hooks synthetic suite, the shape loadUserHooksSuite always builds. */
const hookSuite = (overrides: { events?: ProjectHooks['events']; errors?: string[] }): Suite => ({
  sourceId: '@user-hooks',
  id: 'user-hooks',
  root: '/agents-root',
  manifest: { layout: 'agent-plugin-v1', path: '/agents-root/hooks/hooks.json', id: 'user-hooks', name: 'user-hooks' },
  skills: [],
  surfaces: { skills: 0, mcp: 0, hooks: 0, commands: 0, agents: 0, lsp: 0 },
  dimension: 'user',
  enabled: true,
  activeSurfaces: effectiveSurfaces({ skills: false, mcp: false, commands: false, agents: false, lsp: false }),
  installedAt: 'user',
  ...(overrides.events === undefined ? {} : { hooks: { events: overrides.events } }),
  errors: overrides.errors ?? []
})

const command = (text: string, timeout?: number): { type: 'command'; command: string; timeout?: number } => ({
  type: 'command',
  command: text,
  ...(timeout === undefined ? {} : { timeout })
})

/** The status reads readExtensionInventory needs; resolution never touches the panels. */
function catalogDouble(): Parameters<typeof resolveHookDeclaration>[0] {
  return {
    enabledUserSuites: async () => [],
    overview: async () => ({ sources: [], suites: [], totals: { all: 0, installed: 0, enabled: 0 }, roots: { user: '/tmp', data: '/tmp' } }),
    mcpStatus: async () => ({
      entries: [],
      observedAt: '',
      totals: { all: 0, connected: 0, degraded: 0, failed: 0, needsCredentials: 0, orphaned: 0, disabled: 0, foreign: 0 },
      directObservationOnly: false
    }),
    lspStatus: async () => ({ entries: [], observedAt: '', totals: { all: 0, mounted: 0, failed: 0, blocked: 0, disabled: 0 }, hostMissing: false })
  }
}

const address = (overrides: Partial<ExtensionHookRunInput> = {}): ExtensionHookRunInput => ({
  sourceId: '@user-hooks',
  suiteId: 'user-hooks',
  event: 'PreToolUse',
  hookIndex: 1,
  ...overrides
})

function outcome(overrides: Partial<HookRunShellResult> = {}): HookRunShellResult {
  return { exitCode: 0, timedOut: false, aborted: false, stdout: { text: '', truncated: false }, stderr: { text: '', truncated: false }, ...overrides }
}

/** A shell executor that records the resolved request and answers one outcome. */
function shellFor(answer: HookRunShellResult): HookRunShell & { requests: HookRunShellRequest[] } {
  const requests: HookRunShellRequest[] = []
  return {
    requests,
    resolve(request) {
      requests.push(request)
      return request
    },
    async execute() {
      return { result: async () => answer }
    }
  }
}

describe('dry-run declaration resolution', () => {
  const suites = [
    hookSuite({
      events: {
        PreToolUse: [{ matcher: 'Edit', hooks: [command('echo first', 5)] }, { hooks: [command('echo second')] }]
      }
    })
  ]

  it('resolves the declaration the client addressed from the rows the overview publishes', async () => {
    const first = await resolveHookDeclaration(catalogDouble(), suites, address({ hookIndex: 0 }))
    expect(first).toMatchObject({ command: 'echo first', timeoutSec: 5, suite: suites[0] })
    const second = await resolveHookDeclaration(catalogDouble(), suites, address({ hookIndex: 1 }))
    expect(second).toMatchObject({ command: 'echo second', suite: suites[0] })
    expect('timeoutSec' in second && second.timeoutSec !== undefined).toBe(false)
  })

  it('answers unknown-declaration for an address no published row matches', async () => {
    expect(await resolveHookDeclaration(catalogDouble(), suites, address({ event: 'Stop' }))).toEqual({ error: HOOK_RUN_UNKNOWN_DECLARATION })
    expect(await resolveHookDeclaration(catalogDouble(), suites, address({ hookIndex: 9 }))).toEqual({ error: HOOK_RUN_UNKNOWN_DECLARATION })
    expect(await resolveHookDeclaration(catalogDouble(), suites, address({ sourceId: 'other' }))).toEqual({ error: HOOK_RUN_UNKNOWN_DECLARATION })
  })

  it('answers no-command for a rejected declaration that exists only as a diagnostic', async () => {
    // A rejected event leaves no admitted declaration, so the suite still carries
    // the admitted ones and the rejection rides its diagnostics.
    const rejected = [hookSuite({ events: { Stop: [{ hooks: [command('echo stop')] }] }, errors: ['hooks.json unsupported hook event SessionEnd'] })]
    const resolved = await resolveHookDeclaration(catalogDouble(), rejected, address({ event: 'SessionEnd', hookIndex: undefined }))
    expect(resolved).toEqual({ error: HOOK_RUN_NO_COMMAND })
  })
})

describe('dry-run shell narrowing', () => {
  it('accepts an executor seam and rejects a legacy run-only seam', () => {
    const executor = shellFor(outcome())
    expect(hookRunShellOf(executor)).toBe(executor)
    expect(hookRunShellOf({ resolve: () => ({}), run: async () => outcome() })).toBeUndefined()
    expect(hookRunShellOf({ resolve: () => ({}) })).toBeUndefined()
    expect(hookRunShellOf(undefined)).toBeUndefined()
    expect(hookRunShellOf('shell')).toBeUndefined()
  })

  it('reports a stable code for a failure result without a run', () => {
    expect(hookRunFailure(HOOK_RUN_SHELL_UNAVAILABLE)).toEqual({
      cwd: homedir(),
      stdout: '',
      stderr: '',
      durationMs: 0,
      timedOut: false,
      truncated: false,
      error: HOOK_RUN_SHELL_UNAVAILABLE
    })
  })
})

describe('dry-run execution', () => {
  it('runs the declared command in the home directory with the synthetic stdin payload', async () => {
    const shell = shellFor(outcome({ stdout: { text: 'ok\n', truncated: false } }))
    const result = await runHookDryRun(shell, 'echo ok', {
      event: 'PreToolUse',
      timeoutSec: 5,
      env: { CLAUDE_PLUGIN_ROOT: '/agents-root', CLAUDE_PROJECT_DIR: homedir() }
    })
    expect(result).toMatchObject({
      cwd: homedir(),
      exitCode: 0,
      stdout: 'ok\n',
      stderr: '',
      timedOut: false,
      truncated: false
    })
    expect(typeof result.durationMs).toBe('number')
    expect(shell.requests).toHaveLength(1)
    const request = shell.requests[0]!
    expect(request.command).toBe('echo ok')
    expect(request.workdir).toBe(homedir())
    expect(request.timeoutMs).toBe(5000)
    expect(request.stdoutMaxBytes).toBe(HOOK_RUN_MAX_OUTPUT_CHARS)
    expect(request.env).toEqual({ CLAUDE_PLUGIN_ROOT: '/agents-root', CLAUDE_PROJECT_DIR: homedir() })
    expect(JSON.parse(request.stdin ?? '')).toEqual({
      hook_event_name: 'PreToolUse',
      session_id: 'dry-run',
      transcript_path: '',
      cwd: homedir(),
      permission_mode: 'default',
      dry_run: true
    })
  })

  it('defaults the timeout and caps a declared one at the module ceiling', async () => {
    const defaulted = shellFor(outcome())
    await runHookDryRun(defaulted, 'echo', { event: 'Stop' })
    expect(defaulted.requests[0]!.timeoutMs).toBe(HOOK_RUN_DEFAULT_TIMEOUT_SEC * 1000)

    const capped = shellFor(outcome())
    await runHookDryRun(capped, 'echo', { event: 'Stop', timeoutSec: 120 })
    expect(capped.requests[0]!.timeoutMs).toBe(HOOK_RUN_MAX_TIMEOUT_MS)
  })

  it('caps each stream independently and marks the result truncated', async () => {
    const shell = shellFor(outcome({ stdout: { text: 'x'.repeat(HOOK_RUN_MAX_OUTPUT_CHARS + 120), truncated: false }, stderr: { text: 'y'.repeat(4), truncated: false } }))
    const result = await runHookDryRun(shell, 'noisy', { event: 'UserPromptSubmit' })
    expect(result.stdout).toHaveLength(HOOK_RUN_MAX_OUTPUT_CHARS)
    expect(result.stderr).toBe('yyyy')
    expect(result.truncated).toBe(true)
  })

  it('keeps the executor truncation flag and maps a signal death to no exit code', async () => {
    const shell = shellFor(outcome({ exitCode: null, timedOut: true, stdout: { text: 'head', truncated: true } }))
    const result = await runHookDryRun(shell, 'slow', { event: 'Stop' })
    expect(result.exitCode).toBeUndefined()
    expect(result.timedOut).toBe(true)
    expect(result.truncated).toBe(true)
  })

  it('answers a failure result when the executor rejects, without throwing', async () => {
    const shell: HookRunShell = {
      resolve: () => ({}),
      async execute() {
        throw new Error('workdir is unusable')
      }
    }
    const result = await runHookDryRun(shell, 'echo', { event: 'Stop' })
    expect(result).toMatchObject({ cwd: homedir(), stdout: '', stderr: '', error: 'workdir is unusable' })
  })
})

describe('hook dry-run route', () => {
  const cleanups: Array<() => Promise<void>> = []
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
  })

  const result: ExtensionHookRunResult = { cwd: '/home/user', exitCode: 0, stdout: 'ok\n', stderr: '', durationMs: 2, timedOut: false, truncated: false }

  async function setup(withRun = true) {
    const window: ExtensionWindowPayload = {
      sessionId: 'session',
      workspace: '/server/workspace',
      started: false,
      busy: false,
      library: { revision: 1, defaultPresetId: null, presets: [] },
      state: { revision: 1, selection: captureExtensionSelection(null, []) },
      resources: []
    }
    const service = {
      window: vi.fn(async () => window),
      create: vi.fn(async () => {}),
      update: vi.fn(async () => {}),
      delete: vi.fn(async () => {}),
      setDefault: vi.fn(async () => {}),
      select: vi.fn(async () => {}),
      ...(withRun ? { hookRun: vi.fn(async () => result) } : {})
    } satisfies ExtensionRouteService
    const routes = new Map<string, (request: IncomingMessage, response: ServerResponse) => Promise<void>>()
    const dispose = mountExtensionPresetRoutes(
      {
        webServer: {
          register(route) {
            routes.set(route.path, (request, response) => route.handler(request, response))
            return () => {
              routes.delete(route.path)
            }
          }
        }
      },
      service
    )
    const server = createServer((request, response) => {
      const handler = routes.get(new URL(request.url ?? '/', 'http://localhost').pathname)
      if (!handler) {
        response.writeHead(404)
        response.end()
        return
      }
      void handler(request, response).catch(error => response.destroy(error as Error))
    })
    cleanups.push(async () => {
      dispose()
      await new Promise<void>((resolve, reject) => {
        server.close(error => (error ? reject(error) : resolve()))
        server.closeAllConnections()
      })
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const listening = server.address()
    if (!listening || typeof listening === 'string') throw new Error('expected loopback listener')
    const base = 'http://127.0.0.1:' + listening.port
    const post = (body: unknown, headers: Record<string, string> = {}) =>
      fetch(base + EXTENSION_ROUTES.hookRun, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) })
    return { service, base, post }
  }

  it('runs the addressed declaration and answers the result itself', async () => {
    const { service, post } = await setup()
    const response = await post({ ...address(), command: 'rm -rf /', cwd: '/attacker' })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(result)
    expect((service as { hookRun?: unknown }).hookRun).toHaveBeenCalledExactlyOnceWith({
      sourceId: '@user-hooks',
      suiteId: 'user-hooks',
      event: 'PreToolUse',
      hookIndex: 1
    })
  })

  it('forwards a session id without ever forwarding a command or a directory', async () => {
    const { service, post } = await setup()
    const response = await post({ ...address(), sessionId: 'session-7', command: 'echo attacker', cwd: '/attacker' })
    expect(response.status).toBe(200)
    expect((service as { hookRun?: unknown }).hookRun).toHaveBeenCalledExactlyOnceWith({
      sourceId: '@user-hooks',
      suiteId: 'user-hooks',
      event: 'PreToolUse',
      hookIndex: 1,
      sessionId: 'session-7'
    })
  })

  it('accepts POST only', async () => {
    const { service, base } = await setup()
    expect((await fetch(base + EXTENSION_ROUTES.hookRun)).status).toBe(405)
    expect((service as { hookRun?: unknown }).hookRun).not.toHaveBeenCalled()
  })

  it('rejects a cross-origin request before invoking the service', async () => {
    const { service, post } = await setup()
    const response = await post(address(), { origin: 'https://attacker.invalid' })
    expect(response.status).toBe(403)
    expect((service as { hookRun?: unknown }).hookRun).not.toHaveBeenCalled()
  })

  it('answers 400 with a code when the run service is unavailable', async () => {
    const { base } = await setup(false)
    const response = await fetch(base + EXTENSION_ROUTES.hookRun, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(address())
    })
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ ok: false, code: 'extension-hook-run-unavailable' })
  })

  it('rejects a malformed address and an invalid hook index before invoking the service', async () => {
    const { service, post } = await setup()
    expect((await post({ ...address(), sourceId: '' })).status).toBe(400)
    expect((await post({ ...address(), hookIndex: -1 })).status).toBe(400)
    expect((await post({ ...address(), hookIndex: 1.5 })).status).toBe(400)
    expect((service as { hookRun?: unknown }).hookRun).not.toHaveBeenCalled()
  })
})
