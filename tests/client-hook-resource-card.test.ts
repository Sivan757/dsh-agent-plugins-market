// @vitest-environment jsdom
/**
 * Hook card interaction semantics: what a click and a keypress do on the
 * read-only settings card and on the preset manager's selection card, and what
 * a disabled or already-limited row refuses to do.
 */
import { act, createElement as h } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { HookResourceCard, type HookResourceCardProps } from '../packages/market-ui/src/ui/HookResourceCard.js'
import { resourceSelected } from '../packages/market-ui/src/features/extension-presets/resource.js'
import { extensionPresetsEn as en } from '../packages/market-ui/src/locales-extension-presets.js'
import { en as settingsEn } from '../packages/market-ui/src/locales.js'
import type { ExtensionResource } from '../packages/market-contracts/src/contracts/extension-presets.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const t = (key: string) => en[key as keyof typeof en] ?? settingsEn[key as keyof typeof settingsEn] ?? key

/** One supported hook row as the server ships it. */
const hookRow = (over: Partial<ExtensionResource> = {}): ExtensionResource => ({
  id: 'hooks:@user-hooks/user-hooks/PreToolUse/0',
  face: 'hooks',
  name: 'echo guard',
  source: 'user-hooks',
  description: 'PreToolUse',
  available: true,
  globalEnabled: true,
  detail: {
    kind: 'hook',
    sourceId: '@user-hooks',
    suiteId: 'user-hooks',
    event: 'PreToolUse',
    hookIndex: 0,
    command: 'echo guard',
    matcher: 'Edit',
    timeoutSec: 12,
    provenance: 'user-hooks',
    support: 'supported'
  },
  ...over
})

let root: Root | undefined
afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  document.body.replaceChildren()
})

async function mountCard(props: HookResourceCardProps): Promise<HTMLElement> {
  const host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => root!.render(h(HookResourceCard, props)))
  return document.querySelector('article')!
}

async function press(element: HTMLElement, key: string): Promise<void> {
  await act(async () => {
    element.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
  })
}

describe('settings card (read-only)', () => {
  it('opens the detail by click and by Enter', async () => {
    const onView = vi.fn()
    const row = hookRow()
    const card = await mountCard({ row, t, state: 'active', onView })

    await act(async () => card.click())
    expect(onView).toHaveBeenCalledExactlyOnceWith(row)

    await press(card, 'Enter')
    expect(onView).toHaveBeenCalledTimes(2)
  })

  it('marks a follows-suite row and never offers it a switch', async () => {
    const card = await mountCard({ row: hookRow({ followsSuite: true, suiteResourceId: 'market:zealwon-plugins/dsh-workflow' }), t, state: 'active', onView: () => {} })

    expect(card.textContent).toContain(en.epHookFollowsSuite)
    expect(card.querySelector('[role="switch"]')).toBeNull()
  })

  it('renders no switch and opens once when the info action is clicked', async () => {
    const onView = vi.fn()
    const card = await mountCard({ row: hookRow(), t, state: 'active', onView })

    expect(card.querySelector('[role="switch"]')).toBeNull()
    await act(async () => card.querySelector<HTMLButtonElement>('button')!.click())
    // The action cluster stops its own events, so the card handler never runs too.
    expect(onView).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: hookRow().id }))
  })
})

describe('follows-suite selection', () => {
  it('mirrors the owning suite instead of its own row id', () => {
    const row = hookRow({ followsSuite: true, suiteResourceId: 'market:zealwon-plugins/dsh-workflow' })

    expect(resourceSelected(row, ['market:zealwon-plugins/dsh-workflow'])).toBe(true)
    expect(resourceSelected(row, [row.id])).toBe(false)
  })
})

describe('preset card (selection)', () => {
  it('toggles by click and by Enter while the draft accepts changes', async () => {
    const onChange = vi.fn()
    const card = await mountCard({ row: hookRow(), t, state: 'disabled', toggle: { selected: false, disabled: false, onChange }, onView: () => {} })

    await act(async () => card.click())
    expect(onChange).toHaveBeenCalledExactlyOnceWith(true)
    await press(card, 'Enter')
    expect(onChange).toHaveBeenCalledTimes(2)
  })

  it('stays inert while the toggle is disabled, and offers the info action instead', async () => {
    const onChange = vi.fn()
    const onView = vi.fn()
    const card = await mountCard({ row: hookRow(), t, state: 'disabled', toggle: { selected: false, disabled: true, onChange }, onView })

    await act(async () => card.click())
    await press(card, 'Enter')
    // Neither the card's click nor its Enter reaches a selection it cannot make.
    expect(onChange).not.toHaveBeenCalled()
    expect(card.getAttribute('role')).toBeNull()
    expect(card.getAttribute('aria-pressed')).toBeNull()

    await act(async () => card.querySelector<HTMLButtonElement>('button')!.click())
    expect(onView).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: hookRow().id }))
    expect(onChange).not.toHaveBeenCalled()
  })

  it('keeps a limited row on its on/off tag, with no switch', async () => {
    const onChange = vi.fn()
    const card = await mountCard({
      row: hookRow({ available: false, control: 'global-only', unavailableReason: 'hook-event-unsupported' }),
      t,
      state: 'disabled',
      toggle: { selected: false, disabled: true, onChange },
      onView: () => {}
    })

    expect(card.querySelector('[role="switch"]')).toBeNull()
    expect(card.textContent).toContain(en.epOff)
    await act(async () => card.click())
    expect(onChange).not.toHaveBeenCalled()
  })
})
