import { chromium } from 'playwright'
import { waitForLive } from './script/lib/check_helpers.mjs'

const BASE = 'http://localhost:3000'
const response = await fetch(`${BASE}/api/docs`, {
  method: 'POST',
  headers: { 'X-Agent-Name': 'Probe', 'Content-Type': 'application/json' },
  body: JSON.stringify({
    title: 'Probe two',
    format: 'markdown',
    content: '# Probe\n\nA quiet paragraph to highlight by hand.\n',
  }),
})
const created = await response.json()
const browser = await chromium.launch()
const page = await browser.newPage()
await page.goto(`${BASE}/d/${created.slug}/edit`)
await waitForLive(page)
const editor = page.locator('.doc-live-editor .ProseMirror')
const select = async () => {
  await editor.getByText('A quiet paragraph').click()
  await page.keyboard.press('Home')
  await page.keyboard.press('Shift+End')
  const sel = await page.evaluate(() => window.getSelection()?.toString())
  console.log('selection:', JSON.stringify(sel))
}
await select()
const toolbar = page.locator('.selection-toolbar')
await toolbar.waitFor()
await toolbar.getByRole('button', { name: 'Green' }).click()
await editor.locator('.hl--green').first().waitFor()
console.log('green runs after apply:', await editor.locator('.hl--green').count())
console.log('para html:', (await editor.evaluate((n) => n.querySelectorAll('p')[0].outerHTML)).slice(0, 300))

await select()
const active = toolbar.locator('.selection-swatch.is-active')
await active.waitFor({ timeout: 5000 }).catch(() => console.log('no active swatch!'))
if (await active.count()) {
  await active.click()
  await page.waitForTimeout(1000)
  console.log('green runs after remove:', await editor.locator('.hl--green').count())
}
await browser.close()
