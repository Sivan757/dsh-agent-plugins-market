import { fileURLToPath } from 'node:url'
import { expect, test } from './support/market.js'

/** The second fixture source: added and removed through the editor dialog. */
const SECOND_SOURCE = fileURLToPath(new URL('./fixtures/second-source', import.meta.url))

test('the source editor adds a local source, lists its suite, then removes it', async ({ market }) => {
  await test.step('scan the seeded source', async () => {
    await market.workspace.getByRole('button', { name: 'Refresh all' }).click()
    await expect(market.cards.first()).toBeVisible()
  })
  await test.step('add the second source through the editor', async () => {
    await market.workspace.getByRole('button', { name: 'Add source' }).click()
    const editor = market.page.getByRole('dialog', { name: 'Add source' })
    await expect(editor).toBeVisible()
    await editor.getByRole('button', { name: 'Local path' }).click()
    await editor.getByLabel('local repository path (absolute or ~/…)').fill(SECOND_SOURCE)
    await editor.getByRole('button', { name: 'Add', exact: true }).click()
    await expect(editor).toBeHidden()
  })
  const added = market.workspace.getByRole('button', { name: /^second-source/ })
  await test.step('the added source is scanned and listed', async () => {
    await expect(added).toBeVisible()
    await expect(market.workspace.getByRole('button', { name: /^e2e-fixture/ })).toBeVisible()
    await expect(market.cards.filter({ hasText: 'second-suite' })).toHaveCount(1)
  })
  await test.step('the chip delete control removes the source', async () => {
    // The chip's controls fade in on hover; hovering the chip is part of the
    // gesture a reader performs, and the pointer must land on the revealed
    // control rather than the strip underneath.
    await added.hover()
    await added.locator('xpath=..').getByRole('button', { name: '×' }).click()
    const confirm = market.page.getByRole('dialog', { name: /^Remove source/ })
    await expect(confirm).toBeVisible()
    await confirm.getByRole('button', { name: 'Delete' }).click()
    await expect(confirm).toBeHidden()
    await expect(added).toBeHidden()
    await expect(market.cards.filter({ hasText: 'second-suite' })).toHaveCount(0)
  })
})

test('the source editor closes on Cancel without registering a source', async ({ market }) => {
  const chips = market.workspace.getByRole('button', { name: /^e2e-fixture/ })
  const before = await chips.count()
  await market.workspace.getByRole('button', { name: 'Add source' }).click()
  const editor = market.page.getByRole('dialog', { name: 'Add source' })
  await expect(editor).toBeVisible()
  // The dialog header's close control and the footer's Cancel share one label;
  // the footer action is the one this test presses.
  await editor.getByRole('button', { name: 'Cancel' }).last().click()
  await expect(editor).toBeHidden()
  await expect(chips).toHaveCount(before)
})
