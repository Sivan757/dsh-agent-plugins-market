import { effectiveSurfaces, type DiscoveredSuite, type Suite } from '../../src/model/types.js'

/**
 * Scan output in the shape a runtime consumer takes.
 *
 * These tests drive a consumer straight from a scan, so the suite has no
 * install entry: every surface keeps its enabled default, except where the
 * layout declared the set itself (`project-native`).
 */
export function withDefaultSurfaces(suite: DiscoveredSuite): Suite {
  return { ...suite, activeSurfaces: suite.activeSurfaces ?? effectiveSurfaces(undefined) }
}
