// Focused browser regression for links inside the editable document surface.
// Usage: BASE_URL=http://localhost:3000 node script/link_check.mjs
import { chromium } from 'playwright'

const BASE = process.env.BASE_URL ?? 'http://localhost:3000'
const expectedUrl = 'https://example.com/pruf-link-check'

const browser = await chromium.launch()
const context = await browser.newContext()

try {
  const created = await (
    await fetch(`${BASE}/api/docs`, {
      method: 'POST',
      headers: { 'X-Agent-Name': 'link-check', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Link click check',
        markdown: `# Link click check\n\n[Open this link](${expectedUrl})\n`,
      }),
    })
  ).json()

  const page = await context.newPage()
  await page.goto(`${BASE}/d/${created.slug}`)
  await page.waitForSelector('.doc-status--live', { timeout: 15000 })

  const popupPromise = context.waitForEvent('page', { timeout: 5000 })
  await page.locator('.milkdown .ProseMirror a', { hasText: 'Open this link' }).click()
  const popup = await popupPromise
  await popup.waitForLoadState('domcontentloaded')

  if (!popup.url().startsWith(expectedUrl)) {
    throw new Error(`link opened ${popup.url()} instead of ${expectedUrl}`)
  }

  console.log('✓ clicking an editor link opens it in a new tab')
} finally {
  await browser.close()
}
