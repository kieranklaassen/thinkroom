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
        content:
          `# Link click check\n\n[Open this link](${expectedUrl})\n\n` +
          '- [ ] Complete this task\n',
      }),
    })
  ).json()

  const page = await context.newPage()
  await page.goto(`${BASE}/d/${created.slug}`)
  await page.waitForSelector('.doc-status--live', { timeout: 15000 })
  await page.locator('.milkdown .prov--ai').first().waitFor({ timeout: 5000 })

  await page.locator('.mode-control-trigger').click()
  await page.getByRole('option', { name: /^Read / }).click()

  const editor = page.locator('.milkdown .ProseMirror')
  if ((await editor.getAttribute('contenteditable')) !== 'false') {
    throw new Error('Read mode left document text editable')
  }
  if ((await page.locator('.prov-summary').count()) !== 0) {
    throw new Error('Read mode left the provenance summary visible')
  }
  if ((await page.locator('.margin-gutter, .doc-rail').count()) !== 0) {
    throw new Error('Read mode left review rails visible')
  }
  await page.waitForFunction(() => {
    const provenance = document.querySelector('.milkdown .prov--ai')
    return provenance && getComputedStyle(provenance).backgroundColor === 'rgba(0, 0, 0, 0)'
  })
  const provenanceStyle = await page.locator('.milkdown .prov--ai').first().evaluate((element) => {
    const style = getComputedStyle(element)
    return { backgroundColor: style.backgroundColor, boxShadow: style.boxShadow }
  })
  if (
    provenanceStyle.backgroundColor !== 'rgba(0, 0, 0, 0)' ||
    provenanceStyle.boxShadow !== 'none'
  ) {
    throw new Error(`Read mode left provenance decoration visible: ${JSON.stringify(provenanceStyle)}`)
  }

  const task = page.locator('.milkdown .task-checkbox').first()
  if (await task.isDisabled()) throw new Error('Read mode disabled task checkboxes')

  const beforeTyping = await editor.innerText()
  await page.locator('.milkdown .ProseMirror h1').click()
  await page.keyboard.type('should not be inserted')
  if ((await editor.innerText()) !== beforeTyping) {
    throw new Error('Read mode allowed document text to change')
  }

  const popupPromise = context.waitForEvent('page', { timeout: 5000 })
  await page.locator('.milkdown .ProseMirror a', { hasText: 'Open this link' }).click()
  const popup = await popupPromise
  await popup.waitForLoadState('domcontentloaded')

  if (!popup.url().startsWith(expectedUrl)) {
    throw new Error(`link opened ${popup.url()} instead of ${expectedUrl}`)
  }

  await task.check()
  await page.waitForFunction(
    async (slug) => {
      const state = await (await fetch(`/api/docs/${slug}`)).json()
      return /^- \[x\] Complete this task/m.test(state.markdown ?? '')
    },
    created.slug,
    { timeout: 10000 },
  )
  await page.reload()
  await page.waitForSelector('.doc-status--live', { timeout: 15000 })
  const restoredTask = page.locator('.milkdown .task-checkbox').first()
  if (!(await restoredTask.isChecked())) {
    throw new Error('Read-mode task change did not survive reload')
  }
  if (await restoredTask.isDisabled()) {
    throw new Error('Read mode did not remain active after reload')
  }
  if (!(await page.locator('.mode-control-trigger').innerText()).startsWith('Read')) {
    throw new Error('Read mode selection did not persist for the document')
  }

  console.log('✓ Read mode keeps text clean and read-only while links and tasks work')
} finally {
  await browser.close()
}
