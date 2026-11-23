import { expect, test } from './support/market.js'

/** The workspace row, in the contract's display order. */
const WORKSPACE_TABS = ['Market', 'Skills', 'Experts', 'Shortcuts', 'Connectors', 'Language Engine', 'System prompt', 'Output styles', 'Hooks']

test('opens the Agent Plugins section with the whole workspace row', async ({ market }) => {
  await expect(market.workspace).toBeVisible()
  for (const name of WORKSPACE_TABS) await expect(market.workspace.getByRole('tab', { name, exact: true })).toBeVisible()
  await expect(market.workspace.getByRole('tabpanel', { name: 'Market' })).toBeVisible()
  await expect(market.workspace.getByRole('button', { name: 'Add source' })).toBeVisible()
  await expect(market.workspace.getByRole('button', { name: 'Refresh all' })).toBeVisible()
})

test('switches tabs in place without leaving the workspace', async ({ market }) => {
  await market.workspace.getByRole('tab', { name: 'Skills', exact: true }).click()
  await expect(market.workspace.getByRole('tabpanel', { name: 'Skills' })).toBeVisible()
  await expect(market.workspace).toBeVisible()
  await market.workspace.getByRole('tab', { name: 'Hooks', exact: true }).click()
  await expect(market.workspace.getByRole('tabpanel', { name: 'Hooks' })).toBeVisible()
  await market.workspace.getByRole('tab', { name: 'Market', exact: true }).click()
  await expect(market.workspace.getByRole('tabpanel', { name: 'Market' })).toBeVisible()
})

test('a hash deep link selects the tab it names and is spent', async ({ market }) => {
  await market.page.evaluate(() => {
    window.location.hash = '#/agent-plugins/outputStyles'
  })
  await expect(market.workspace.getByRole('tabpanel', { name: 'Output styles' })).toBeVisible()
  await expect.poll(async () => market.page.evaluate(() => window.location.hash)).toBe('')
})
