// Long-document rendering regression check using Playwright.
// Covers the paths that keep a document with hundreds of blocks fast:
// offscreen blocks skip rendering (content-visibility) while breakout blocks
// and cursor-holding blocks stay fully rendered, every code block is
// highlighted once shiki loads, and breakout width handles report geometry.
// Usage: BASE_URL=http://localhost:3000 node script/long_document_check.mjs
import { chromium, request } from 'playwright'
import { expectedBrowserNoise, waitForLive } from './lib/check_helpers.mjs'

const BASE = process.env.BASE_URL ?? 'http://localhost:3000'
const SECTIONS = 40
const failures = []
const startedAt = Date.now()
const elapsed = () => `${((Date.now() - startedAt) / 1000).toFixed(1)}s`
const check = (condition, message, detail = '') => {
  if (condition) {
    console.log(`✓ ${message} (${elapsed()})`)
  } else {
    failures.push(message)
    console.error(`✗ ${message}${detail ? `: ${detail}` : ''} (${elapsed()})`)
  }
}

const languages = ['ruby', 'typescript', 'bash', 'json']
const samples = {
  ruby: 'class Document < ApplicationRecord\n  has_many :suggestions\nend',
  typescript: 'export const total = (xs: number[]): number => xs.reduce((a, b) => a + b, 0)',
  bash: 'set -euo pipefail\nbin/rails test',
  json: '{ "slug": "abc", "claimed": true }',
}
const content = [
  '# Long document check',
  '',
  ...Array.from({ length: SECTIONS }, (_, i) => {
    const language = languages[i % languages.length]
    return [
      `## Section ${i + 1}`,
      '',
      `Paragraph ${i + 1}. ${'Reading deeply and judging critically takes focus. '.repeat(6)}`,
      '',
      `- Item one of section ${i + 1}`,
      `- Item two of section ${i + 1}`,
      '',
      '```' + language,
      samples[language],
      '```',
      '',
    ].join('\n')
  }),
].join('\n')

const api = await request.newContext({
  baseURL: BASE,
  extraHTTPHeaders: { 'X-Agent-Name': 'Long document check' },
})
const browser = await chromium.launch()
const errors = []
const watch = (page, label) => {
  page.on('pageerror', (error) => {
    const message = error.stack ?? String(error)
    if (!expectedBrowserNoise(message)) errors.push(`${label}: ${message}`)
  })
  page.on('console', (message) => {
    if (message.type() === 'error' && !expectedBrowserNoise(message.text())) {
      errors.push(`${label}: ${message.text()}`)
    }
  })
}
let slug

