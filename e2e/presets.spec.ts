import { expect, test } from './support/market.js'

/**
 * The composer's Agent preset entry and the suggestion dialog it opens.
 *
 * The suggestion itself needs a model, so the one request the dialog sends is
 * answered with a fixed suggestion: the rows, their card anatomy, and the tick
 * that decides what gets created are what this spec pins. The suite installs
 * its own copy and removes it again, so the market's state is unchanged.
 */
test('the composer preset entry suggests a preset from the installed suite', async ({ market }) => {
  const page = market.page

  await test.step('install the seeded suite', async () => {
    await market.workspace.getByRole('button', { name: 'Refresh all' }).click()
    await expect(market.cards.first()).toBeVisible()
    await page.waitForTimeout(1000)
    await market.cards.filter({ hasText: 'demo-suite' }).getByRole('button', { name: 'Install', exact: true }).click()
    await page.getByRole('dialog', { name: 'Confirm install' }).getByRole('button', { name: 'Install', exact: true }).click()
    await page.waitForTimeout(1200)
    await page.getByRole('button', { name: 'Close', exact: true }).first().click()
    await page.waitForTimeout(500)
  })

  await test.step('the composer carries the preset entry', async () => {
    await page.locator("button[aria-label='New session']").last().click()
    await page.waitForTimeout(1500)
    const entry = page.locator("[data-slot='conversation.input.left'] button[aria-haspopup='menu']").first()
    await expect(entry).toBeVisible()
    await expect(entry).toHaveAttribute('aria-label', 'Default')
    await entry.click()
    await expect(page.getByRole('menuitem', { name: 'Manage presets' })).toBeVisible()
    await page.getByRole('menuitem', { name: 'Manage presets' }).click()
  })

  await test.step('the suggestion renders one card per chosen row', async () => {
    const manager = page.getByRole('dialog', { name: 'Manage extension presets' })
    await expect(manager).toBeVisible()
    const ids = await manager.locator('[data-resource-id]').evaluateAll(list => list.map(card => card.getAttribute('data-resource-id')))
    expect(ids.length).toBeGreaterThan(0)
    await page.route('**/api/agent-plugins/ai-preset', route =>
      route.fulfill({
        json: {
          ok: true,
          name: 'Deck',
          enabledIds: ids.slice(0, 1),
          reason: 'Covers content and export.',
          usage: { inputTokens: 10, outputTokens: 5 }
        }
      })
    )
    await manager.getByRole('button', { name: 'Suggest a preset' }).click()
    const modal = page.getByRole('dialog', { name: 'Suggest a preset' })
    await expect(modal).toBeVisible()
    await modal.getByLabel('Purpose').fill('ppt')
    await modal.getByRole('button', { name: 'Suggest', exact: true }).click()

    const rows = modal.locator('[data-resource-id]')
    await expect(rows).toHaveCount(1)
    await expect(rows.first()).toContainText('demo-suite')
    await expect(rows.first()).toHaveAttribute('data-resource-state', 'active')
    // The chosen row keeps the shared card height; a field-width input must not
    // stretch the tick across the row and squeeze the name to zero width.
    const box = await rows.first().boundingBox()
    expect(box?.height ?? 0).toBeLessThan(90)
    await rows.first().locator("input[type='checkbox']").click()
    await expect(rows.first()).toHaveAttribute('data-resource-state', 'absent')
    await rows.first().locator("input[type='checkbox']").click()
    await expect(rows.first()).toHaveAttribute('data-resource-state', 'active')
    await expect(modal.getByRole('button', { name: 'Create this preset' })).toBeEnabled()
    // The dialog header's close control and the footer's Cancel share one label;
    // the footer action is the one this spec presses.
    await modal.getByRole('button', { name: 'Cancel' }).last().click()
    await page.keyboard.press('Escape')
    await page.waitForTimeout(500)
  })

  await test.step('uninstall the suite again', async () => {
    await page.getByRole('button', { name: 'Account menu' }).click()
    await page.getByRole('menuitem', { name: 'Settings' }).click()
    await page.getByRole('button', { name: 'Agent Plugins' }).click()
    await expect(market.workspace).toBeVisible()
    await market.cards.filter({ hasText: 'demo-suite' }).locator('[data-card-open]').click()
    const detail = page.getByRole('dialog', { name: 'demo-suite' })
    await detail.getByRole('button', { name: 'Uninstall', exact: true }).click()
    const risk = page.getByRole('dialog', { name: 'Uninstall suite' })
    await risk.getByRole('checkbox').check()
    await risk.getByRole('button', { name: 'Delete', exact: true }).click()
    await expect(risk).toBeHidden()
    await expect(market.cards.filter({ hasText: 'demo-suite' })).toHaveAttribute('data-resource-state', 'absent')
  })
})
