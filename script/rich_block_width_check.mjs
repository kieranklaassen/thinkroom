// Focused sketch/table breakout regression check using Playwright.
// Usage: BASE_URL=http://localhost:3000 node script/rich_block_width_check.mjs
import { chromium, request } from 'playwright'

const BASE = process.env.BASE_URL ?? 'http://localhost:3000'
const failures = []
const check = (condition, message, detail = '') => {
  if (condition) {
    console.log(`✓ ${message}`)
  } else {
    failures.push(message)
    console.error(`✗ ${message}${detail ? `: ${detail}` : ''}`)
  }
}
const closeTo = (actual, expected, tolerance = 2) => Math.abs(actual - expected) <= tolerance

const sketch = {
  id: 'rich_width_fixture',
  formatVersion: 1,
  description: 'A wide planning sketch',
  height: 280,
  scene: {
    type: 'excalidraw',
    version: 2,
    elements: [],
    appState: { viewBackgroundColor: '#fffef9' },
    files: {},
  },
}
const content = `# Rich block width check

This prose should retain its comfortable reading measure.

\`\`\`excalidraw
${JSON.stringify(sketch)}
\`\`\`

| Workstream | Owner | Status | Detailed next action that should remain readable |
| --- | --- | --- | --- |
| ResearchAndSynthesisWithoutWrapping | Ada | Active | Compare the complete evidence set before review |
| ProductAndEngineeringCoordination | Grace | Pending | Resolve the remaining interface constraints |

\`\`\`text
${`const ${'longUnbrokenIdentifierThatForcesHorizontalScroll'.repeat(6)} = true`}
short line
\`\`\`
`

const api = await request.newContext({
  baseURL: BASE,
  extraHTTPHeaders: { 'X-Agent-Name': 'Rich block width check' },
})
const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
const page = await context.newPage()
const errors = []
let slug

// Dev-server-only console noise, verified not to reproduce on clean loads or
// in production builds (see script/export_check.mjs and the 2026-07-01
// dogfood report): React's recoverable hydration de-opt under automation and
// a StrictMode double-createRoot warning from an editor library.
const expectedBrowserNoise = (message) =>
  message.includes('Hydration failed because the server rendered') ||
  message.includes('already been passed to createRoot()')
page.on('pageerror', (error) => {
  const message = error.stack ?? String(error)
  if (!expectedBrowserNoise(message)) errors.push(message)
})
page.on('console', (message) => {
  if (message.type() === 'error' && !expectedBrowserNoise(message.text())) errors.push(message.text())
})

const liveGeometry = () => page.evaluate(() => {
  const prose = document.querySelector('.doc-live-editor .ProseMirror')
  const sketchBlock = document.querySelector('.thinkroom-sketch')
  const tableBlock = document.querySelector('.milkdown-table-block')
  const tableWrapper = tableBlock?.querySelector('.table-wrapper')
  const codeBlock = document.querySelector('.doc-live-editor .ProseMirror > pre:not([data-language="mermaid"])')
  const codeInner = codeBlock?.querySelector('code')
  const rect = (node) => node?.getBoundingClientRect()
  return {
    prose: rect(prose),
    sketch: rect(sketchBlock),
    table: rect(tableBlock),
    tableWrapper: rect(tableWrapper),
    tableOverflow: tableWrapper ? getComputedStyle(tableWrapper).overflowX : null,
    code: rect(codeBlock),
    codeHandle: !!codeBlock?.querySelector(':scope > .rich-block-width-handle'),
    // A long line stays inside the block (wrap or inner scroll), never spilling
    // past the <pre> edge now that the <pre> itself no longer clips.
    codeContained: codeBlock && codeInner
      ? codeInner.getBoundingClientRect().width <= codeBlock.getBoundingClientRect().width + 2
      : false,
    documentWidth: getComputedStyle(document.querySelector('.doc-page')).getPropertyValue('--document-width').trim(),
    richWidth: getComputedStyle(document.querySelector('.doc-page')).getPropertyValue('--rich-content-width').trim(),
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  }
})

