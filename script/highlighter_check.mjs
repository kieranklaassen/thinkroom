// Focused text-highlighter regression check using Playwright.
// Covers the markdown round-trip (including highlighter spans nested inside
// provenance spans — the shape every typed-then-highlighted run serializes
// to), the selection-toolbar swatches, the rail legend with persisted names,
// and strip-on-copy.
// Usage: BASE_URL=http://localhost:3000 node script/highlighter_check.mjs
import { chromium } from 'playwright'
import { expectedBrowserNoise, waitForLive } from './lib/check_helpers.mjs'

const BASE = process.env.BASE_URL ?? 'http://localhost:3000'
const AGENT_HEADERS = {
  'X-Agent-Name': 'Highlighter Check',
  'Content-Type': 'application/json',
}

const assert = (condition, message, detail = '') => {
  if (!condition) throw new Error(`${message}${detail ? `: ${detail}` : ''}`)
  console.log(`✓ ${message}`)
}

const content = [
  '# Highlighter check',
  '',
  'Plain <span data-highlighter data-color="blue">blue run</span> here.',
  '',
  'Nested <span data-provenance data-kind="human" data-author="Checker" data-state="verbatim">' +
    '<span data-highlighter data-color="yellow">attributed highlight</span></span> case.',
  '',
  'A quiet paragraph to highlight by hand.',
  '',
].join('\n')

const browser = await chromium.launch()
const context = await browser.newContext()
await context.addCookies([
  {
    name: 'pruf_guest',
    value: encodeURIComponent(JSON.stringify({ name: 'Highlighter Checker', color: '#5f7470' })),
    url: BASE,
  },
])
const page = await context.newPage()
const errors = []
page.on('pageerror', (error) => {
  const message = error.stack ?? String(error)
  if (!expectedBrowserNoise(message)) errors.push(message)
})
page.on('console', (message) => {
  if (message.type() === 'error' && !expectedBrowserNoise(message.text())) errors.push(message.text())
})

try {
  const response = await fetch(`${BASE}/api/docs`, {
    method: 'POST',
    headers: AGENT_HEADERS,
    body: JSON.stringify({ title: 'Highlighter check', format: 'markdown', content }),
  })
  assert(response.status === 201, 'created a document with highlighter spans')
  const created = await response.json()

  await page.goto(`${BASE}/d/${created.slug}/edit`)
  await waitForLive(page)
  const editor = page.locator('.doc-live-editor .ProseMirror')
  await editor.locator('.hl--blue').waitFor({ timeout: 15000 })

  assert(
    (await editor.locator('.hl--blue').textContent()) === 'blue run',
    'plain highlighter span round-trips into a mark',
  )
  assert(
    (await editor.locator('.hl--yellow').textContent()) === 'attributed highlight',
    'highlighter nested in a provenance span round-trips into a mark',
  )
  assert(
    (await editor.locator('[data-provenance] .hl--yellow, .prov .hl--yellow').count()) === 1 ||
      (await editor.locator('.hl--yellow[data-highlighter]').count()) === 1,
    'nested run keeps both marks',
  )
  const editorText = await editor.textContent()
  assert(
    !editorText.includes('<span') && !editorText.includes('</span>'),
    'no literal span markup leaks into the document',
    editorText.slice(0, 300),
  )

  const legend = page.locator('.rail-section[aria-label="Highlights"]')
  await legend.waitFor({ timeout: 15000 })
  assert(
    (await legend.locator('.highlight-legend-color').count()) === 2,
    'legend lists both used colors',
  )
  assert(
    (await legend.locator('.highlight-legend-snippet').allTextContents()).join('|') ===
      'attributed highlight|blue run',
    'legend groups snippets under their colors in palette order',
  )

  // Highlight by hand. Synthetic triple-clicks are flaky under automation
  // (the third click can land as a word selection), so select the line via
  // the keyboard for a deterministic range.
  const selectQuietParagraph = async () => {
    await editor.getByText('A quiet paragraph').click()
    await page.keyboard.press('Home')
    await page.keyboard.press('Shift+End')
  }
  await selectQuietParagraph()
  const toolbar = page.locator('.selection-toolbar')
  await toolbar.waitFor({ timeout: 10000 })
  assert(
    (await toolbar.locator('.selection-swatch').count()) === 10,
    'selection toolbar offers the ten palette swatches',
  )
  await toolbar.getByRole('button', { name: 'Green' }).click()
  await editor.locator('.hl--green').waitFor({ timeout: 10000 })
  await page.waitForFunction(
    () =>
      document.querySelectorAll(
        '.rail-section[aria-label="Highlights"] .highlight-legend-color',
      ).length === 3,
    undefined,
    { timeout: 10000 },
  )
  assert(true, 'applying a swatch adds the color to the legend')

  // Re-selecting the highlighted run marks the swatch active; clicking it
  // again removes the highlight and its legend entry.
  await selectQuietParagraph()
  const activeSwatch = toolbar.locator('.selection-swatch.is-active')
  await activeSwatch.waitFor({ timeout: 10000 })
  assert(
    (await activeSwatch.getAttribute('aria-label')) === 'Remove Green highlight',
    'the active swatch offers removal',
  )
  await activeSwatch.click()
  await page.waitForFunction(
    () => document.querySelectorAll('.doc-live-editor .hl--green').length === 0,
    undefined,
    { timeout: 10000 },
  )
  await page.waitForFunction(
    () =>
      document.querySelectorAll(
        '.rail-section[aria-label="Highlights"] .highlight-legend-color',
      ).length === 2,
    undefined,
    { timeout: 10000 },
  )
  assert(true, 'reclicking the active swatch removes highlight and legend entry')

  // Legend rename persists server-side and survives a reload.
  const yellowName = legend.locator('.highlight-legend-name').first()
  await yellowName.fill('Urgent')
  await yellowName.press('Enter')
  await page.waitForTimeout(500)
  await page.reload()
  await waitForLive(page)
  await legend.waitFor({ timeout: 15000 })
  assert(
    (await legend.locator('.highlight-legend-name').first().inputValue()) === 'Urgent',
    'legend color names persist across reloads',
  )

  // Copy is an export surface: both clipboard flavors drop highlighter
  // metadata while the text itself survives.
  await page.locator('.milkdown .ProseMirror').focus()
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A')
  const copied = await editor.evaluate((node) => {
    const clipboardData = new DataTransfer()
    node.dispatchEvent(new ClipboardEvent('copy', { clipboardData, bubbles: true, cancelable: true }))
    return {
      html: clipboardData.getData('text/html'),
      text: clipboardData.getData('text/plain'),
    }
  })
  for (const [flavor, value] of Object.entries(copied)) {
    assert(
      value.includes('blue run') && !value.includes('data-highlighter'),
      `copied ${flavor} keeps text but strips highlighter metadata`,
      value.slice(0, 300),
    )
  }

  assert(errors.length === 0, 'highlighter flow completed without browser errors', errors.join('\n'))
} finally {
  await browser.close()
}
