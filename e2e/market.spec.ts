import { expect, test } from './support/market.js'

/**
 * Seed: `e2e/host.mjs` writes one local source pointing at
 * `e2e/fixtures/local-source`, which holds exactly one suite. The specs read
 * that scan through the UI only.
 */
async function refresh(market: import('./support/market.js').Market) {
  await market.workspace.getByRole('button', { name: 'Refresh all' }).click()
  await expect(market.cards.first()).toBeVisible()
  // The overview lands first and its description translations land in a second
  // render. Acting while that render is in flight can drop a keystroke or a
  // click into the replaced node, so the suite waits for the panel to settle.
  await market.page.waitForTimeout(1500)
}

test('refresh lists the seeded suite under its source', async ({ market }) => {
  await refresh(market)
  await expect(market.cards).toHaveCount(1)
  await expect(market.cards.first()).toContainText('demo-suite')
  await expect(market.cards.first()).toContainText('v0.1.0')
  await expect(market.workspace.getByRole('button', { name: /^e2e-fixture 1/ })).toBeVisible()
  await expect(market.workspace.getByRole('tab', { name: 'All 1' })).toBeVisible()
  await expect(market.workspace.getByRole('tab', { name: 'enabled 0' })).toBeVisible()
  // The status filter only counts installed suites; an uninstalled one is not "disabled".
  await expect(market.workspace.getByRole('tab', { name: 'disabled 0' })).toBeVisible()
})

test('search narrows the list and says when nothing matches', async ({ market }) => {
  await refresh(market)
  const search = market.workspace.getByPlaceholder('Search suites…')
  await search.fill('demo')
  await expect(search).toHaveValue('demo')
  await expect(market.cards).toHaveCount(1)
  await search.fill('second')
  await expect(search).toHaveValue('second')
  await expect(market.cards).toHaveCount(0)
  await expect(market.workspace.getByText('Nothing matches. 1 in all; clear the search or pick another filter.')).toBeVisible()
  await search.fill('')
  await expect(search).toHaveValue('')
  await expect(market.cards).toHaveCount(1)
})

test('the installed filter hides uninstalled suites', async ({ market }) => {
  await refresh(market)
  await market.workspace.getByRole('tab', { name: 'enabled 0' }).click()
  await expect(market.cards).toHaveCount(0)
  await market.workspace.getByRole('tab', { name: 'All 1' }).click()
  await expect(market.cards).toHaveCount(1)
})

test('the view switch trades the grid for a list and back', async ({ market }) => {
  await refresh(market)
  const collection = market.workspace.locator('[data-resource-view]').first()
  await expect(collection).toHaveAttribute('data-resource-view', 'grid')
  await market.workspace.getByRole('button', { name: 'Switch to list' }).click()
  await expect(collection).toHaveAttribute('data-resource-view', 'list')
  await expect(market.workspace.getByRole('button', { name: 'Switch to grid' })).toBeVisible()
  await market.workspace.getByRole('button', { name: 'Switch to grid' }).click()
  await expect(collection).toHaveAttribute('data-resource-view', 'grid')
})

test('a card opens the suite detail, which closes again', async ({ market }) => {
  await refresh(market)
  await market.cards.first().locator('[data-card-open]').click()
  const detail = market.page.getByRole('dialog', { name: 'demo-suite' })
  await expect(detail).toBeVisible()
  await expect(detail).toContainText('Skills (1)')
  await expect(detail).toContainText('demo-skill')
  await detail.getByRole('button', { name: 'Cancel' }).click()
  await expect(detail).toBeHidden()
})