try {
  const created = await api.post('/api/docs', {
    data: { title: 'Long document check', format: 'markdown', content },
  })
  check(created.status() === 201, 'created the long fixture document', `status ${created.status()}`)
  slug = (await created.json()).slug

  const reader = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await reader.newPage()
  watch(page, 'reader')
  await page.goto(`${BASE}/d/${slug}/edit`, { waitUntil: 'domcontentloaded' })
  await waitForLive(page, 60000)

  const blocks = await page.evaluate(() => {
    const prose = document.querySelector('.doc-live-editor .ProseMirror')
    return {
      total: prose.children.length,
      paragraphs: prose.querySelectorAll(':scope > p').length,
      code: prose.querySelectorAll(':scope > pre').length,
    }
  })
  check(blocks.code === SECTIONS, 'the live editor renders every code block', `${blocks.code}/${SECTIONS}`)
  // ProseMirror's trailing plugin may add one empty paragraph after the last block.
  check(blocks.paragraphs >= SECTIONS, 'the live editor renders every paragraph', `${blocks.paragraphs}/${SECTIONS}`)

  const visibility = await page.evaluate(() => {
    const prose = document.querySelector('.doc-live-editor .ProseMirror')
    const style = (node) => getComputedStyle(node).contentVisibility
    const paragraphs = Array.from(prose.querySelectorAll(':scope > p'))
    const code = Array.from(prose.querySelectorAll(':scope > pre'))
    return {
      supported: 'contentVisibility' in document.documentElement.style,
      paragraphAuto: paragraphs.every((node) => style(node) === 'auto'),
      codeVisible: code.every((node) => style(node) === 'visible'),
      lastParagraphRendered: paragraphs.at(-1).getBoundingClientRect().height > 0,
    }
  })
  check(visibility.supported, 'the browser supports content-visibility')
  check(visibility.paragraphAuto, 'offscreen-capable paragraphs use content-visibility: auto')
  check(visibility.codeVisible, 'breakout code blocks stay fully rendered (their width handle overflows the block)')
  check(visibility.lastParagraphRendered, 'skipped blocks keep a placeholder height so the document keeps its length')

  // The lazy shiki parser coalesces its pending promise; the regression to
  // guard is a document that never gets its refresh and stays plain.
  const highlighted = await page
    .waitForFunction(
      (expected) => {
        const code = Array.from(document.querySelectorAll('.doc-live-editor .ProseMirror > pre code'))
        return code.length === expected && code.every((node) => node.querySelector('span[style]'))
      },
      SECTIONS,
      { timeout: 30000 },
    )
    .then(() => true)
    .catch(() => false)
  check(highlighted, 'every code block is syntax highlighted once shiki has loaded')

  const handles = await page.evaluate(() => {
    const handles = Array.from(document.querySelectorAll('.doc-live-editor .ProseMirror > pre > .rich-block-width-handle'))
    return {
      count: handles.length,
      measured: handles.every((handle) => Number(handle.getAttribute('aria-valuenow')) > 0
        && Number(handle.getAttribute('aria-valuemax')) >= Number(handle.getAttribute('aria-valuemin'))),
    }
  })
  check(handles.count === SECTIONS, 'every code block carries a width handle', `${handles.count}/${SECTIONS}`)
  check(handles.measured, 'width handles report measured aria values without a forced layout pass')

  // A block holding a collaborator cursor must leave containment so the
  // cursor label (drawn above the line) is not clipped. Agent presence renders
  // the same kind of cursor widget as a human peer, through the real
  // decoration path, and can be driven from the API.
  const presence = await api.post(`/api/docs/${slug}/presence`, {
    data: { status: 'active', location: 'Paragraph 3.' },
  })
  check(presence.ok(), 'announced an agent presence near paragraph 3', `status ${presence.status()}`)
  const cursorBlock = await page
    .waitForFunction(
      () => {
        const cursor = document.querySelector('.doc-live-editor .agent-cursor')
        if (!cursor) return null
        const block = cursor.closest('.doc-live-editor .ProseMirror > *')
        const label = cursor.querySelector('.agent-cursor-label')
        return {
          block: block?.tagName,
          marked: block?.hasAttribute('data-holds-cursor') ?? false,
          visibility: block ? getComputedStyle(block).contentVisibility : null,
          labelAbove: label && block ? label.getBoundingClientRect().top < block.getBoundingClientRect().top : false,
        }
      },
      undefined,
      { timeout: 15000 },
    )
    .then((handle) => handle.jsonValue())
    .catch(() => null)
  check(cursorBlock?.block === 'P', 'the agent cursor landed in a paragraph', JSON.stringify(cursorBlock))
  check(cursorBlock?.marked === true, 'the block holding a collaborator cursor is marked data-holds-cursor')
  check(cursorBlock?.visibility === 'visible', 'the block holding a collaborator cursor is not paint-contained')
  check(cursorBlock?.labelAbove === true, 'the cursor label draws above its block (it would be clipped under containment)')

  const left = await api.post(`/api/docs/${slug}/presence`, { data: { status: 'done' } })
  check(left.ok(), 'the agent signed off', `status ${left.status()}`)
  const released = await page
    .waitForFunction(
      () => {
        if (document.querySelector('.doc-live-editor .agent-cursor')) return null
        const block = document.querySelectorAll('.doc-live-editor .ProseMirror > p')[2]
        return { marked: block.hasAttribute('data-holds-cursor'), visibility: getComputedStyle(block).contentVisibility }
      },
      undefined,
      { timeout: 15000 },
    )
    .then((handle) => handle.jsonValue())
    .catch(() => null)
  check(released?.marked === false && released?.visibility === 'auto', 'once the cursor leaves, the block returns to content-visibility: auto', JSON.stringify(released))

  await reader.close()
} catch (error) {
  failures.push(String(error))
  console.error(`✗ ${error.stack ?? error}`)
} finally {
  if (errors.length > 0) {
    failures.push('browser errors')
    console.error('✗ browser errors:\n' + errors.map((e) => `  ${e}`).join('\n'))
  }
  await browser.close()
  await api.dispose()
}

if (failures.length > 0) {
  console.error(`\n${failures.length} failure(s)`)
  process.exit(1)
}
console.log('\nlong document check passed')
