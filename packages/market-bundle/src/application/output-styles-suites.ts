/**
 * Suite output styles: which enabled suites declare one, and the one capture
 * that reads it.
 *
 * A Claude Code output-style plugin delivers its text from a SessionStart hook,
 * so the only way to know what a suite would inject is to run that hook once.
 * This module does exactly that and nothing else: the candidate list carries the
 * declaration commands a fingerprint is computed from, and a capture runs them
 * through the existing bounded dry run in the user's home directory.
 *
 * Nothing here runs on a read. Running a suite's program is an effect a person
 * asks for, and the captured text is what the prompt receives afterwards.
 * @module application/output-styles-suites
 */
import { homedir } from 'node:os'
import type { Context } from '@deepseek-ai/cordis'
import { pluginPathEnvironment, pluginRootOf, suiteDataDir } from '../../../market-catalog/src/index.js'
import type { Suite } from '../../../market-contracts/src/model/types.js'
import {
  HOOK_RUN_SHELL_UNAVAILABLE,
  hookRunShellOf,
  runHookDryRun,
  shellSeamOf,
  suiteStyleFingerprint,
  type OutputStyleSuitePort,
  type SuiteStyleCandidate
} from '../../../market-runtime/src/index.js'

/** The catalog slice this module reads. */
export interface OutputStyleSuiteCatalog {
  enabledUserSuites(): Promise<Suite[]>
}

/** What the port needs from the composition root. */
export interface OutputStyleSuiteWiring {
  catalog: OutputStyleSuiteCatalog
  /** The context a shell seam is resolved from at capture time. */
  hostCtx: Context
  /** The plugin data root, for the suite data directory env. */
  dataRoot: string
}

/** One SessionStart command a candidate declares, with its declared timeout. */
interface DeclaredCommand {
  command: string
  timeoutSec?: number
}

/**
 * Every SessionStart command one suite declares, in declaration order.
 *
 * A suite contributes a style by printing it from these hooks, so the capture
 * runs all of them; the order is the order the bridge would run them in.
 * @param suite - the enabled suite.
 * @returns the declared commands.
 */
function sessionStartCommands(suite: Suite): DeclaredCommand[] {
  const groups = suite.hooks?.events['SessionStart'] ?? []
  const commands: DeclaredCommand[] = []
  for (const group of groups) {
    for (const hook of group.hooks) {
      if (hook.type !== 'command' || hook.command.trim() === '') continue
      commands.push({ command: hook.command, ...(hook.timeout === undefined ? {} : { timeoutSec: hook.timeout }) })
    }
  }
  return commands
}

/** The suite address used in a style id. */
function suiteKeyOf(suite: Suite): string {
  return suite.sourceId + '/' + suite.id
}

/**
 * Build the port the output-style service reads suites through.
 *
 * A suite with no SessionStart command is not a candidate: there is nothing to
 * capture, and offering the row would promise text that cannot exist.
 * @param wiring - the catalog, the context holding the shell seam, and the data root.
 * @returns the port.
 */
export function createOutputStyleSuitePort(wiring: OutputStyleSuiteWiring): OutputStyleSuitePort {
  const candidates = async (): Promise<SuiteStyleCandidate[]> => {
    const rows: SuiteStyleCandidate[] = []
    for (const suite of await wiring.catalog.enabledUserSuites()) {
      const commands = sessionStartCommands(suite)
      if (commands.length === 0) continue
      const suiteKey = suiteKeyOf(suite)
      rows.push({
        suiteKey,
        label: suite.manifest.name,
        // A code, not a sentence: this module runs on the server, and user-visible copy
        // belongs in the client's bilingual dictionaries. The panel renders the key this
        // code maps to.
        description: 'suiteSessionStartCapture',
        fingerprint: suiteStyleFingerprint({
          suiteKey,
          ...(suite.manifest.version === undefined ? {} : { version: suite.manifest.version }),
          root: suite.root,
          commands: commands.map(entry => entry.command)
        })
      })
    }
    return rows
  }

  const capture = async (suiteKey: string, fingerprint: string): Promise<string> => {
    const suite = (await wiring.catalog.enabledUserSuites()).find(candidate => suiteKeyOf(candidate) === suiteKey)
    if (suite === undefined) throw new Error('no enabled suite "' + suiteKey + '" declares a SessionStart hook to capture')
    const commands = sessionStartCommands(suite)
    if (commands.length === 0) throw new Error('suite "' + suiteKey + '" declares no SessionStart command')
    const current = suiteStyleFingerprint({
      suiteKey,
      ...(suite.manifest.version === undefined ? {} : { version: suite.manifest.version }),
      root: suite.root,
      commands: commands.map(entry => entry.command)
    })
    // A suite that changed between the page's read and this capture is refused:
    // storing its output under the older fingerprint would report a stale
    // capture as current, which is the one thing the fingerprint exists to stop.
    if (current !== fingerprint) throw new Error('suite "' + suiteKey + '" changed since the page read it; reload and capture again')
    const shell = hookRunShellOf(shellSeamOf(wiring.hostCtx))
    if (shell === undefined) throw new Error(HOOK_RUN_SHELL_UNAVAILABLE)
    const root = pluginRootOf(suite)
    const data = root === undefined ? undefined : suiteDataDir(wiring.dataRoot, suite.sourceId, suite.id)
    const env = pluginPathEnvironment({
      ...(root === undefined ? {} : { root }),
      ...(data === undefined ? {} : { data }),
      projectDir: homedir()
    })
    const parts: string[] = []
    for (const declared of commands) {
      const result = await runHookDryRun(shell, declared.command, {
        event: 'SessionStart',
        ...(declared.timeoutSec === undefined ? {} : { timeoutSec: declared.timeoutSec }),
        ...(Object.keys(env).length === 0 ? {} : { env })
      })
      if (result.error !== undefined) throw new Error('the SessionStart hook could not run: ' + result.error)
      if (result.timedOut) throw new Error('the SessionStart hook timed out')
      parts.push(result.stdout)
    }
    return parts.join('\n')
  }

  return { candidates, capture }
}
