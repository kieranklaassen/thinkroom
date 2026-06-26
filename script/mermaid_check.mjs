// Focused Mermaid browser regression.
// Usage: BASE_URL=http://127.0.0.1:4123 node script/mermaid_check.mjs
import { chromium, request } from 'playwright'

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:3000'
const VALID_SOURCE = `flowchart LR
  A[Draft] --> B{Review}
  B -->|Approve| C[Publish]
  B -->|Revise| A
  click A "javascript:alert('unsafe')"`
const INVALID_SOURCE = `flowchart definitely not valid
  A --`

const failures = []
const check = (condition, message, detail = '') => {
  if (condition) {
    console.log(`✓ ${message}`)
  } else {
    failures.push(message)
    console.error(`✗ ${message}${detail ? `: ${detail}` : ''}`)
  }
}

const api = await request.newContext({
  baseURL: BASE,
  extraHTTPHeaders: { 'X-Agent-Name': 'Mermaid browser check' },
})
const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
const page = await context.newPage()
const mermaidErrors = []
let slug

page.on('pageerror', (error) => {
  if (/parse error|unknowndiagram|mermaid.*(?:error|failed)/i.test(String(error))) {
    mermaidErrors.push(String(error))
  }
})
page.on('console', (message) => {
  if (
    message.type() === 'error' &&
    /parse error|unknowndiagram|mermaid.*(?:error|failed)/i.test(message.text())
  ) {
    mermaidErrors.push(message.text())
  }
})

try {
  const created = await api.post('/api/docs', {
    data: {
      title: 'Mermaid browser check',
      content: `# Mermaid browser check

## Valid

\`\`\`mermaid
${VALID_SOURCE}
\`\`\`

## Invalid fallback

\`\`\`mermaid
${INVALID_SOURCE}
\`\`\`
`,
    },
  })
  check(created.ok(), 'created a temporary Mermaid document', String(created.status()))
  slug = (await created.json()).slug

  await page.goto(`${BASE}/d/${slug}/edit`)
  await page.locator('.doc-status--live').waitFor({ timeout: 15_000 })
  await page.locator('.mermaid-diagram[data-state="ready"]').waitFor({ timeout: 15_000 })
  await page.locator('.mermaid-diagram[data-state="error"]').waitFor({ timeout: 15_000 })

  const sources = page.locator('pre[data-language="mermaid"]')
  const labels = await page.locator('.mermaid-diagram[data-state="ready"] svg text').allTextContents()
  check(labels.includes('Draft') && labels.includes('Publish'), 'valid Mermaid renders labeled SVG')
  check(await sources.nth(0).isVisible(), 'edit mode keeps valid Mermaid source visible')
  check(await sources.nth(1).isVisible(), 'invalid Mermaid keeps its source visible')
  check((await sources.nth(0).textContent()) === VALID_SOURCE, 'editable source remains byte-for-byte intact')

  const unsafeDom = await page.locator('.mermaid-diagram[data-state="ready"]').evaluate((diagram) => ({
    scripts: diagram.querySelectorAll('script, foreignObject').length,
    eventAttributes: Array.from(diagram.querySelectorAll('*')).flatMap((element) =>
      Array.from(element.attributes).filter((attribute) => attribute.name.startsWith('on')),
    ).length,
    unsafeLinks: Array.from(diagram.querySelectorAll('a')).filter((anchor) =>
      (anchor.getAttribute('href') ?? anchor.getAttribute('xlink:href') ?? '')
        .trim().toLowerCase().startsWith('javascript:'),
    ).length,
  }))
  check(
    unsafeDom.scripts === 0 && unsafeDom.eventAttributes === 0 && unsafeDom.unsafeLinks === 0,
    'rendered SVG removes executable markup and unsafe links',
    JSON.stringify(unsafeDom),
  )

  await page.waitForTimeout(1_200)
  const stateResponse = await api.get(`/api/docs/${slug}`)
  const state = await stateResponse.json()
  check(
    state.content.includes(`\`\`\`mermaid\n${VALID_SOURCE}\n\`\`\``) &&
      state.content.includes(`\`\`\`mermaid\n${INVALID_SOURCE}\n\`\`\``),
    'durable Markdown preserves both Mermaid fences',
  )

  await page.goto(`${BASE}/d/${slug}`)
  await page.locator('.mermaid-diagram[data-state="ready"]').waitFor({ timeout: 15_000 })
  await page.locator('.mermaid-diagram[data-state="error"]').waitFor({ timeout: 15_000 })
  check(!(await sources.nth(0).isVisible()), 'read mode hides source after a successful render')
  check(await sources.nth(1).isVisible(), 'read mode exposes source when rendering fails')

  const desktop = await page.evaluate(() => {
    const figure = document.querySelector('.mermaid-diagram[data-state="ready"]')
    const prose = document.querySelector('.doc-live-editor .ProseMirror')
    return {
      figure: figure?.getBoundingClientRect().width ?? 0,
      prose: prose?.getBoundingClientRect().width ?? 0,
      richWidth: getComputedStyle(document.querySelector('.doc-page')).getPropertyValue('--rich-content-width').trim(),
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    }
  })
  check(
    desktop.figure > desktop.prose && Math.abs(desktop.figure - 960) <= 4 && desktop.overflow === 0,
    'read mode renders the Mermaid diagram at the shared 960px breakout width',
    JSON.stringify(desktop),
  )

  await page.setViewportSize({ width: 390, height: 844 })
  const geometry = await page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    diagramWidth: document.querySelector('.mermaid-diagram')?.getBoundingClientRect().width ?? 0,
    viewportWidth: document.documentElement.clientWidth,
  }))
  check(
    geometry.overflow === 0 && geometry.diagramWidth <= geometry.viewportWidth,
    'Mermaid diagrams fit a mobile viewport without page overflow',
    JSON.stringify(geometry),
  )
  check(mermaidErrors.length === 0, 'Mermaid rendering emits no unhandled browser errors', mermaidErrors.join(' | '))
} finally {
  if (slug) {
    try {
      await page.goto(`${BASE}/d/${slug}`)
      const csrf = await page.locator('meta[name="csrf-token"]').getAttribute('content')
      const headers = { 'X-CSRF-Token': csrf ?? '' }
      const claimed = await context.request.post(`${BASE}/d/${slug}/claim`, {
        form: { name: 'Mermaid browser check' },
        headers,
        maxRedirects: 0,
      })
      if (claimed.status() !== 303) throw new Error(`claim returned ${claimed.status()}`)
      const removed = await context.request.delete(`${BASE}/d/${slug}`, {
        headers,
        maxRedirects: 0,
      })
      if (removed.status() !== 303) throw new Error(`delete returned ${removed.status()}`)
      const deleted = await api.get(`/api/docs/${slug}`)
      check(deleted.status() === 404, 'deleted the temporary Mermaid document')
    } catch (error) {
      failures.push('cleaned up the temporary Mermaid document')
      console.error(`✗ cleaned up the temporary Mermaid document: ${error}`)
    }
  }
  await context.close()
  await browser.close()
  await api.dispose()
}

if (failures.length > 0) process.exitCode = 1
