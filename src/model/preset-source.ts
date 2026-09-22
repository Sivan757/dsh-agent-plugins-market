/**
 * The source record this plugin presets.
 *
 * The first-party collection lives in its own repository. The plugin ships one
 * registration pointing at it, so a fresh install lists the repository without
 * anyone pasting a URL; from there it is an ordinary Git source — refresh to
 * clone, then install and toggle its suites. Nothing marks it as different, and
 * no setting owns it.
 *
 * @module model/preset-source
 */
import type { SourceRef } from './types.js'

/** Source id the preset record registers under. */
export const PRESET_SOURCE_ID = 'dsh-agent-plugins'

/** Repository the preset record points at. */
export const PRESET_SOURCE_URL = 'https://github.com/Sivan757/dsh-agent-plugins.git'

/** The preset registration, as the market stores it. */
export function presetSourceRef(): SourceRef {
  return { id: PRESET_SOURCE_ID, url: PRESET_SOURCE_URL, kind: 'git' }
}
