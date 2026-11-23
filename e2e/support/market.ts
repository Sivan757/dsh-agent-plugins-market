import { test as base, expect, type Locator, type Page } from '@playwright/test'
import { readHostTarget } from './host-target.js'

/** The opened market surface and the selectors every spec shares. */
export interface Market {
  page: Page
  /** The workspace root: one tab row and the active panel. */
  workspace: Locator
  /** The Market tab's suite cards. */
  cards: Locator
}

/**
 * Close the dialogs a fresh host opens before the shell is usable.
 *
 * An isolated home has no credentials yet, so the host greets it with the
 * get-started gate; the preview notice, when it appears, carries the same
 * close control. Both are host surfaces, not the market's.
 */
async function dismissHostPrompts(page: Page): Promise<void> {
  const dialogs = page.locator('[role="dialog"]:visible')
  let quiet = 0
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const count = await dialogs.count()
    if (count === 0) {
      quiet += 1
      if (quiet >= 2) return
      await page.waitForTimeout(300)
      continue
    }
    quiet = 0
    const dialog = dialogs.last()
    const close = dialog.getByRole('button', { name: 'Close' })
    const proceed = dialog.getByRole('button', { name: /continue/i })
    const control = (await close.count()) > 0 ? close.first() : (await proceed.count()) > 0 ? proceed.first() : undefined
    if (control === undefined) {
      const title = await dialog.getAttribute('aria-label')
      throw new Error(`host dialog "${title ?? 'unknown'}" has no close control; the suite cannot reach the shell`)
    }
    await control.click()
    await page.waitForTimeout(400)
  }
  throw new Error('the host kept a prompt dialog open after five close attempts')
}

/**
 * Reach the market: open Settings from the account menu, then the Agent
 * Plugins section, and wait for the workspace to mount.
 */
async function openMarket(page: Page): Promise<void> {
  await page.goto(readHostTarget().url)
  await page.waitForLoadState('load')
  // The shell paints before the boot-time prompt appears, so the dismissal
  // waits for two quiet reads rather than treating the first empty one as done.
  await dismissHostPrompts(page)
  await expect(page.getByRole('button', { name: 'Account menu' })).toBeVisible()
  await page.getByRole('button', { name: 'Account menu' }).click()
  await page.getByRole('menuitem', { name: 'Settings' }).click()
  await page.getByRole('dialog', { name: 'Settings' }).waitFor()
  await page.getByRole('button', { name: 'Agent Plugins' }).click()
  await page.locator('[data-agent-plugins-workspace]').waitFor()
}

/**
 * The suite's one local source is seeded by `e2e/host.mjs`; nothing is
 * installed. Each spec opens the same surface and asserts one behaviour.
 */
export const test = base.extend<{ market: Market }>({
  market: async ({ page }, use) => {
    await openMarket(page)
    const workspace = page.locator('[data-agent-plugins-workspace]')
    await use({ page, workspace, cards: workspace.locator('[data-resource-surface="market"]') })
  }
})

export { expect }
