import { expect, test } from './support/market.js'

/**
 * One suite's round trip through the UI: install from the card, see its skill
 * on the Skills tab, then uninstall from its detail dialog. The seeded fixture
 * source makes the round trip repeatable; the test leaves no installed state
 * behind for the next spec.
 */
test('installs the seeded suite, lists its skill, then uninstalls it', async ({ market }) => {
  await market.workspace.getByRole('button', { name: 'Refresh all' }).click()
  await expect(market.cards.first()).toBeVisible()
  await market.page.waitForTimeout(1000)
  const card = market.cards.filter({ hasText: 'demo-suite' })
  await expect(card).toHaveCount(1)

  await test.step('install from the card after confirming the surfaces', async () => {
    await card.getByRole('button', { name: 'Install', exact: true }).click()
    const confirm = market.page.getByRole('dialog', { name: 'Confirm install' })
    await expect(confirm).toBeVisible()
    await confirm.getByRole('button', { name: 'Install', exact: true }).click()
    await expect(confirm).toBeHidden()
    await expect(card).toHaveAttribute('data-resource-state', 'active')
  })

  await test.step('the Skills tab lists the installed skill', async () => {
    await market.workspace.getByRole('tab', { name: 'Skills', exact: true }).click()
    const panel = market.workspace.getByRole('tabpanel', { name: 'Skills' })
    await expect(panel).toContainText('demo-skill')
  })

  await test.step('uninstall from the detail dialog after acknowledging the risk', async () => {
    await market.workspace.getByRole('tab', { name: 'Market', exact: true }).click()
    await card.locator('[data-card-open]').click()
    const detail = market.page.getByRole('dialog', { name: 'demo-suite' })
    await expect(detail).toBeVisible()
    await detail.getByRole('button', { name: 'Uninstall', exact: true }).click()
    const risk = market.page.getByRole('dialog', { name: 'Uninstall suite' })
    await expect(risk).toBeVisible()
    await risk.getByRole('checkbox').check()
    await risk.getByRole('button', { name: 'Delete', exact: true }).click()
    await expect(risk).toBeHidden()
    await expect(card).toHaveAttribute('data-resource-state', 'absent')
  })
})
