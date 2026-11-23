/** The boot facts `e2e/host.mjs` writes for the suite, and the paths they live at. */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** One booted host: where it answers, and the isolated home it answers from. */
export interface HostTarget {
  /** The authenticated URL; the token is what admits this browser to the host. */
  url: string
  port: number
  home: string
  profileDirectory: string
  pid: number
}

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

/** The target file the host script writes before Playwright's readiness check passes. */
export const TARGET_PATH = join(ROOT, 'node_modules', '.cache', 'e2e', 'target.json')

/**
 * Read the booted host's target.
 * @returns the parsed target file.
 */
export function readHostTarget(): HostTarget {
  return JSON.parse(readFileSync(TARGET_PATH, 'utf8')) as HostTarget
}
