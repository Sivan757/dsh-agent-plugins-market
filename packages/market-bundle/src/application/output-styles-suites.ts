/**
 * Suite output styles: the Markdown files every enabled suite ships.
 *
 * Claude Code delivers a plugin style as a file under `output-styles/`, so the page
 * reads the same text a session would. Nothing runs here: a suite that injects
 * persona text from a SessionStart hook is a hook, and this list never sees it.
 * @module application/output-styles-suites
 */
import type { Suite } from '../../../market-contracts/src/model/types.js'
import type { OutputStyleSuitePort, SuiteStyleEntry } from '../../../market-runtime/src/index.js'

/** The catalog slice this module reads. */
export interface OutputStyleSuiteCatalog {
  enabledUserSuites(): Promise<Suite[]>
}

/** What the port needs from the composition root. */
export interface OutputStyleSuiteWiring {
  catalog: OutputStyleSuiteCatalog
}

/**
 * Build the port the output-style service reads suites through.
 * @param wiring - the catalog that lists the enabled suites.
 * @returns the port.
 */
export function createOutputStyleSuitePort(wiring: OutputStyleSuiteWiring): OutputStyleSuitePort {
  return {
    styleFiles: async (): Promise<SuiteStyleEntry[]> => {
      const entries: SuiteStyleEntry[] = []
      for (const suite of await wiring.catalog.enabledUserSuites()) {
        for (const style of suite.styles ?? []) {
          entries.push({
            suiteKey: suite.sourceId + '/' + suite.id,
            suiteName: suite.manifest.name ?? suite.id,
            name: style.name,
            description: style.description,
            body: style.body,
            file: style.file
          })
        }
      }
      return entries
    }
  }
}
