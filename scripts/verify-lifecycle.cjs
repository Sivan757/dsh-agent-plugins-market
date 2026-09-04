/**
 * Lifecycle evidence script: enable → verify MCP process → disable → verify stopped.
 * Runs against the live dsh web at http://127.0.0.1:3080.
 * Must be run from the dsh-web-ui directory (for playwright dependency).
 */
const { chromium } = require('playwright')
const { execSync } = require('node:child_process')
const fs = require('node:fs')

const BASE = 'http://127.0.0.1:3080'
const SHOTS = '/Users/sivan/workspace/dsh-agent-plugins-market/docs/promotion/evidence'
const DSH_PID = 17733

function snapshotMcp(label) {
  // Find child processes of dsh web that look like MCP clients
  const children = execSync(`pgrep -P ${DSH_PID} 2>/dev/null || true`, { encoding: 'utf-8' }).trim().split('\n').filter(Boolean)
  const mcpChildren = []
  for (const pid of children) {
    const cmd = execSync(`ps -p ${pid} -o command= 2>/dev/null || true`, { encoding: 'utf-8' }).trim()
    if (cmd && (cmd.includes('mcp') || cmd.includes('dsh-mcp') || cmd.includes('stdio'))) {
      mcpChildren.push({ pid, cmd: cmd.slice(0, 120) })
    }
  }
  // Also check for any jetbrains-related processes spawned recently
  const jbProcs = execSync("ps aux | grep -i 'jetbrains.*mcp\\|mcp.*jetbrains\\|dsh-mcp' | grep -v grep || true", { encoding: 'utf-8' }).trim().split('\n').filter(Boolean)
  console.log(`\n[${label}]`)
  console.log(`  dsh web children: ${children.length}, MCP-like: ${mcpChildren.length}`)
  mcpChildren.forEach(p => console.log(`    PID ${p.pid}: ${p.cmd}`))
  if (jbProcs.length > 0) console.log(`  jetbrains/mcp processes: ${jbProcs.length}`)
  return { children: children.length, mcpChildren, jbProcs: jbProcs.length }
}

async function main() {
  fs.mkdirSync(SHOTS, { recursive: true })
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })

  // Navigate to settings → Agent Plugins Market
  await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(2500)
  await page.getByText('设置', { exact: true }).first().click()
  await page.waitForTimeout(1500)
  await page.getByText('Agent Plugins 市场', { exact: true }).first().click()
  await page.waitForTimeout(3000)

  // Find the jetbrains card
  const cards = await page.locator('article')
  const count = await cards.count()
  console.log(`Total cards: ${count}`)

  let jbCard = null
  for (let i = 0; i < count; i++) {
    const text = await cards.nth(i).textContent()
    if (text && text.includes('jetbrains')) {
      jbCard = cards.nth(i)
      console.log(`Found jetbrains card at index ${i}`)
      break
    }
  }
  if (!jbCard) {
    console.error('jetbrains card not found')
    await browser.close()
    return
  }

  // Screenshot the jetbrains card (currently disabled)
  await jbCard.screenshot({ path: `${SHOTS}/lifecycle-01-disabled.png` })
  const beforeEnable = snapshotMcp('STEP 1: jetbrains DISABLED (baseline)')

  // Find and click the enable toggle on the jetbrains card
  const toggle = jbCard.locator('button[role=switch], input[type=checkbox], [role=switch]').first()
  const toggleExists = await toggle.count()
  if (toggleExists === 0) {
    console.log('No toggle found — trying button with 启用/enable title')
    const enableBtn = jbCard.getByTitle(/启用|enable/i).first()
    if (await enableBtn.count()) {
      await enableBtn.click()
    }
  } else {
    await toggle.click()
  }
  await page.waitForTimeout(3000) // give reconciler time to mount MCP

  await jbCard.screenshot({ path: `${SHOTS}/lifecycle-02-enabled.png` })
  const afterEnable = snapshotMcp('STEP 2: jetbrains ENABLED → MCP should be mounted')

  // Now disable it
  const toggle2 = jbCard.locator('button[role=switch], input[type=checkbox], [role=switch]').first()
  if (await toggle2.count()) {
    await toggle2.click()
  } else {
    const disableBtn = jbCard.getByTitle(/禁用|disable/i).first()
    if (await disableBtn.count()) {
      await disableBtn.click()
    }
  }
  await page.waitForTimeout(3000) // give reconciler time to unmount MCP

  await jbCard.screenshot({ path: `${SHOTS}/lifecycle-03-disabled-again.png` })
  const afterDisable = snapshotMcp('STEP 3: jetbrains DISABLED → MCP should be stopped')

  // Full market screenshot
  await page.screenshot({ path: `${SHOTS}/lifecycle-04-market-final.png` })

  // Summary
  console.log('\n=== SUMMARY ===')
  console.log(
    JSON.stringify(
      {
        baseline: beforeEnable,
        afterEnable: afterEnable,
        afterDisable: afterDisable
      },
      null,
      2
    )
  )

  await browser.close()
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