try {
  const created = await api.post('/api/docs', {
    data: { title: 'Rich block width check', format: 'markdown', content },
  })
  check(created.ok(), 'created a temporary sketch-and-table document', String(created.status()))
  slug = (await created.json()).slug

  // Open the live editor first so this browser receives and persists the
  // one-time seed claim. A JavaScript-disabled first visit would claim the
  // seed without ever mounting Milkdown, leaving a second session empty.
  await page.goto(`${BASE}/d/${slug}`)
  await page.locator('.doc-status--live').waitFor({ timeout: 15_000 })
  await page.locator('.thinkroom-sketch .rich-block-width-handle').waitFor({ timeout: 15_000 })
  await page.locator('.milkdown-table-block .rich-block-width-handle').waitFor({ timeout: 15_000 })
  await page.locator('.doc-live-editor .ProseMirror > pre:not([data-language="mermaid"]) .rich-block-width-handle').waitFor({ timeout: 15_000 })

  const staticContext = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    javaScriptEnabled: false,
  })
  await staticContext.addCookies([{ name: 'pruf_rich_width', value: '1088', url: BASE }])
  const staticPage = await staticContext.newPage()
  await staticPage.goto(`${BASE}/d/${slug}`)
  await staticPage.locator('.doc-static-preview .doc-sketch-skeleton').waitFor()
  const staticGeometry = await staticPage.evaluate(() => ({
    prose: document.querySelector('.doc-static-preview .ProseMirror')?.getBoundingClientRect().width ?? 0,
    sketch: document.querySelector('.doc-sketch-skeleton')?.getBoundingClientRect().width ?? 0,
    table: document.querySelector('.doc-static-preview table')?.getBoundingClientRect().width ?? 0,
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  }))
  check(
    closeTo(staticGeometry.sketch, 1088) && closeTo(staticGeometry.table, 1088) && staticGeometry.prose < 700,
    'server preview applies the saved rich width before the editor boots',
    JSON.stringify(staticGeometry),
  )
  check(staticGeometry.overflow === 0, 'server preview has no horizontal page overflow')
  await staticContext.close()

  const initial = await liveGeometry()
  check(
    closeTo(initial.sketch.width, 960) && closeTo(initial.table.width, 960) && initial.prose.width < 700,
    'read mode gives sketches and tables a shared 960px default',
    JSON.stringify(initial),
  )
  check(
    initial.codeHandle && closeTo(initial.code.width, 960) && initial.code.width > initial.prose.width,
    'code blocks join the shared breakout with their own width handle',
    JSON.stringify(initial),
  )
  check(
    initial.codeContained && initial.overflow === 0,
    'a long code line stays contained in the block without page overflow',
    JSON.stringify(initial),
  )
  check(initial.overflow === 0, 'default read layout has no horizontal page overflow')
  check(
    initial.tableOverflow === 'auto' && initial.tableWrapper.width <= initial.table.width,
    'wide tables retain their contained horizontal scroll region',
    JSON.stringify(initial),
  )

  const initialDocumentWidth = initial.documentWidth
  const sketchHandle = page.locator('.thinkroom-sketch .rich-block-width-handle')
  const handleBox = await sketchHandle.boundingBox()
  if (!handleBox) throw new Error('Rich block handle has no geometry')
  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(handleBox.x + handleBox.width / 2 + 32, handleBox.y + handleBox.height / 2)
  await page.mouse.up()
  await page.waitForFunction(() => document.querySelector('.thinkroom-sketch')?.getBoundingClientRect().width > 1000)
  const dragged = await liveGeometry()
  check(
    closeTo(dragged.sketch.width, 1024) && closeTo(dragged.table.width, 1024) && closeTo(dragged.code.width, 1024),
    'dragging one handle resizes every rich block together',
    JSON.stringify(dragged),
  )
  check(
    await page.evaluate(() => document.cookie.includes('pruf_rich_width=1024')),
    'drag completion persists the shared width',
  )
  await sketchHandle.dblclick()
  await page.waitForFunction(() => Math.abs((document.querySelector('.thinkroom-sketch')?.getBoundingClientRect().width ?? 0) - 960) < 2)

  await sketchHandle.focus()
  await page.keyboard.press('ArrowLeft')
  await page.waitForFunction(() => document.querySelector('.thinkroom-sketch')?.getBoundingClientRect().width < 950)
  const keyed = await liveGeometry()
  check(
    closeTo(keyed.sketch.width, 928) && closeTo(keyed.table.width, 928),
    'keyboard resizing updates every rich block together',
    JSON.stringify(keyed),
  )
  check(keyed.documentWidth === initialDocumentWidth, 'rich resizing leaves the prose-width preference unchanged')

  await page.reload()
  await page.locator('.thinkroom-sketch .rich-block-width-handle').waitFor({ timeout: 15_000 })
  const reloaded = await liveGeometry()
  check(closeTo(reloaded.sketch.width, 928), 'saved rich width survives reload on first live paint', JSON.stringify(reloaded))

  await page.locator('.thinkroom-sketch .rich-block-width-handle').dblclick()
  await page.waitForFunction(() => Math.abs((document.querySelector('.thinkroom-sketch')?.getBoundingClientRect().width ?? 0) - 960) < 2)
  check((await liveGeometry()).richWidth === '960px', 'double-click resets the shared width to its responsive default')

  await page.goto(`${BASE}/d/${slug}/edit`)
  await page.locator('.thinkroom-sketch .rich-block-width-handle').waitFor({ timeout: 15_000 })
  const review = await liveGeometry()
  check(
    review.sketch.width > review.prose.width &&
      closeTo(review.sketch.right, review.prose.right) &&
      review.sketch.left >= 23,
    'review layout expands left while keeping the suggestion-gutter edge aligned',
    JSON.stringify(review),
  )
  const reviewHandle = page.locator('.thinkroom-sketch .rich-block-width-handle')
  const handleSide = await reviewHandle.evaluate((node) => ({
    handleLeft: node.getBoundingClientRect().left,
    blockLeft: node.parentElement?.getBoundingClientRect().left ?? 0,
  }))
  check(
    closeTo(handleSide.handleLeft, handleSide.blockLeft - 9),
    'review layout puts the drag handle on the expanding edge',
    JSON.stringify(handleSide),
  )

  await reviewHandle.focus()
  await page.keyboard.press('ArrowRight')
  await page.waitForFunction(
    (before) => (document.querySelector('.thinkroom-sketch')?.getBoundingClientRect().width ?? 0) < before - 20,
    review.sketch.width,
  )
  const reviewKeyed = await liveGeometry()
  check(
    closeTo(reviewKeyed.sketch.width, reviewKeyed.table.width) && closeTo(reviewKeyed.sketch.right, reviewKeyed.prose.right),
    'review-mode keyboard resizing remains shared and gutter-safe',
    JSON.stringify(reviewKeyed),
  )

  await reviewHandle.dblclick()
  await page.evaluate(() => {
    document.cookie = 'pruf_panel=1;path=/;samesite=lax'
    document.cookie = 'pruf_focus=1;path=/;samesite=lax'
  })
  await page.reload()
  await page.locator('.doc-canvas.is-focus .thinkroom-sketch').waitFor({ timeout: 15_000 })
  const focused = await liveGeometry()
  const focusedCenter = focused.sketch.left + focused.sketch.width / 2
  const proseCenter = focused.prose.left + focused.prose.width / 2
  check(
    focused.sketch.width > focused.prose.width &&
      closeTo(focusedCenter, proseCenter) &&
      focused.sketch.left >= 23,
    'focus mode centers the breakout without clipping beside the activity rail',
    JSON.stringify(focused),
  )

  await page.evaluate(() => {
    document.cookie = 'pruf_panel=0;path=/;samesite=lax'
    document.cookie = 'pruf_focus=0;path=/;samesite=lax'
  })
  await page.reload()
  await page.locator('.doc-page.is-panel-hidden .thinkroom-sketch').waitFor({ timeout: 15_000 })
  const panelHidden = await liveGeometry()
  check(
    panelHidden.sketch.width > reviewKeyed.sketch.width &&
      panelHidden.sketch.left >= 23 &&
      closeTo(panelHidden.sketch.right, panelHidden.prose.right),
    'hiding the activity rail releases its space without clipping the breakout',
    JSON.stringify(panelHidden),
  )

  await page.setViewportSize({ width: 390, height: 844 })
  await page.waitForTimeout(100)
  const mobile = await liveGeometry()
  const handleDisplay = await reviewHandle.evaluate((node) => getComputedStyle(node).display)
  check(
    closeTo(mobile.sketch.width, mobile.prose.width) &&
      closeTo(mobile.table.width, mobile.prose.width) &&
      closeTo(mobile.code.width, mobile.prose.width),
    'compact layouts return rich blocks to the prose width',
    JSON.stringify(mobile),
  )
  check(handleDisplay === 'none' && mobile.overflow === 0, 'compact layouts hide handles without page overflow', JSON.stringify(mobile))
  check(errors.length === 0, 'browser run completed without console errors', errors.join(' | '))
} finally {
  if (slug) {
    try {
      await page.setViewportSize({ width: 1440, height: 1000 })
      await page.goto(`${BASE}/d/${slug}`)
      const csrf = await page.locator('meta[name="csrf-token"]').getAttribute('content')
      const headers = { 'X-CSRF-Token': csrf ?? '' }
      const claimed = await context.request.post(`${BASE}/d/${slug}/claim`, {
        form: { name: 'Rich block width check' },
        headers,
        maxRedirects: 0,
      })
      if (claimed.status() !== 303) throw new Error(`claim returned ${claimed.status()}`)
      const removed = await context.request.delete(`${BASE}/d/${slug}`, { headers, maxRedirects: 0 })
      if (removed.status() !== 303) throw new Error(`delete returned ${removed.status()}`)
      const deleted = await api.get(`/api/docs/${slug}`)
      check(deleted.status() === 404, 'deleted the temporary document')
    } catch (error) {
      failures.push('cleaned up the temporary document')
      console.error(`✗ cleaned up the temporary document: ${error}`)
    }
  }
  await context.close()
  await browser.close()
  await api.dispose()
}

if (failures.length > 0) process.exitCode = 1
