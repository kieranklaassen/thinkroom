import { chromium } from 'playwright'

const BASE = process.env.BASE_URL ?? 'http://localhost:3000'

const assert = (condition, message) => {
  if (!condition) throw new Error(message)
  console.log(`✓ ${message}`)
}

const createDocument = async (title, content) => {
  const response = await fetch(`${BASE}/api/docs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Agent-Name': 'list-check' },
    body: JSON.stringify({ title, format: 'markdown', content }),
  })
  assert(response.status === 201, `created ${title}`)
  return response.json()
}

const propose = async (slug, payload) => {
  const response = await fetch(`${BASE}/api/docs/${slug}/suggestions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Agent-Name': 'list-check' },
    body: JSON.stringify(payload),
  })
  assert(response.status === 201, `proposed ${payload.intent}`)
}

const waitForEditor = async (page, slug) => {
  await page.goto(`${BASE}/d/${slug}/edit`)
  await page.waitForSelector('.doc-status--live', { timeout: 15000 })
  await page.waitForSelector('.milkdown .ProseMirror')
  await page.waitForTimeout(500)
}

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
const errors = []
page.on('pageerror', (error) => errors.push(String(error)))
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(message.text())
})

try {
  const partial = await createDocument(
    'Partial list replacement check',
    '# Partial list\n\n1. First item alpha.\n2. Second item beta.\n3. Third item gamma.\n',
  )
  await propose(partial.slug, {
    intent: 'merge adjacent items',
    replaces: 'Second item beta. Third item gamma.',
    body: 'Merged second and third item.',
  })

  await waitForEditor(page, partial.slug)
  await page.locator('.margin-card', { hasText: 'merge adjacent items' }).locator('.btn-accept').click()
  await page.waitForFunction(
    () => {
      const items = [...document.querySelectorAll('.milkdown .ProseMirror ol > li')]
        .map((item) => item.textContent?.trim())
      return items.length === 2 &&
        items[0] === 'First item alpha.' &&
        items[1] === 'Merged second and third item.'
    },
    undefined,
    { timeout: 10000 },
  )
  assert(true, 'partial plain-text list replacement preserves a valid two-item ordered list')

  const ambiguous = await createDocument(
    'Ambiguous list replacement check',
    '# Ambiguous lists\n\n1. Shared item one.\n2. Shared item two.\n\nA separator.\n\n1. Shared item one.\n2. Shared item two.\n',
  )
  await propose(ambiguous.slug, {
    intent: 'ambiguous duplicate lists',
    replaces: 'Shared item one. Shared item two.',
    body: 'This must not replace either list.',
  })

  await waitForEditor(page, ambiguous.slug)
  await page.locator('.margin-card', { hasText: 'ambiguous duplicate lists' }).locator('.btn-accept').click()
  await page.waitForFunction(
    () => {
      const text = document.querySelector('.milkdown .ProseMirror')?.textContent ?? ''
      const notice = document.querySelector('.doc-notice')?.textContent ?? ''
      return document.querySelectorAll('.milkdown .ProseMirror ol').length === 2 &&
        text.split('Shared item one.').length === 3 &&
        !text.includes('This must not replace either list.') &&
        document.querySelectorAll('.margin-card').length === 1 &&
        notice.includes('appears more than once')
    },
    undefined,
    { timeout: 10000 },
  )
  assert(true, 'duplicate list text remains ambiguous and unapplied')

  const bulk = await createDocument(
    'Bulk list replacement check',
    '# Bulk list\n\nControl sentence stays.\n\n1. First item alpha.\n2. Second item beta.\n3. Third item gamma.\n',
  )
  await propose(bulk.slug, {
    intent: 'update control paragraph',
    replaces: 'Control sentence stays.',
    body: 'Updated control sentence.',
  })
  await propose(bulk.slug, {
    intent: 'convert ordered list to tasks',
    replaces: 'First item alpha. Second item beta. Third item gamma.',
    body: '- [ ] First item alpha.\n- [ ] Second item beta.\n- [ ] Third item gamma.',
  })
  await propose(bulk.slug, {
    intent: 'stale target remains pending',
    replaces: 'A target that does not exist.',
    body: 'This must not be inserted.',
  })

  await waitForEditor(page, bulk.slug)
  await page.locator('.accept-all-button').click()
  await page.waitForFunction(
    () => {
      const text = document.querySelector('.milkdown .ProseMirror')?.textContent ?? ''
      const pendingCards = [...document.querySelectorAll('.margin-card')]
      const notice = document.querySelector('.doc-notice')?.textContent?.toLowerCase() ?? ''
      return text.includes('Updated control sentence.') &&
        !text.includes('Control sentence stays.') &&
        !text.includes('This must not be inserted.') &&
        document.querySelectorAll('.milkdown .ProseMirror li[data-item-type="task"] input[type="checkbox"]').length === 3 &&
        pendingCards.length === 1 &&
        pendingCards[0]?.textContent?.includes('stale target remains pending') &&
        notice.includes('skipped')
    },
    undefined,
    { timeout: 15000 },
  )
  assert(true, 'Accept all applies paragraph and list changes while reporting one skipped target')

  await page.waitForTimeout(1500)
  await page.reload()
  await page.waitForSelector('.doc-status--live', { timeout: 15000 })
  await page.waitForFunction(
    () => {
      const text = document.querySelector('.milkdown .ProseMirror')?.textContent ?? ''
      return text.includes('Updated control sentence.') &&
        document.querySelectorAll('.milkdown .ProseMirror li[data-item-type="task"] input[type="checkbox"]').length === 3 &&
        document.querySelectorAll('.milkdown .ProseMirror li[data-item-type="task"] [data-provenance][data-kind="ai"][data-author="list-check"]').length === 3 &&
        document.querySelectorAll('.margin-card').length === 1
    },
    undefined,
    { timeout: 10000 },
  )
  assert(true, 'selective bulk acceptance and task-list conversion persist across reload')

  const fatalErrors = errors.filter(
    (error) =>
      !error.includes('ReactDOMClient.createRoot()') &&
      !error.includes('Hydration failed because the server rendered'),
  )
  assert(
    fatalErrors.length === 0,
    `browser console stays clean${fatalErrors.length ? `: ${fatalErrors.join('; ')}` : ''}`,
  )
  console.log('\nAll list replacement checks passed.')
} finally {
  await browser.close()
}
