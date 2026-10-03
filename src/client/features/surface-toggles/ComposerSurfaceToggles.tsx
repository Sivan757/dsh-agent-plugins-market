/**
 * The six per-workspace surface switches beside the composer.
 *
 * A compact pill row: one toggle per surface (市场/技能/命令/代理角色/MCP/LSP),
 * each a flat icon-free switch with its label, styled only with the platform
 * tokens the harness defines (see AGENTS.local.md). Flipping one persists the
 * state under the plugin data root keyed by this workspace's path and runs
 * the ordinary reconcile chain, so the change is live, not cosmetic.
 */
import { createElement as h, useEffect, useState } from 'react'
import { loadSurfaceToggles, setSurfaceToggle } from '../../api.js'
import { SURFACE_TOGGLE_KEYS, ALL_SURFACES_ON, resolveSurfaceToggles, type SurfaceToggleKey, type SurfaceToggles } from '../../../contracts/surface-toggles.js'
import type { Translate } from '../../index.js'
import css from './surface-toggles.module.css'

const LABEL_KEYS: Record<SurfaceToggleKey, Parameters<Translate>[0]> = {
  market: 'toggleSurfaceMarket',
  skills: 'toggleSurfaceSkills',
  commands: 'toggleSurfaceCommands',
  agents: 'toggleSurfaceAgents',
  mcp: 'toggleSurfaceMcp',
  lsp: 'toggleSurfaceLsp'
}

export interface ComposerSurfaceTogglesProps {
  t: Translate
}

export function ComposerSurfaceToggles({ t }: ComposerSurfaceTogglesProps): React.ReactElement {
  const [toggles, setToggles] = useState<SurfaceToggles>(ALL_SURFACES_ON)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let alive = true
    loadSurfaceToggles()
      .then(value => {
        if (alive) {
          setToggles(resolveSurfaceToggles(value))
          setReady(true)
        }
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [])

  const flip = (key: SurfaceToggleKey, enabled: boolean): void => {
    setToggles(current => ({ ...current, [key]: enabled }))
    setSurfaceToggle(key, enabled)
      .then(value => setToggles(resolveSurfaceToggles(value)))
      .catch(() => {})
  }

  return h(
    'div',
    { className: css.pillRow, 'data-ready': ready ? 'true' : 'false' },
    SURFACE_TOGGLE_KEYS.map(key =>
      h(
        'label',
        { key, className: css.pill },
        h('span', { className: css.pillLabel }, t(LABEL_KEYS[key])),
        h('input', {
          type: 'checkbox',
          className: css.pillInput,
          checked: toggles[key],
          onChange: event => flip(key, event.currentTarget.checked)
        })
      )
    )
  )
}
