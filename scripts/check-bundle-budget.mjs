/**
 * Client bundle budget.
 *
 * The shipped Web bundle is one CommonJS file the host loads through its module
 * loader, so every module this plugin imports is bytes a user downloads before
 * the settings page opens. Measured once, the CodeMirror and lezer graph is
 * 52.6% of that file, which is the single largest thing here and the reason this
 * gate exists: a budget turns "it feels heavy" into a number a change has to
 * argue with, and it fails on the pull request that grows it rather than in a
 * later audit.
 *
 * It is a ceiling, not a target. Raise it deliberately, in the same change that
 * needs the room, with the reason in the commit message; a budget edited
 * quietly in a refactor is the failure this gate is meant to catch.
 *
 * Usage:
 *   node scripts/check-bundle-budget.mjs [--json] [--budget <bytes>]
 *
 * Exit codes: 0 within budget, 1 over budget, 2 the artifact is missing (run `pnpm run build`).
 */
import { existsSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const ARTIFACT = join(ROOT, 'client', 'client.js')

/**
 * The ceiling in bytes, with the size it was set from.
 *
 * Set just above the bundle measured when the gate landed, so unrelated growth
 * fails and a deliberate addition raises it on purpose.
 */
const BUDGET_BYTES = 1_900_000

const argv = process.argv.slice(2)
const useJson = argv.includes('--json')
const budgetAt = argv.indexOf('--budget')
const budget = budgetAt === -1 || argv[budgetAt + 1] === undefined ? BUDGET_BYTES : Number(argv[budgetAt + 1])

if (!Number.isFinite(budget) || budget <= 0) {
  console.error('bundle budget must be a positive byte count')
  process.exitCode = 2
} else if (!existsSync(ARTIFACT)) {
  const message = 'client/client.js is missing; run `pnpm run build` before this gate'
  if (useJson) console.log(JSON.stringify({ error: message }, null, 2))
  else console.error(message)
  process.exitCode = 2
} else {
  const size = statSync(ARTIFACT).size
  const over = size > budget
  if (useJson) {
    console.log(JSON.stringify({ artifact: 'client/client.js', size, budget, over }, null, 2))
  } else {
    const kb = bytes => (bytes / 1024).toFixed(0) + ' KB'
    console.log('client bundle: ' + kb(size) + ' of ' + kb(budget) + ' budget (' + ((size / budget) * 100).toFixed(1) + '%)')
    if (over) console.log('  x client/client.js grew past its budget by ' + kb(size - budget) + '; shrink it or raise the budget in the same change, with the reason')
    else console.log('  ok within budget')
  }
  process.exitCode = over ? 1 : 0
}
