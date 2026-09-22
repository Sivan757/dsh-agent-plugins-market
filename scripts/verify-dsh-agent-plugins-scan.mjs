/**
 * Verification: scan the dsh-agent-plugins checkout with the market's own
 * compiled scan pipeline and print discovered suites with their surfaces.
 */
import { discoverSuitesInSource } from '../lib/catalog/suite-scanner.js'

const checkout = process.argv[2] ?? '/Users/sivan/workspace/dsh-agent-plugins'
const suites = await discoverSuitesInSource(checkout, 'dsh-agent-plugins', 'user')
for (const suite of suites) {
  console.log(
    JSON.stringify(
      {
        id: suite.id,
        layout: suite.manifest.layout,
        version: suite.manifest.id === suite.id ? (suite.manifest.version ?? null) : null,
        skills: suite.skills.map(s => s.name ?? s.id ?? s.dir),
        surfaces: suite.surfaces,
        dimension: suite.dimension,
        errors: suite.errors
      },
      null,
      2
    )
  )
}
console.log('total suites:', suites.length)
