import { describe, expect, it } from 'vitest'
import { suiteLayoutLabel } from '../src/client/layout-label.js'
import { jsonTreeLabels } from '../src/client/ui/json-tree-labels.js'
import { lastChangeLabel } from '../src/client/ui/last-change.js'
import { stubTranslate as t } from './helpers/translate.js'

describe('suite layout labels', () => {
  it('maps every declared layout to its dictionary key', () => {
    expect(suiteLayoutLabel('agent-plugin-v1', t)).toBe('layoutV1')
    expect(suiteLayoutLabel('claude-code', t)).toBe('layoutCC')
    expect(suiteLayoutLabel('codex', t)).toBe('layoutCodex')
    expect(suiteLayoutLabel('universal', t)).toBe('layoutUniversal')
    expect(suiteLayoutLabel('cursor', t)).toBe('layoutCursor')
    expect(suiteLayoutLabel('kimi', t)).toBe('layoutKimi')
    expect(suiteLayoutLabel('zcode', t)).toBe('layoutZcode')
    expect(suiteLayoutLabel('qoder', t)).toBe('layoutQoder')
    expect(suiteLayoutLabel('github-copilot', t)).toBe('layoutCopilot')
    expect(suiteLayoutLabel('remote', t)).toBe('layoutRemote')
    expect(suiteLayoutLabel('project-native', t)).toBe('layoutProjectNative')
    expect(suiteLayoutLabel('skill-collection', t)).toBe('layoutSkills')
  })

  it('shows an unknown layout kind as itself', () => {
    expect(suiteLayoutLabel('brand-new-layout', t)).toBe('brand-new-layout')
  })
})

describe('the shared last-change wording', () => {
  it('dates each host relative-time bucket with the plugin words', () => {
    const NOW = Date.now()
    const bucket = (ms: number): string => lastChangeLabel(t, new Date(NOW - ms).toISOString()) as string
    expect(bucket(30_000)).toBe('timeNow')
    expect(bucket(5 * 60_000)).toBe('5 timeMinutes')
    expect(bucket(3 * 3_600_000)).toBe('3 timeHours')
    expect(bucket(2 * 86_400_000)).toBe('2 timeDays')
    expect(bucket(45 * 86_400_000)).toBe('1 timeMonths')
    expect(bucket(400 * 86_400_000)).toBe('1 timeYears')
  })

  it('never renders for an unreadable timestamp', () => {
    expect(lastChangeLabel(t, 'not a date')).toBeNull()
    expect(lastChangeLabel(t, '')).toBeNull()
  })
})

describe('the shared JSON-tree labels factory', () => {
  it('resolves every copy string from the active dictionary', () => {
    const labels = jsonTreeLabels(t)
    expect(labels.copyValue).toBe('jsonCopyValue')
    expect(labels.copyJson).toBe('jsonCopyJson')
    expect(labels.copyPath).toBe('jsonCopyPath')
    expect(labels.copyPrettyJson).toBe('jsonCopyPretty')
    expect(labels.copyCompactJson).toBe('jsonCopyCompact')
    expect(labels.copied).toBe('jsonCopied')
    expect(labels.copyFailed).toBe('jsonCopyFailed')
    expect(labels.collapseNode).toBe('jsonCollapseNode')
    expect(labels.expandNode).toBe('jsonExpandNode')
    expect(typeof labels.copyButtonTitle).toBe('function')
    expect(labels.copyButtonTitle('path')).toBe('jsonCopyAction path')
  })
})
