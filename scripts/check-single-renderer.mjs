#!/usr/bin/env node
/**
 * Single renderer gate.
 *
 * The resource list exists once. Every surface that lists resources renders
 * `ui/ResourceSurface`, which is the only module allowed to import the card
 * primitives and assemble a list. A surface that imports them itself is a second
 * implementation, and the next change would land in one of the two again.
 *
 * One surface is still being migrated. It is named here so the gate keeps the
 * remaining work visible and fails the moment a third one appears; the entry
 * disappears with the migration.
 *
 * Usage:
 *   node scripts/check-single-renderer.mjs
 */
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

const SOURCE_ROOT = 'packages/market-ui/src'
/** The renderer itself: the one module that may assemble a list. */
const RENDERER = 'ui/ResourceSurface.tsx'
/** Surfaces still rendering their own list. Empty is the goal. */
const REMAINING = new Set([
  // The settings user panels (skills, agents, shortcuts).
  'ui/UserPanelSurface.tsx',
  // The settings status panels: each lists its services with its own toolbar.
  'features/hooks/StatusPanel.tsx',
  'features/lsp/LspStatusPanel.tsx',
  'features/mcp/StatusPanel.tsx',
  // The market browse surface.
  'features/market/MarketSection.tsx'
])
// A list is a toolbar plus a collection: importing the card alone is presentational,
// importing either of these means the module assembles a list of its own.
const PRIMITIVES = /from '[^']*(ResourceCollection|SearchFilterToolbar)/

/** Every .tsx file under the client source root, as paths relative to it. */
async function sources(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) files.push(...(await sources(path)))
    else if (entry.name.endsWith('.tsx')) files.push(path.slice(SOURCE_ROOT.length + 1))
  }
  return files
}

const files = await sources(SOURCE_ROOT)
const offenders = []
for (const file of files) {
  if (file === RENDERER || file === 'ui/SearchFilterToolbar.tsx') continue
  const text = await readFile(join(SOURCE_ROOT, file), 'utf8')
  if (PRIMITIVES.test(text)) offenders.push(file)
}

const unexpected = offenders.filter(file => !REMAINING.has(file))
const migrated = [...REMAINING].filter(file => !offenders.includes(file))
const problems = []
if (unexpected.length > 0) {
  problems.push('a second resource list renders cards directly: ' + unexpected.join(', '))
}
if (migrated.length > 0) {
  problems.push('already migrated, remove it from REMAINING: ' + migrated.join(', '))
}

if (problems.length === 0) {
  const note = REMAINING.size === 0 ? 'every surface renders the one list' : 'still migrating: ' + [...REMAINING].join(', ')
  console.log('single renderer: ' + (offenders.length + 1) + ' list module(s), ' + note)
  process.exit(0)
}
for (const problem of problems) console.error('  x [single-renderer] ' + problem)
process.exit(1)
