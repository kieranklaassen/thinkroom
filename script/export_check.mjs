// Focused document/sketch export regression check using Playwright.
// Usage: BASE_URL=http://localhost:3000 node script/export_check.mjs
import { chromium } from 'playwright'

const BASE = process.env.BASE_URL ?? 'http://localhost:3000'
const AGENT_HEADERS = {
  'X-Agent-Name': 'Export Check',
  'Content-Type': 'application/json',
}

const assert = (condition, message, detail = '') => {
  if (!condition) throw new Error(`${message}${detail ? `: ${detail}` : ''}`)
  console.log(`✓ ${message}`)
}

const downloadText = async (download) => {
  const stream = await download.createReadStream()
  const chunks = []
  for await (const chunk of stream) chunks.push(chunk)
  return Buffer.concat(chunks).toString('utf8')
}

const sketchElement = {
  id: 'export-text',
  type: 'text',
  x: 48,
  y: 42,
  width: 126,
  height: 25,
  angle: 0,
  strokeColor: '#1e1e1e',
  backgroundColor: 'transparent',
  fillStyle: 'solid',
  strokeWidth: 1,
  strokeStyle: 'solid',
  roughness: 1,
  opacity: 100,
  groupIds: [],
  frameId: null,
  index: 'a0',
  roundness: null,
  seed: 1,
  version: 1,
  versionNonce: 1,
  isDeleted: false,
  boundElements: null,
  updated: 1,
  link: null,
  locked: false,
  text: 'Export me',
  fontSize: 20,
  fontFamily: 1,
  textAlign: 'left',
  verticalAlign: 'top',
  containerId: null,
  originalText: 'Export me',
  autoResize: true,
  lineHeight: 1.25,
}

const sketch = {
  id: 'export_flow',
  formatVersion: 1,
  description: 'Export flow',
  height: 260,
  scene: {
    type: 'excalidraw',
    version: 2,
    elements: [sketchElement],
    appState: { viewBackgroundColor: '#fffef9' },
    files: {},
  },
}

const browser = await chromium.launch()
const context = await browser.newContext({ acceptDownloads: true })
await context.addCookies([
  {
    name: 'pruf_guest',
    value: encodeURIComponent(JSON.stringify({ name: 'Export Reader', color: '#5f7470' })),
    url: BASE,
  },
])
const page = await context.newPage()
const errors = []
page.on('pageerror', (error) => errors.push(error.stack ?? String(error)))
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(message.text())
})

try {
  const response = await fetch(`${BASE}/api/docs`, {
    method: 'POST',
    headers: AGENT_HEADERS,
    body: JSON.stringify({
      title: 'Export check',
      format: 'markdown',
      content: `# Export check\n\nBefore export.\n\n\`\`\`excalidraw\n${JSON.stringify(sketch)}\n\`\`\`\n`,
    }),
  })
  assert(response.status === 201, 'created a document with a sketch')
  const created = await response.json()

  await page.goto(`${BASE}/d/${created.slug}`)
  await page.waitForSelector('.doc-status--live', { timeout: 15000 })
  await page.waitForSelector('.thinkroom-sketch', { timeout: 15000 })
  await page.locator('.mode-control-trigger').click()
  await page.getByRole('option', { name: /^Read / }).click()
  assert(
    (await page.locator('.mode-control-trigger').textContent())?.includes('Read'),
    'export controls are exercised from read mode',
  )

  await page.locator('.share-button').click()
  const exportSection = page.locator('.share-section--export')
  await exportSection.waitFor()
  assert((await exportSection.getByRole('button').count()) === 3, 'Share exposes three export actions')

  const markdownEvent = page.waitForEvent('download')
  await exportSection.getByRole('button', { name: 'Markdown' }).click()
  const markdownDownload = await markdownEvent
  const markdown = await downloadText(markdownDownload)
  assert(markdownDownload.suggestedFilename() === 'export-check.md', 'Markdown uses a safe title filename')
  assert(
    markdown.includes('Export check') && markdown.includes('```excalidraw'),
    'Markdown contains current prose and sketch source',
    markdown.slice(0, 500),
  )

  const htmlEvent = page.waitForEvent('download')
  await exportSection.getByRole('button', { name: 'HTML' }).click()
  const htmlDownload = await htmlEvent
  const html = await downloadText(htmlDownload)
  assert(htmlDownload.suggestedFilename() === 'export-check.html', 'HTML uses a safe title filename')
  assert(/^<!doctype html>/i.test(html) && html.includes('Before export.'), 'HTML is a standalone current document')
  assert(html.includes('<svg') && !html.includes('data-scene='), 'HTML embeds sketch SVG without raw scene metadata')

  await page.evaluate(() => {
    window.__exportPrintCalled = false
    window.print = () => { window.__exportPrintCalled = true }
  })
  await exportSection.getByRole('button', { name: 'Print / PDF' }).click()
  assert(await page.evaluate(() => window.__exportPrintCalled), 'Print / PDF invokes browser printing')

  await page.locator('.share-button').click()
  const sketchFigure = page.locator('.thinkroom-sketch')
  await sketchFigure.hover()
  const sketchButton = sketchFigure.getByRole('button', { name: 'Download sketch as SVG' })
  await sketchButton.waitFor()
  const sketchEvent = page.waitForEvent('download')
  await sketchButton.click()
  const sketchDownload = await sketchEvent
  const svg = await downloadText(sketchDownload)
  assert(sketchDownload.suggestedFilename() === 'Export-flow.svg', 'sketch uses its title as the SVG filename')
  assert(svg.includes('<svg') && svg.includes('Export me'), 'downloaded SVG contains the rendered sketch')
  assert((await page.locator('.thinkroom-sketch-editor').count()) === 0, 'sketch download does not enter edit mode')

  await page.emulateMedia({ media: 'print' })
  assert(await page.locator('.doc-header').evaluate((node) => getComputedStyle(node).display === 'none'), 'print hides application header')
  assert(await page.locator('.doc-main').evaluate((node) => getComputedStyle(node).display === 'block'), 'print retains document content')
  assert(
    await page.locator('.sketch-download-button').evaluate((node) => getComputedStyle(node).display === 'none'),
    'print hides sketch export controls',
  )

  assert(errors.length === 0, 'export flow completed without browser errors', errors.join('\n'))
} finally {
  await browser.close()
}
