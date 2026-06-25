// Two-window live-collaboration smoke check using Playwright.
// Usage: BASE_URL=http://localhost:4123 node script/browser_check.mjs
import { chromium } from 'playwright'

const BASE = process.env.BASE_URL ?? 'http://localhost:3000'
const SLUG = process.env.SLUG ?? 'demo'

const fail = (msg) => {
  console.error(`✗ ${msg}`)
  process.exitCode = 1
}
const ok = (msg) => console.log(`✓ ${msg}`)

const browser = await chromium.launch()
const errors = { a: [], b: [], persist: [] }

const makePage = async (label) => {
  const context = await browser.newContext()
  const page = await context.newPage()
  page.on('pageerror', (err) => errors[label].push(String(err)))
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors[label].push(`${msg.text()} [${msg.location()?.url ?? ''}]`)
  })
  await page.goto(`${BASE}/d/${SLUG}`)
  return page
}

try {
  const landing = await browser.newPage()
  await landing.goto(BASE)
  await landing.waitForSelector('.landing-wordmark')
  if ((await landing.locator('.landing-wordmark').innerText()) === 'Thinkroom') {
    ok('landing page uses the Thinkroom wordmark')
  } else {
    fail('landing page does not use the Thinkroom wordmark')
  }
  if ((await landing.locator('.landing-tagline').innerText()) === 'Where deeper thinking compounds.') {
    ok('landing page uses the approved Thinkroom tagline')
  } else {
    fail('landing page does not use the approved Thinkroom tagline')
  }
  await landing.locator('.landing-byline', { hasText: 'creator of Compound Engineering' }).waitFor()
  await landing.close()

  const a = await makePage('a')
  await a.waitForSelector('.milkdown .ProseMirror', { timeout: 15000 })
  await a.waitForSelector('.doc-status--live', { timeout: 10000 })
  ok('editor mounted and live in window A')

  const b = await makePage('b')
  await b.waitForSelector('.milkdown .ProseMirror', { timeout: 15000 })
  await b.waitForSelector('.doc-status--live', { timeout: 10000 })
  ok('editor mounted and live in window B')

  // Let the initial y-prosemirror binding render settle in both windows —
  // typing during the first sync churn can have its selection remapped.
  await a.waitForTimeout(2000)
  await b.waitForTimeout(200)

  // Markdown shortcut: ## + space makes an h2 while typing. Checked on a
  // fresh, single-client doc so no concurrent initial-sync churn can remap
  // the selection mid-keystroke (an artifact of synthetic typing speed, not
  // of human use).
  const created = await (
    await fetch(`${BASE}/api/docs`, {
      method: 'POST',
      headers: { 'X-Agent-Name': 'check', 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Shortcut check', markdown: 'Start here.' }),
    })
  ).json()
  const c = await browser.newPage()
  await c.goto(`${BASE}/d/${created.slug}`)
  await c.waitForSelector('.doc-status--live', { timeout: 15000 })
  await c.waitForTimeout(800)
  await c.click('.milkdown .ProseMirror')
  await c.keyboard.press('Meta+ArrowDown')
  await c.keyboard.press('Enter')
  await c.keyboard.type('## Shortcut heading check')
  const headingOk = await c
    .locator('.milkdown .ProseMirror h2', { hasText: 'Shortcut heading check' })
    .waitFor({ timeout: 5000 })
    .then(() => true)
    .catch(() => false)
  if (headingOk) ok('## markdown input shortcut produced an h2')
  else fail('## input rule did not produce a heading')
  await c.close()

  // The first H1 is the canonical document title: changing it updates this
  // editor, collaborators, durable API state, and survives a reload.
  const titleDoc = await (
    await fetch(`${BASE}/api/docs`, {
      method: 'POST',
      headers: { 'X-Agent-Name': 'check', 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Original title', markdown: '# Original title\n\nBody.\n' }),
    })
  ).json()
  const titleA = await browser.newPage()
  const titleB = await browser.newPage()
  await titleA.goto(`${BASE}/d/${titleDoc.slug}`)
  await titleB.goto(`${BASE}/d/${titleDoc.slug}`)
  await titleA.waitForSelector('.doc-status--live', { timeout: 15000 })
  await titleB.waitForSelector('.doc-status--live', { timeout: 15000 })
  const renamedTitle = `Renamed title ${Date.now()}`
  await titleA.locator('.milkdown .ProseMirror h1').click({ clickCount: 3 })
  await titleA.keyboard.type(renamedTitle)
  const localTitleUpdated = await titleA
    .locator('.doc-title', { hasText: renamedTitle })
    .waitFor({ timeout: 500 })
    .then(() => true)
    .catch(() => false)
  const remoteTitleUpdated = await titleB
    .locator('.doc-title', { hasText: renamedTitle })
    .waitFor({ timeout: 10000 })
    .then(() => true)
    .catch(() => false)
  if (localTitleUpdated && remoteTitleUpdated) {
    ok('editing H1 optimistically updates the title and syncs it live')
  }
  else fail('H1 and live document title diverged')
  if ((await titleA.title()) === renamedTitle) ok('editing H1 updates the browser tab title')
  else fail(`browser tab title diverged: ${JSON.stringify(await titleA.title())}`)
  let persistedTitle = ''
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const titleState = await (await fetch(`${BASE}/api/docs/${titleDoc.slug}`)).json()
    persistedTitle = titleState.title ?? ''
    if (persistedTitle === renamedTitle) break
    await titleA.waitForTimeout(300)
  }
  if (persistedTitle === renamedTitle) ok('H1 title persists to the API')
  else fail(`H1 title did not persist: ${JSON.stringify(persistedTitle)}`)
  await titleA.reload()
  await titleA.waitForSelector('.doc-status--live', { timeout: 15000 })
  if ((await titleA.locator('.doc-title').innerText()) === renamedTitle) {
    ok('H1 title survives reload')
  } else {
    fail('H1 title was lost on reload')
  }
  await titleA.close()
  await titleB.close()

  // Task lists: the rendered control must be a native, keyboard-focusable
  // checkbox whose state round-trips through Markdown and collaborative Yjs.
  const taskDoc = await (
    await fetch(`${BASE}/api/docs`, {
      method: 'POST',
      headers: { 'X-Agent-Name': 'check', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Task list check',
        markdown: '- [ ] First task\n- [x] Second task\n',
      }),
    })
  ).json()
  const taskA = await browser.newPage()
  const taskB = await browser.newPage()
  let blockTaskWebSocketUpdates = false
  await taskA.routeWebSocket(/\/cable(?:\?|$)/, (socket) => {
    const server = socket.connectToServer()
    socket.onMessage((message) => {
      try {
        const command = JSON.parse(String(message))
        const data = command.data ? JSON.parse(command.data) : null
        if (blockTaskWebSocketUpdates && data?.type === 'update') return
      } catch {
        // Non-Action-Cable frames pass through unchanged.
      }
      server.send(message)
    })
  })
  await taskA.goto(`${BASE}/d/${taskDoc.slug}`)
  await taskB.goto(`${BASE}/d/${taskDoc.slug}`)
  await taskA.waitForSelector('.doc-status--live', { timeout: 15000 })
  await taskB.waitForSelector('.doc-status--live', { timeout: 15000 })
  const taskCheckboxes = taskA.locator(
    '.milkdown .ProseMirror li[data-item-type="task"] input[type="checkbox"]',
  )
  if (
    (await taskCheckboxes.count()) === 2 &&
    !(await taskCheckboxes.nth(0).isChecked()) &&
    (await taskCheckboxes.nth(1).isChecked())
  ) {
    ok('task items render native checkboxes with their Markdown state')
  } else {
    fail('task items did not render usable native checkboxes')
  }
  await taskCheckboxes.nth(0).check()
  await taskB
    .locator('.milkdown .ProseMirror li[data-item-type="task"] input[type="checkbox"]')
    .nth(0)
    .waitFor({ state: 'visible', timeout: 5000 })
  await taskB.waitForFunction(
    () =>
      document.querySelector(
        '.milkdown .ProseMirror li[data-item-type="task"] input[type="checkbox"]',
      )?.checked === true,
    { timeout: 10000 },
  )
  ok('checking a task syncs to another editor')

  let taskMarkdown = ''
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const taskState = await (await fetch(`${BASE}/api/docs/${taskDoc.slug}`)).json()
    taskMarkdown = taskState.markdown ?? ''
    const plainTaskMarkdown = taskMarkdown.replace(/<\/?(?:span|ins|del)[^>]*>/g, '')
    if (/^[*-] \[x\] First task/m.test(plainTaskMarkdown)) break
    await taskA.waitForTimeout(300)
  }
  const plainTaskMarkdown = taskMarkdown.replace(/<\/?(?:span|ins|del)[^>]*>/g, '')
  if (/^[*-] \[x\] First task/m.test(plainTaskMarkdown)) {
    ok('checked task round-trips to [x] Markdown')
  } else {
    fail(`checked task did not persist: ${JSON.stringify(taskMarkdown)}`)
  }
  await taskA.reload()
  await taskA.waitForSelector('.doc-status--live', { timeout: 15000 })
  if (await taskA.locator('.task-checkbox').nth(0).isChecked()) {
    ok('checked task survives reload')
  } else {
    fail('checked task did not survive reload')
  }

  // A discrete click must be durable even if the user reloads immediately.
  // This exercises the HTTP durability fallback rather than giving the
  // WebSocket and debounced source snapshot time to settle first.
  blockTaskWebSocketUpdates = true
  await taskA.locator('.task-checkbox').nth(0).uncheck()
  await taskA.reload()
  await taskA.waitForSelector('.doc-status--live', { timeout: 15000 })
  if (!(await taskA.locator('.task-checkbox').nth(0).isChecked())) {
    ok('task toggle survives an immediate reload')
  } else {
    fail('task toggle was lost during an immediate reload')
  }

  // Task completion is a direct checklist action even while text edits are
  // tracked as suggestions. Attr-only task transactions must bypass the
  // suggest-changes transform or the native control toggles without changing
  // ProseMirror/Yjs and silently reverts on reload.
  await taskA.evaluate(
    (slug) => localStorage.setItem(`pruf:mode:${slug}`, 'suggest'),
    taskDoc.slug,
  )
  await taskA.reload()
  await taskA.waitForSelector('.doc-status--live', { timeout: 15000 })
  await taskA.waitForFunction(
    () => document.querySelector('.mode-control-trigger')?.textContent?.includes('Suggest'),
    { timeout: 5000 },
  )
  await taskA.locator('.task-checkbox').nth(0).check()
  await taskA.reload()
  await taskA.waitForSelector('.doc-status--live', { timeout: 15000 })
  if (await taskA.locator('.task-checkbox').nth(0).isChecked()) {
    ok('task toggle persists in Suggest mode')
  } else {
    fail('task toggle was dropped by Suggest mode')
  }
  let suggestTaskMarkdown = ''
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const taskState = await (await fetch(`${BASE}/api/docs/${taskDoc.slug}`)).json()
    suggestTaskMarkdown = (taskState.markdown ?? '').replace(/<\/?(?:span|ins|del)[^>]*>/g, '')
    if (/^[*-] \[x\] First task/m.test(suggestTaskMarkdown)) break
    await taskA.waitForTimeout(300)
  }
  if (/^[*-] \[x\] First task/m.test(suggestTaskMarkdown)) {
    ok('Suggest-mode task toggle persists to Markdown')
  } else {
    fail(`Suggest-mode task did not persist: ${JSON.stringify(suggestTaskMarkdown)}`)
  }
  await taskA.close()
  await taskB.close()

  // Inline sketches: the action inserts an editable canvas directly in the
  // document, changes autosave, the lightweight SVG preview syncs, and
  // agent-readable source survives reload. Non-edit modes remain preview-only.
  const sketchDoc = await (
    await fetch(`${BASE}/api/docs`, {
      method: 'POST',
      headers: { 'X-Agent-Name': 'check', 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Sketch check', markdown: '# Sketch check\n\nBody.\n' }),
    })
  ).json()
  const sketchA = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  const sketchB = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  await Promise.all([
    sketchA.goto(`${BASE}/d/${sketchDoc.slug}`),
    sketchB.goto(`${BASE}/d/${sketchDoc.slug}`),
  ])
  await Promise.all([
    sketchA.waitForSelector('.doc-status--live', { timeout: 15000 }),
    sketchB.waitForSelector('.doc-status--live', { timeout: 15000 }),
  ])
  await sketchA.locator('.milkdown .ProseMirror').click()
  await sketchA.keyboard.press('Meta+ArrowDown')
  await sketchA.getByRole('button', { name: 'Sketch', exact: true }).click()
  await sketchA.locator('.thinkroom-sketch.is-editing .excalidraw').waitFor({ timeout: 15000 })
  ok('sketch action inserts and lazy-loads an inline Excalidraw canvas')
  await sketchA.getByTitle('Rectangle — R or 2').click()
  const sketchCanvas = sketchA.locator('.excalidraw canvas').last()
  const sketchBox = await sketchCanvas.boundingBox()
  if (sketchBox) {
    await sketchA.mouse.move(sketchBox.x + 300, sketchBox.y + 180)
    await sketchA.mouse.down()
    await sketchA.mouse.move(sketchBox.x + 520, sketchBox.y + 320, { steps: 8 })
    await sketchA.mouse.up()
  } else {
    fail('Excalidraw canvas has no drawable bounds')
  }
  const sketchDescription = `Approval flow ${Date.now()}`
  await sketchA.getByRole('textbox', { name: 'Sketch title' }).fill(sketchDescription)
  await sketchA.locator('.doc-title').click()
  await sketchA.locator('.thinkroom-sketch .sketch-preview-svg[data-renderer="excalidraw"]').waitFor({ timeout: 15000 })
  const sketchFitsPaper = await sketchA.locator('.thinkroom-sketch').evaluate((node) => {
    const paper = node.querySelector('svg[data-renderer="excalidraw"]')?.getBoundingClientRect()
    const drawing = node.querySelector('[data-excalidraw-scene]')?.getBoundingClientRect()
    return Boolean(
      paper && drawing &&
      drawing.top >= paper.top - 0.1 &&
      drawing.right <= paper.right + 0.1 &&
      drawing.bottom <= paper.bottom + 0.1 &&
      drawing.left >= paper.left - 0.1
    )
  })
  if (sketchFitsPaper) ok('the complete sketch fits inside its fixed-width paper')
  else fail('the saved sketch preview clips content outside its paper')
  const closedSketchHeight = await sketchA.locator('.thinkroom-sketch').evaluate((node) =>
    node.getBoundingClientRect().height,
  )
  await sketchA.locator('.thinkroom-sketch').click({ position: { x: 100, y: 100 } })
  await sketchA.locator('.thinkroom-sketch.is-editing').waitFor({ timeout: 10000 })
  const openSketchHeight = await sketchA.locator('.thinkroom-sketch').evaluate((node) =>
    node.getBoundingClientRect().height,
  )
  await sketchA.locator('.doc-title').click()
  if (Math.abs(openSketchHeight - closedSketchHeight) < 0.1) {
    ok('opening an inline sketch preserves its exact paper height')
  } else {
    fail(`opening a sketch shifted its height by ${openSketchHeight - closedSketchHeight}px`)
  }
  const afterSketchText = `Continue after sketch ${Date.now()}`
  await sketchA.locator('.thinkroom-sketch + p').click()
  await sketchA.keyboard.type(afterSketchText)
  await sketchA.locator('.thinkroom-sketch + p', { hasText: afterSketchText }).waitFor({ timeout: 5000 })
  ok('the visible trailing text line accepts writing after the inline sketch')
  await sketchB.waitForFunction(
    (title) => document.querySelector('.thinkroom-sketch-title')?.value === title,
    sketchDescription,
    { timeout: 10000 },
  )
  ok('saved sketch renders as SVG and syncs to another editor')

  let sketchState = null
  for (let attempt = 0; attempt < 20; attempt += 1) {
    sketchState = await (await fetch(`${BASE}/api/docs/${sketchDoc.slug}`)).json()
    if (sketchState.content?.includes('```excalidraw') && sketchState.plain_text?.includes(sketchDescription)) break
    await sketchA.waitForTimeout(250)
  }
  if (
    sketchState?.content?.includes('```excalidraw') &&
    sketchState.content.includes('"elements":[{"id"') &&
    sketchState.plain_text.includes(sketchDescription)
  ) {
    ok('sketch source and human-readable semantics persist for agents')
  } else {
    fail(`sketch API contract did not persist: ${JSON.stringify(sketchState)}`)
  }

  await sketchA.addInitScript(() => {
    const observer = new MutationObserver(() => {
      const sketches = Array.from(document.querySelectorAll('.thinkroom-sketch'))
      if (sketches.length === 0 || window.__firstSketchFrameExact !== undefined) return
      requestAnimationFrame(() => {
        window.__firstSketchFrameExact = sketches.every((node) =>
          node.querySelector('[data-renderer="excalidraw"]'),
        )
      })
    })
    observer.observe(document, { childList: true, subtree: true })
  })
  await sketchA.reload()
  await sketchA.locator('.thinkroom-sketch .sketch-preview-svg[data-renderer="excalidraw"]').waitFor({ timeout: 15000 })
  await sketchA.waitForFunction(() => window.__firstSketchFrameExact !== undefined)
  if (await sketchA.evaluate(() => window.__firstSketchFrameExact)) {
    ok('the first visible sketch frame uses the exact Excalidraw renderer')
  } else {
    fail('the first visible sketch frame painted the fallback renderer')
  }
  const hydratedSketchHeight = await sketchA.locator('.thinkroom-sketch').evaluate((node) =>
    node.getBoundingClientRect().height,
  )
  await sketchA.waitForTimeout(400)
  const settledSketchHeight = await sketchA.locator('.thinkroom-sketch').evaluate((node) =>
    node.getBoundingClientRect().height,
  )
  if (Math.abs(hydratedSketchHeight - settledSketchHeight) < 0.1) {
    ok('the preloaded exact sketch renderer does not shift after hydration')
  } else {
    fail(`the sketch shifted ${settledSketchHeight - hydratedSketchHeight}px after hydration`)
  }
  if ((await sketchA.locator('.thinkroom-sketch-title').inputValue()) === sketchDescription) {
    ok('editable sketch scene survives reload')
  } else {
    fail('sketch description or scene was lost on reload')
  }
  await sketchA.locator('.thinkroom-sketch').click({ position: { x: 180, y: 180 } })
  await sketchA.locator('.thinkroom-sketch.is-editing .excalidraw').waitFor({ timeout: 15000 })
  const viewportCanvas = sketchA.locator('.thinkroom-sketch.is-editing canvas').last()
  const viewportCanvasBox = await viewportCanvas.boundingBox()
  if (!viewportCanvasBox) {
    fail('active sketch canvas has no bounds for viewport persistence check')
  } else {
    await sketchA.mouse.move(
      viewportCanvasBox.x + viewportCanvasBox.width / 2,
      viewportCanvasBox.y + viewportCanvasBox.height / 2,
    )
    await sketchA.keyboard.down('Control')
    await sketchA.mouse.wheel(0, 300)
    await sketchA.keyboard.up('Control')
  }
  await sketchA.locator('.doc-title').click()
  await sketchA.locator('.thinkroom-sketch [data-renderer="excalidraw"]').waitFor()
  const closedViewportWidth = await sketchA.locator('[data-excalidraw-scene]').evaluate((node) =>
    node.getBoundingClientRect().width,
  )
  await sketchA.reload()
  await sketchA.locator('.thinkroom-sketch [data-renderer="excalidraw"]').waitFor({ timeout: 15000 })
  const reloadedViewportWidth = await sketchA.locator('[data-excalidraw-scene]').evaluate((node) =>
    node.getBoundingClientRect().width,
  )
  if (Math.abs(closedViewportWidth - reloadedViewportWidth) < 0.1) {
    ok('the editor viewport survives click-away and reload without zooming')
  } else {
    fail(`the sketch viewport changed ${reloadedViewportWidth - closedViewportWidth}px on reload`)
  }
  await sketchA.getByRole('button', { name: /Mode:/ }).click()
  await sketchA.getByRole('option', { name: /^Read/ }).click()
  await sketchA.locator('.thinkroom-sketch').click()
  await sketchA.waitForTimeout(150)
  if ((await sketchA.locator('.thinkroom-sketch.is-editing').count()) === 0) {
    ok('Read mode keeps sketches preview-only')
  } else {
    fail('Read mode opened the sketch editor')
  }
  await sketchB.locator('.thinkroom-sketch').click()
  await sketchB.locator('.excalidraw canvas').last().click({ position: { x: 20, y: 20 } })
  await sketchB.keyboard.press('Delete')
  await sketchA.locator('.thinkroom-sketch').waitFor({ state: 'detached', timeout: 10000 })
  await sketchB.reload()
  if ((await sketchB.locator('.thinkroom-sketch').count()) === 0) {
    ok('deleting a sketch syncs and survives reload')
  } else {
    fail('deleted sketch returned after reload')
  }

  await sketchA.close()
  await sketchB.close()

  const emptySketchDoc = await (
    await fetch(`${BASE}/api/docs`, {
      method: 'POST',
      headers: { 'X-Agent-Name': 'check', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Empty sketch affordance',
        markdown: `\`\`\`excalidraw\n${JSON.stringify({
          id: 'add_sketch_fixture',
          formatVersion: 1,
          description: '',
          height: 320,
          scene: { type: 'excalidraw', version: 2, elements: [], appState: {}, files: {} },
        })}\n\`\`\`\n`,
      }),
    })
  ).json()
  const insertSketchPage = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  await insertSketchPage.goto(`${BASE}/d/${emptySketchDoc.slug}`)
  await insertSketchPage.waitForSelector('.doc-status--live', { timeout: 15000 })
  await insertSketchPage.locator('.sketch-add-inline').waitFor({ state: 'visible', timeout: 5000 })
  await insertSketchPage.locator('.sketch-add-inline').click()
  await insertSketchPage.locator('.thinkroom-sketch.is-editing').waitFor({ timeout: 15000 })
  ok('empty trailing line offers a lightweight Add sketch action')
  await insertSketchPage.locator('.thinkroom-sketch.is-editing').hover()
  await insertSketchPage
    .locator('.thinkroom-sketch.is-editing')
    .getByRole('button', { name: 'Delete sketch' })
    .click()
  await insertSketchPage.waitForFunction(
    () => document.querySelectorAll('.thinkroom-sketch').length === 1,
    undefined,
    { timeout: 10000 },
  )
  ok('hovering the paper exposes a tape-mounted delete action')

  await insertSketchPage.locator('.ProseMirror > p:last-of-type').click()
  await insertSketchPage.keyboard.type('/')
  await insertSketchPage.locator('.thinkroom-slash-menu[data-visible="true"]').waitFor({ timeout: 5000 })
  if ((await insertSketchPage.locator('.thinkroom-slash-item').count()) >= 10) {
    ok('typing slash opens the populated block insert menu')
  } else {
    fail('slash menu did not expose the supported document blocks')
  }
  await insertSketchPage.keyboard.type('sketch')
  await insertSketchPage.locator('.thinkroom-sketch.is-editing').waitFor({ timeout: 15000 })
  ok('/sketch filters the insert menu and inserts an inline sketch')
  await insertSketchPage.close()

  const malformedSketch = JSON.stringify({
    id: 'malformed_points',
    formatVersion: 1,
    description: 'Malformed sketch',
    scene: {
      type: 'excalidraw',
      version: 2,
      elements: [{ type: 'arrow', points: [null, null] }],
      appState: {},
      files: {},
    },
  })
  const malformedDoc = await (
    await fetch(`${BASE}/api/docs`, {
      method: 'POST',
      headers: { 'X-Agent-Name': 'check', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Malformed sketch check',
        markdown: `\`\`\`excalidraw\n${malformedSketch}\n\`\`\`\n`,
      }),
    })
  ).json()
  const malformedPage = await browser.newPage()
  await malformedPage.goto(`${BASE}/d/${malformedDoc.slug}`)
  await malformedPage.waitForSelector('.doc-status--live', { timeout: 15000 })
  if (
    (await malformedPage.locator('.thinkroom-sketch').count()) === 0 &&
    (await malformedPage.locator('pre code').innerText()).includes('malformed_points')
  ) {
    ok('invalid sketch source stays visible without crashing the document')
  } else {
    fail('invalid sketch source was hidden or treated as an executable sketch')
  }
  await malformedPage.close()

  const failedChunkContext = await browser.newContext()
  const failedChunkPage = await failedChunkContext.newPage()
  await failedChunkPage.route('**/vite-dev/editor/sketch/excalidraw_canvas.tsx*', (route) =>
    route.abort(),
  )
  await failedChunkPage.goto(`${BASE}/d/${malformedDoc.slug}`)
  await failedChunkPage.getByRole('button', { name: 'Sketch', exact: true }).click()
  await failedChunkPage.locator('.sketch-load-error').waitFor({ timeout: 15000 })
  if ((await failedChunkPage.locator('.milkdown .ProseMirror').count()) === 1) {
    ok('canvas chunk failure leaves the document mounted')
  } else {
    fail('canvas chunk failure unmounted the document editor')
  }
  await failedChunkContext.close()

  // Clipboard: users should get portable Markdown, not Thinkroom's internal
  // provenance/suggestion wrappers. Ordinary Markdown formatting must stay.
  const clipboardDoc = await (
    await fetch(`${BASE}/api/docs`, {
      method: 'POST',
      headers: { 'X-Agent-Name': 'clipboard-check', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Clipboard check',
        markdown:
          '# Checklist\n\n- [ ] **Keep formatting**\n\nA [useful link](https://example.com).\n',
      }),
    })
  ).json()
  const clipboardContext = await browser.newContext({
    permissions: ['clipboard-read', 'clipboard-write'],
  })
  const clipboardPage = await clipboardContext.newPage()
  await clipboardPage.goto(`${BASE}/d/${clipboardDoc.slug}`)
  await clipboardPage.waitForSelector('.doc-status--live', { timeout: 15000 })
  await clipboardPage.locator('.milkdown .ProseMirror').click()
  await clipboardPage.keyboard.press('Meta+A')
  await clipboardPage.keyboard.press('Meta+C')
  const copiedMarkdown = await clipboardPage.evaluate(() => navigator.clipboard.readText())
  if (
    copiedMarkdown.includes('# Checklist') &&
    copiedMarkdown.includes('**Keep formatting**') &&
    copiedMarkdown.includes('[useful link](https://example.com)') &&
    !/<\/?(?:span|ins|del)\b/.test(copiedMarkdown) &&
    !/data-(?:provenance|suggestion-id)/.test(copiedMarkdown)
  ) {
    ok('clipboard exports clean Markdown without activity tracking')
  } else {
    fail(`clipboard leaked activity markup: ${JSON.stringify(copiedMarkdown)}`)
  }
  await clipboardContext.close()

  // Soft breaks: single newlines in seeded markdown must render as visible
  // line breaks (metadata blocks like **Date:** / **Source:** / **Goal:**),
  // the snapshot must round-trip them back to plain newlines unchanged, and
  // literal contexts (fenced code) must keep their newlines untouched.
  const softDoc = await (
    await fetch(`${BASE}/api/docs`, {
      method: 'POST',
      headers: { 'X-Agent-Name': 'check', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Soft break check',
        markdown:
          '# Soft breaks\n\n**Date:** 2026-06-07\n**Source:** transcripts\n**Goal:** sharper plugin\n\n```\ncode line one\ncode line two\n```\n',
      }),
    })
  ).json()
  // br[data-type="hardbreak"] comes from Milkdown's hardbreakAttr; update the
  // selector if a Milkdown upgrade renames it.
  const inspectSoftBreaks = () => {
    const p = Array.from(document.querySelectorAll('.milkdown .ProseMirror p')).find((el) =>
      el.textContent?.includes('Date:'),
    )
    const code = document.querySelectorAll('.milkdown .ProseMirror pre')
    return {
      brs: p ? p.querySelectorAll('br[data-type="hardbreak"]').length : -1,
      lines: p ? p.innerText.split('\n') : [],
      html: p ? p.innerHTML.slice(0, 200) : '(no metadata paragraph found)',
      codeBlocks: code.length,
      codeText: code[0]?.textContent ?? '',
    }
  }
  const assertSoftBreakRender = async (page, label) => {
    await page
      .waitForFunction(
        () => {
          const p = Array.from(document.querySelectorAll('.milkdown .ProseMirror p')).find((el) =>
            el.textContent?.includes('Date:'),
          )
          return p && p.querySelectorAll('br[data-type="hardbreak"]').length === 2
        },
        { timeout: 10000 },
      )
      .catch(() => null)
    const state = await page.evaluate(inspectSoftBreaks)
    if (
      state.brs === 2 &&
      state.lines.length === 3 &&
      state.lines[0].endsWith('2026-06-07') &&
      state.lines[2].startsWith('Goal:')
    ) {
      ok(`soft-break metadata block renders as three separate lines (${label})`)
    } else {
      fail(`soft breaks collapsed (${label}): brs=${state.brs} lines=${JSON.stringify(state.lines)} html=${state.html}`)
    }
    if (state.codeBlocks === 1 && state.codeText.includes('code line one') && state.codeText.includes('code line two')) {
      ok(`fenced code block kept literal newlines (${label})`)
    } else {
      fail(`code block mangled (${label}): blocks=${state.codeBlocks} text=${JSON.stringify(state.codeText.slice(0, 80))}`)
    }
  }
  const sb = await browser.newPage()
  await sb.goto(`${BASE}/d/${softDoc.slug}`)
  await sb.waitForSelector('.doc-status--live', { timeout: 15000 })
  await assertSoftBreakRender(sb, 'initial render')
  // The 900ms snapshot debounce resets on every update — poll the API until
  // the snapshot lands instead of gambling on a fixed sleep.
  const stripMarkup = (md) => (md ?? '').replace(/<\/?(?:span|ins|del)[^>]*>/g, '')
  const expectedMeta = '**Date:** 2026-06-07\n**Source:** transcripts\n**Goal:** sharper plugin'
  let softPlain = ''
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const softState = await (await fetch(`${BASE}/api/docs/${softDoc.slug}`)).json()
    softPlain = stripMarkup(softState.markdown)
    if (softPlain.includes(expectedMeta)) break
    await sb.waitForTimeout(300)
  }
  if (softPlain.includes(expectedMeta)) {
    ok('soft breaks round-trip to plain newlines in the snapshot')
  } else {
    fail(`soft-break serialization drifted: ${JSON.stringify(softPlain.slice(0, 160))}`)
  }
  // Reload exercises the persisted-state reparse path (no drift on repeated
  // open/serialize cycles).
  await sb.reload()
  await sb.waitForSelector('.doc-status--live', { timeout: 15000 })
  await assertSoftBreakRender(sb, 'after reload')
  await sb.close()

  // Frontmatter: a leading YAML block must render as the metadata card (not
  // a thematic break + loose paragraphs), serialize back to a `---` fence at
  // the very top of the snapshot, and stay pinned to the top when content is
  // typed above it (the frontmatterGuard normalization).
  const fmDoc = await (
    await fetch(`${BASE}/api/docs`, {
      method: 'POST',
      headers: { 'X-Agent-Name': 'check', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Frontmatter check',
        markdown:
          '---\ndate: 2026-06-08\ntopic: frontmatter-check\ntags:\n  - alpha\n  - beta\n---\n\n# Frontmatter doc\n\nBody paragraph.\n',
      }),
    })
  ).json()
  const inspectFrontmatter = () => {
    const block = document.querySelector('.milkdown .frontmatter-block')
    if (!block) return { found: false }
    return {
      found: true,
      isFirst: block.parentElement?.firstElementChild === block,
      rows: Array.from(block.querySelectorAll('tr')).map((tr) => [
        tr.querySelector('th')?.textContent,
        tr.querySelector('td')?.textContent,
      ]),
      chips: block.querySelectorAll('.frontmatter-chip').length,
    }
  }
  const assertFrontmatterRender = async (page, label) => {
    await page
      .waitForFunction(() => document.querySelector('.milkdown .frontmatter-block tr'), {
        timeout: 10000,
      })
      .catch(() => null)
    const fm = await page.evaluate(inspectFrontmatter)
    if (
      fm.found &&
      fm.isFirst &&
      fm.rows.length === 3 &&
      fm.rows[0][0] === 'date' &&
      fm.rows[0][1] === '2026-06-08' &&
      fm.chips === 2
    ) {
      ok(`frontmatter renders as a key/value card at the top (${label})`)
    } else {
      fail(`frontmatter card wrong (${label}): ${JSON.stringify(fm)}`)
    }
  }
  const fmPage = await browser.newPage()
  await fmPage.goto(`${BASE}/d/${fmDoc.slug}`)
  await fmPage.waitForSelector('.doc-status--live', { timeout: 15000 })
  await assertFrontmatterRender(fmPage, 'initial render')
  // Typing at the very top of the doc displaces the frontmatter; the guard
  // must move it back above the typed paragraph before the snapshot lands.
  await fmPage.click('.milkdown .ProseMirror')
  await fmPage.keyboard.press('Meta+ArrowDown')
  await fmPage.keyboard.press('Enter')
  await fmPage.keyboard.type('Typed after seed.')
  let fmSnapshot = ''
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const fmState = await (await fetch(`${BASE}/api/docs/${fmDoc.slug}`)).json()
    fmSnapshot = stripMarkup(fmState.markdown)
    if (fmSnapshot.includes('Typed after seed.')) break
    await fmPage.waitForTimeout(300)
  }
  if (fmSnapshot.startsWith('---\ndate: 2026-06-08\ntopic: frontmatter-check\ntags:\n  - alpha\n  - beta\n---\n')) {
    ok('frontmatter round-trips to a leading --- fence in the snapshot')
  } else {
    fail(`frontmatter serialization drifted: ${JSON.stringify(fmSnapshot.slice(0, 120))}`)
  }
  await fmPage.reload()
  await fmPage.waitForSelector('.doc-status--live', { timeout: 15000 })
  await assertFrontmatterRender(fmPage, 'after reload')
  await fmPage.close()

  // Type a unique sentinel at the start of the doc in A
  const sentinel = `sync-${Date.now()}`
  await a.click('.milkdown .ProseMirror')
  await a.keyboard.press('Meta+ArrowUp')
  await a.keyboard.press('End')
  await a.keyboard.type(` ${sentinel}`)

  await b.waitForFunction(
    (s) => document.querySelector('.milkdown .ProseMirror')?.textContent?.includes(s),
    sentinel,
    { timeout: 10000 },
  )
  ok('edit from A appeared live in B (CRDT sync works)')


  // Reload A and confirm persistence
  await a.reload()
  await a.waitForSelector('.milkdown .ProseMirror', { timeout: 15000 })
  await a.waitForFunction(
    (s) => document.querySelector('.milkdown .ProseMirror')?.textContent?.includes(s),
    sentinel,
    { timeout: 10000 },
  )
  ok('content survived reload (server persistence works)')


  // --- Provenance checks ---
  const pendingAi = await a.locator('.milkdown .prov--ai.prov--pending').count()
  if (pendingAi > 0) ok('seeded AI spans render with pending tint')
  else fail('no pending AI spans found — seed provenance did not round-trip')

  // Provenance review is a transient text-targeted affordance. Clicking
  // anywhere outside the document should dismiss it instead of leaving a
  // stale "Pending review" popover anchored to the last AI span.
  await a.locator('.milkdown .prov--ai.prov--pending').first().click()
  await a.locator('.review-popover').waitFor({ state: 'visible', timeout: 5000 })
  await a.locator('.doc-title').click()
  const reviewDismissed = await a
    .locator('.review-popover')
    .waitFor({ state: 'hidden', timeout: 1000 })
    .then(() => true)
    .catch(() => false)
  if (reviewDismissed) ok('clicking outside the document dismisses provenance review')
  else fail('provenance review stayed open after an outside click')
  await a.locator('.milkdown .prov--ai.prov--pending').first().click()
  const reviewReopened = await a
    .locator('.review-popover')
    .waitFor({ state: 'visible', timeout: 1000 })
    .then(() => true)
    .catch(() => false)
  if (reviewReopened) ok('clicking the same agent text reopens provenance review')
  else fail('dismissed provenance review did not reopen on the same text')
  await a.locator('.doc-title').click()

  // Typed text gets human attribution in the DOM of the other window
  const humanSentinel = `human-${Date.now()}`
  await a.click('.milkdown .ProseMirror')
  await a.keyboard.press('Meta+ArrowDown')
  await a.keyboard.press('Enter')
  await a.keyboard.type(humanSentinel)
  await b.waitForFunction(
    (s) =>
      Array.from(document.querySelectorAll('.milkdown span[data-provenance][data-kind="human"]')).some(
        (el) => el.textContent?.includes(s),
      ),
    humanSentinel,
    { timeout: 10000 },
  )
  ok('typed text carries human provenance across clients')

  // Summary chip reflects mixed provenance
  const summaryText = await a.locator('.prov-summary').textContent({ timeout: 5000 })
  if (summaryText?.includes('% human') && summaryText.includes('% AI')) {
    ok(`provenance summary live: "${summaryText.trim()}"`)
  } else {
    fail(`summary chip missing or malformed: "${summaryText}"`)
  }

  // Reload keeps AI tints (marks persist through the Yjs doc)
  await b.reload()
  await b.waitForSelector('.milkdown .prov--ai.prov--pending', { timeout: 15000 })
  ok('AI provenance tints survive reload')

  // --- Comment flow: select text -> comment -> appears live -> resolve ---
  // Mouse-select a word in the sentinel paragraph typed above — keyboard
  // line-selection is brittle against demo-doc pollution from prior runs
  // (images and empty lines at the doc edges yield empty selections).
  await a.locator('.milkdown .ProseMirror p', { hasText: humanSentinel }).first().dblclick({ position: { x: 12, y: 10 } })
  await a.locator('.selection-toolbar').waitFor({ timeout: 5000 })
  ok('selection toolbar appears over selected text')
  await a.locator('.selection-toolbar button', { hasText: 'Comment' }).click()
  const commentBody = `Browser check comment ${Date.now()}`
  await a.fill('.comment-input', commentBody)
  await a.locator('.comment-composer button', { hasText: 'Comment' }).click()
  await a.locator('.comment-card', { hasText: commentBody }).waitFor({ timeout: 5000 })
  ok('comment posted (optimistic)')
  await b.locator('.comment-card', { hasText: commentBody }).waitFor({ timeout: 10000 })
  ok('comment appeared live in window B')

  await a
    .locator('.comment-card', { hasText: commentBody })
    .locator('.comment-resolve')
    .click()
  await b.waitForFunction(
    (text) =>
      !Array.from(document.querySelectorAll('.comment-card:not(.is-resolved)')).some((card) =>
        card.textContent?.includes(text),
      ),
    commentBody,
    { timeout: 10000 },
  )
  ok('resolve synced to window B')

  // --- Image upload: paste a PNG -> direct upload -> renders -> syncs ---
  // (paste exercises the same uploader as drop; synthetic DragEvents don't
  // route through ProseMirror's drop pipeline, real drops do)
  await a.click('.milkdown .ProseMirror')
  await a.evaluate(() => {
    const pngB64 =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
    const bytes = Uint8Array.from(atob(pngB64), (c) => c.charCodeAt(0))
    const file = new File([bytes], 'pixel.png', { type: 'image/png' })
    const dataTransfer = new DataTransfer()
    dataTransfer.items.add(file)
    document.querySelector('.milkdown .ProseMirror').dispatchEvent(
      new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dataTransfer }),
    )
  })
  await a
    .locator('.milkdown img[src*="/rails/active_storage/blobs/"]')
    .first()
    .waitFor({ state: 'attached', timeout: 15000 })
  ok('pasted image uploaded via Active Storage and rendered inline')
  await b
    .locator('.milkdown img[src*="/rails/active_storage/blobs/"]')
    .first()
    .waitFor({ state: 'attached', timeout: 10000 })
  ok('image synced live to window B')

  // --- Theme switch: instant, persistent ---
  // The theme picker lives inside the Share popover since the header
  // consolidation — open it first.
  await a.locator('.share-button').click()
  await a.locator('.theme-option', { hasText: 'Whitey' }).click()
  const themeNow = await a.evaluate(() => document.documentElement.dataset.theme)
  if (themeNow === 'whitey') ok('theme switched instantly (optimistic, no reload)')
  else fail(`theme did not switch: ${themeNow}`)
  await a.reload()
  await a.waitForSelector('.milkdown .ProseMirror', { timeout: 15000 })
  const themeAfter = await a.evaluate(() => document.documentElement.dataset.theme)
  if (themeAfter === 'whitey') ok('theme persisted across reload')
  else fail(`theme lost on reload: ${themeAfter}`)
  await a.locator('.share-button').click()
  await a.locator('.theme-option', { hasText: 'Thinkroom' }).click()
  await a.keyboard.press('Escape')

  // --- Agent loop: an agent joins over plain HTTP while humans watch ---
  const agentHeaders = { 'X-Agent-Name': 'Scout', 'Content-Type': 'application/json' }
  const api = `${BASE}/api/docs/${SLUG}`

  // Cold discovery: fetch share URL like curl would
  const discovery = await fetch(`${BASE}/d/${SLUG}`, { headers: { 'User-Agent': 'curl/8.0' } })
  const guide = await discovery.text()
  if (guide.includes('X-Agent-Name') && guide.includes('/api/docs/')) {
    ok('cold fetch of the share URL surfaces the agent guide')
  } else {
    fail('share URL did not teach the agent how to participate')
  }

  await fetch(`${api}/presence`, {
    method: 'POST',
    headers: agentHeaders,
    body: JSON.stringify({ status: 'active', location: 'provenance' }),
  })
  await a.locator('.presence-agent', { hasText: 'Scout' }).first().waitFor({ timeout: 10000 })
  ok('agent presence chip appeared live')
  // Agent activity signal lives in the Share popover since the header
  // consolidation (the old standalone badge is gone).
  await a.locator('.share-button').click()
  await a.locator('.share-agent-dot.is-on').first().waitFor({ timeout: 5000 })
  await a.keyboard.press('Escape')
  ok('share popover shows the agent-active signal')
  await a.locator('.agent-cursor-label', { hasText: 'Scout' }).first().waitFor({ timeout: 5000 })
  ok('agent pseudo-cursor rendered at its work location')
  const overflowAgentName = 'Extremely Long Production Review Agent Name For Mobile Overflow'
  const overflowAgentHeaders = {
    'X-Agent-Name': overflowAgentName,
    'Content-Type': 'application/json',
  }
  await fetch(`${api}/presence`, {
    method: 'POST',
    headers: overflowAgentHeaders,
    body: JSON.stringify({ status: 'active', location: 'provenance' }),
  })
  await a.locator('.agent-cursor-label', { hasText: overflowAgentName }).first().waitFor({ timeout: 5000 })
  await a.setViewportSize({ width: 390, height: 844 })
  await a
    .waitForFunction(
      (agentName) => {
        const label = Array.from(document.querySelectorAll('.agent-cursor-label')).find((el) =>
          el.textContent?.includes(agentName),
        )
        if (!label) return false
        const rect = label.getBoundingClientRect()
        return rect.left >= 8 && rect.right <= 382 && document.documentElement.scrollWidth <= 390
      },
      overflowAgentName,
      { timeout: 5000 },
    )
    .catch(() => null)
  const cursorBox = await a.locator('.agent-cursor-label', { hasText: overflowAgentName }).first().boundingBox()
  const pageWidth = await a.evaluate(() => document.documentElement.scrollWidth)
  if (cursorBox && cursorBox.x >= 8 && cursorBox.x + cursorBox.width <= 382 && pageWidth <= 390) {
    ok('agent pseudo-cursor label stays inside the mobile viewport')
  } else {
    fail(`agent pseudo-cursor label escapes mobile viewport: box=${JSON.stringify(cursorBox)} pageWidth=${pageWidth}`)
  }
  const cursorMoveAnchor = await a.locator('.milkdown .ProseMirror h1').first().innerText()
  await fetch(`${api}/presence`, {
    method: 'POST',
    headers: overflowAgentHeaders,
    body: JSON.stringify({ status: 'active', location: cursorMoveAnchor }),
  })
  await a
    .waitForFunction(
      (agentName) => {
        const label = Array.from(document.querySelectorAll('.agent-cursor-label')).find((el) =>
          el.textContent?.includes(agentName),
        )
        if (!label || !label.closest('h1')) return false
        const rect = label.getBoundingClientRect()
        return rect.left >= 8 && rect.right <= 382 && document.documentElement.scrollWidth <= 390
      },
      overflowAgentName,
      { timeout: 5000 },
    )
  ok('agent pseudo-cursor stays clamped after moving without a viewport resize')
  await a.setViewportSize({ width: 1280, height: 900 })
  const panelWasHidden = await a.locator('.doc-page').evaluate((page) => page.classList.contains('is-panel-hidden'))
  await a.keyboard.press('Meta+\\')
  await a.waitForFunction(
    (wasHidden) => document.querySelector('.doc-page')?.classList.contains('is-panel-hidden') !== wasHidden,
    panelWasHidden,
    { timeout: 5000 },
  )
  await a.waitForTimeout(250)
  const shiftedCursorBox = await a
    .locator('.agent-cursor-label', { hasText: overflowAgentName })
    .first()
    .boundingBox()
  const shiftedPageWidth = await a.evaluate(() => document.documentElement.scrollWidth)
  if (
    shiftedCursorBox &&
    shiftedCursorBox.x >= 8 &&
    shiftedCursorBox.x + shiftedCursorBox.width <= 1272 &&
    shiftedPageWidth <= 1280
  ) {
    ok('agent pseudo-cursor stays clamped after the side panel changes layout')
  } else {
    fail(
      `agent pseudo-cursor escaped after panel layout: box=${JSON.stringify(shiftedCursorBox)} pageWidth=${shiftedPageWidth}`,
    )
  }
  await a.keyboard.press('Meta+\\')
  await a.waitForFunction(
    (wasHidden) => document.querySelector('.doc-page')?.classList.contains('is-panel-hidden') === wasHidden,
    panelWasHidden,
    { timeout: 5000 },
  )
  await fetch(`${api}/presence`, {
    method: 'POST',
    headers: overflowAgentHeaders,
    body: JSON.stringify({ status: 'done' }),
  })

  const suggestRes = await fetch(`${api}/suggestions`, {
    method: 'POST',
    headers: agentHeaders,
    body: JSON.stringify({
      // Soft break in the body: acceptance parses through the same Milkdown
      // parser as seeding, so the two lines must render with a <br> between.
      body: 'An agent-proposed closing paragraph.\nWith a second proposed line.',
      intent: 'Add a closing',
      anchor_text: 'provenance',
    }),
  })
  if (suggestRes.status === 201) ok('agent proposed a suggestion over HTTP (201)')
  else fail(`agent suggestion failed: ${suggestRes.status}`)

  await b.locator('.margin-card .author-chip', { hasText: 'Scout' }).first().waitFor({ timeout: 10000 })
  ok('agent suggestion appeared live, agent-attributed')

  await fetch(`${api}/comments`, {
    method: 'POST',
    headers: agentHeaders,
    body: JSON.stringify({ body: 'Comment from the agent API.', anchor_text: 'markdown' }),
  })
  await b.locator('.comment-card .author-chip--agent', { hasText: 'Scout' }).first().waitFor({ timeout: 10000 })
  ok('agent comment appeared live, agent-attributed')

  await b.locator('.activity-row', { hasText: 'Scout' }).first().waitFor({ timeout: 5000 })
  ok('activity feed logged the agent actions')

  // Human accepts the agent suggestion; agent provenance lands in the doc
  await b.locator('.margin-card .btn-accept').first().click()
  await a.waitForFunction(
    () =>
      Array.from(document.querySelectorAll('.milkdown [data-provenance][data-kind="ai"]')).some(
        (el) => el.dataset.author === 'Scout',
      ),
    undefined,
    { timeout: 10000 },
  )
  ok('accepted agent text carries agent attribution in the document')

  const acceptedSoftBreakOk = await a
    .waitForFunction(
      () => {
        const p = Array.from(document.querySelectorAll('.milkdown .ProseMirror p')).find((el) =>
          el.textContent?.includes('An agent-proposed closing paragraph.'),
        )
        return (
          p &&
          p.querySelectorAll('br[data-type="hardbreak"]').length >= 1 &&
          p.innerText.split('\n').some((line) => line.startsWith('With a second proposed line.'))
        )
      },
      undefined,
      { timeout: 10000 },
    )
    .then(() => true)
    .catch(() => false)
  if (acceptedSoftBreakOk) ok('accepted suggestion soft break renders as a separate line')
  else fail('soft break in accepted suggestion body collapsed into one line')

  // Agent reacts to the human: poll + ack events
  const events = await (await fetch(`${api}/events/pending`, { headers: agentHeaders })).json()
  if (events.events.some((e) => e.action === 'accepted_suggestion')) {
    ok('agent event polling saw the human acceptance')
  } else {
    fail('event polling missed the acceptance')
  }
  await fetch(`${api}/events/ack`, {
    method: 'POST',
    headers: agentHeaders,
    body: JSON.stringify({ last_event_id: events.ack_with }),
  })

  await fetch(`${api}/presence`, {
    method: 'POST',
    headers: agentHeaders,
    body: JSON.stringify({ status: 'done' }),
  })
  await a.waitForFunction(
    () =>
      !Array.from(document.querySelectorAll('.presence-agent')).some((el) =>
        el.textContent?.includes('Scout'),
      ),
    undefined,
    { timeout: 10000 },
  )
  ok('agent sign-off cleared its presence')

  // --- Suggest mode: type-to-suggest tracked changes (Google Docs parity) ---
  const trackDoc = await (
    await fetch(`${BASE}/api/docs`, {
      method: 'POST',
      headers: { 'X-Agent-Name': 'check', 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Track changes check', markdown: 'Suggest target alpha beta gamma.' }),
    })
  ).json()
  const winA = await makePage('a')
  await winA.goto(`${BASE}/d/${trackDoc.slug}`)
  await winA.waitForSelector('.doc-status--live', { timeout: 15000 })
  const winB = await makePage('b')
  await winB.goto(`${BASE}/d/${trackDoc.slug}`)
  await winB.waitForSelector('.doc-status--live', { timeout: 15000 })
  await winA.waitForTimeout(1500)

  await winA.click('.mode-control-trigger')
  await winA.locator('.mode-control-option', { hasText: 'Suggest' }).click()
  const sugSentinel = `tracked-${Date.now()}`
  await winA.click('.milkdown .ProseMirror')
  await winA.keyboard.press('Meta+ArrowDown')
  await winA.keyboard.press('End')
  await winA.keyboard.type(` ${sugSentinel}`)

  const insLocal = await winA
    .locator('.milkdown ins.sug-ins', { hasText: sugSentinel })
    .first()
    .waitFor({ timeout: 5000 })
    .then(() => true)
    .catch(() => false)
  if (insLocal) ok('suggest-mode typing rendered as a tracked insertion (not a direct edit)')
  else fail('suggest-mode typing did not produce an insertion mark')

  await winB.waitForFunction(
    (s) =>
      Array.from(document.querySelectorAll('.milkdown ins.sug-ins')).some(
        (el) => el.textContent?.includes(s) && el.dataset.author,
      ),
    sugSentinel,
    { timeout: 10000 },
  )
  ok('tracked insertion synced live to window B with author attribution')

  // Remote client reviews the tracked edit from its margin card.
  // (Chip exclusion of pending insertions is display-only and exercised by
  // the accept assertions below — an all-human doc can't discriminate it.)
  await winB.locator('.margin-card--inline .btn-accept').first().click()
  await winB.waitForFunction(
    (s) => {
      const root = document.querySelector('.milkdown .ProseMirror')
      if (!root?.textContent?.includes(s)) return false
      const stillMarked = Array.from(document.querySelectorAll('.milkdown ins.sug-ins')).some(
        (el) => el.textContent?.includes(s),
      )
      const attributed = Array.from(
        document.querySelectorAll('.milkdown span[data-provenance][data-kind="human"]'),
      ).some((el) => el.textContent?.includes(s))
      return !stillMarked && attributed
    },
    sugSentinel,
    { timeout: 10000 },
  )
  ok('remote accept kept the text, dropped the tracking, and attributed it human')

  // Deletion: text stays struck-through until resolved; reject restores it.
  await winA.click('.milkdown .ProseMirror')
  await winA.keyboard.press('Meta+ArrowUp')
  await winA.keyboard.press('Home')
  for (let i = 0; i < 7; i += 1) await winA.keyboard.press('Shift+ArrowRight')
  await winA.keyboard.press('Backspace')
  await winA.locator('.milkdown del.sug-del', { hasText: 'Suggest' }).first().waitFor({ timeout: 5000 })
  ok('suggest-mode delete kept the text with a strikethrough deletion mark')
  await winB.locator('.milkdown del.sug-del', { hasText: 'Suggest' }).first().waitFor({ timeout: 10000 })
  await winB.locator('.margin-card--inline .btn-reject').first().click()
  await winB.waitForFunction(
    () =>
      !document.querySelector('.milkdown del.sug-del') &&
      document.querySelector('.milkdown .ProseMirror')?.textContent?.includes('Suggest target'),
    undefined,
    { timeout: 10000 },
  )
  ok('rejecting the deletion restored the text unmarked')

  // --- Comment mode: click-to-comment ---
  await winB.click('.mode-control-trigger')
  await winB.locator('.mode-control-option', { hasText: 'Comment' }).click()
  await winB.locator('.milkdown .ProseMirror p').first().click()
  await winB
    .locator('.selection-toolbar button', { hasText: 'Comment on this paragraph' })
    .waitFor({ timeout: 5000 })
  ok('comment-mode click on a paragraph offered the comment affordance')
  await winB.locator('.selection-toolbar button', { hasText: 'Comment on this paragraph' }).click()
  const clickComment = `Click-to-comment ${Date.now()}`
  await winB.fill('.comment-input', clickComment)
  await winB.locator('.comment-composer button', { hasText: 'Comment' }).click()
  await winA.locator('.comment-card', { hasText: clickComment }).waitFor({ timeout: 10000 })
  ok('click-to-comment posted and synced to the other window')

  await winA.close()
  await winB.close()

  // --- Demo doc: localStorage tampering cannot unlock suggest mode ---
  const demoPage = await browser.newPage()
  await demoPage.goto(`${BASE}/d/${SLUG}`)
  await demoPage.waitForSelector('.doc-status--live', { timeout: 15000 })
  await demoPage.evaluate((slug) => localStorage.setItem(`pruf:mode:${slug}`, 'suggest'), SLUG)
  await demoPage.reload()
  await demoPage.waitForSelector('.doc-status--live', { timeout: 15000 })
  const demoMode = (await demoPage.locator('.mode-control-trigger').textContent())?.trim()
  if (demoMode?.startsWith('Edit')) ok('demo doc ignored a tampered stored mode (locked to Edit)')
  else fail(`demo doc mode after tamper: "${demoMode}"`)
  await demoPage.close()

  // --- Floating chrome placement: measured, centered, never covering ---
  const placeDoc = await (
    await fetch(`${BASE}/api/docs`, {
      method: 'POST',
      headers: { 'X-Agent-Name': 'check', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Placement check',
        markdown: Array.from(
          { length: 12 },
          (_, i) =>
            `Placement paragraph number ${i} with enough words to span a comfortable line of prose in the editor.`,
        ).join('\n\n'),
      }),
    })
  ).json()
  const p = await makePage('a')
  await p.goto(`${BASE}/d/${placeDoc.slug}`)
  await p.waitForSelector('.doc-status--live', { timeout: 15000 })
  await p.waitForTimeout(1000)

  const selectionRect = () =>
    p.evaluate(() => {
      const sel = window.getSelection()
      if (!sel || sel.rangeCount === 0) return null
      const r = sel.getRangeAt(0).getBoundingClientRect()
      return r.width > 0 ? { x: r.x, y: r.y, width: r.width, height: r.height } : null
    })
  const boxesOverlap = (a, b) =>
    a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y

  // Centered over the selection, fully in-viewport, never covering it.
  await p.locator('.milkdown .ProseMirror p').nth(1).dblclick({ position: { x: 12, y: 10 } })
  const toolbar = p.locator('.selection-toolbar.is-placed')
  await toolbar.waitFor({ timeout: 5000 })
  await p.waitForTimeout(250) // entrance animation settles
  let tb = await toolbar.boundingBox()
  let sel = await selectionRect()
  const vp = p.viewportSize()
  if (tb && sel && vp) {
    const drift = Math.abs(tb.x + tb.width / 2 - (sel.x + sel.width / 2))
    if (drift <= Math.max(40, tb.width / 2)) ok('toolbar centers over the selection')
    else fail(`toolbar off-center by ${Math.round(drift)}px`)
    if (tb.x >= 0 && tb.y >= 0 && tb.x + tb.width <= vp.width && tb.y + tb.height <= vp.height) {
      ok('toolbar fully inside the viewport (measured clamp)')
    } else fail(`toolbar escapes the viewport: ${JSON.stringify(tb)}`)
    if (!boxesOverlap(tb, sel)) ok('toolbar does not cover the selected text')
    else fail('toolbar covers the selection')
  } else fail('could not measure toolbar/selection geometry')

  // First visible frame is final: position is stable across frames.
  const tbAgain = await (async () => {
    await p.evaluate(() => new Promise((r) => requestAnimationFrame(r)))
    return toolbar.boundingBox()
  })()
  if (tb && tbAgain && Math.abs(tb.x - tbAgain.x) < 1 && Math.abs(tb.y - tbAgain.y) < 1) {
    ok('toolbar placement stable after reveal (no post-paint jump)')
  } else fail('toolbar moved after reveal')

  // Header flip: with the anchor line tight under the sticky header, the
  // toolbar moves below the selection instead of covering the header.
  await p.evaluate(() => {
    const r = window.getSelection()?.getRangeAt(0)?.getBoundingClientRect()
    if (r) window.scrollBy(0, r.top - 58)
  })
  await p.waitForTimeout(200) // rAF-throttled reposition pass
  tb = await toolbar.boundingBox()
  sel = await selectionRect()
  if (tb && sel && tb.y >= sel.y + sel.height - 1) {
    ok('toolbar flips below the selection when the header blocks above')
  } else fail(`toolbar did not flip below: toolbar ${JSON.stringify(tb)} sel ${JSON.stringify(sel)}`)

  // Drag settle: no toolbar chasing the cursor mid-drag; one reveal on release.
  const dragPara = p.locator('.milkdown .ProseMirror p').nth(3)
  await dragPara.scrollIntoViewIfNeeded()
  const dragBox = await dragPara.boundingBox()
  await p.mouse.move(dragBox.x + 4, dragBox.y + 8)
  await p.mouse.down()
  let seenMidDrag = false
  for (let i = 1; i <= 6; i += 1) {
    await p.mouse.move(dragBox.x + 4 + i * 30, dragBox.y + 8, { steps: 2 })
    await p.waitForTimeout(40)
    if (await p.locator('.selection-toolbar').isVisible().catch(() => false)) seenMidDrag = true
  }
  if (!seenMidDrag) ok('toolbar held back while dragging a selection')
  else fail('toolbar appeared mid-drag')
  await p.mouse.up()
  await p.locator('.selection-toolbar.is-placed').waitFor({ timeout: 5000 })
  ok('toolbar revealed once on release at the settled position')

  // Anchored composer: visible and usable with the side panel hidden (the
  // old rail composer rendered into display:none), never covering its
  // anchor, clamped into the viewport even with the anchor near the bottom.
  await p.keyboard.press('Meta+\\')
  const anchorPara = p.locator('.milkdown .ProseMirror p').nth(5)
  await anchorPara.scrollIntoViewIfNeeded()
  await anchorPara.dblclick({ position: { x: 12, y: 10 } })
  await p.locator('.selection-toolbar.is-placed').waitFor({ timeout: 5000 })
  await p.locator('.selection-toolbar button', { hasText: 'Comment' }).first().click()
  const composer = p.locator('.comment-composer--anchored.is-placed')
  await composer.waitFor({ timeout: 5000 })
  ok('anchored composer visible with the side panel hidden')

  await p.evaluate(() => {
    // Push the anchor near the viewport bottom — the composer must clamp
    // or flip, staying fully visible without covering the anchored text.
    window.scrollBy(0, -Math.max(0, window.innerHeight * 0.6))
  })
  await p.waitForTimeout(200)
  const composerBox = await composer.boundingBox()
  const anchorBox = await anchorPara.boundingBox()
  if (composerBox && anchorBox && vp) {
    if (composerBox.y >= 0 && composerBox.y + composerBox.height <= vp.height) {
      ok('composer stays fully inside the viewport near the bottom edge')
    } else fail(`composer clipped by the viewport: ${JSON.stringify(composerBox)}`)
    if (!boxesOverlap(composerBox, anchorBox)) ok('composer does not cover its anchor paragraph')
    else fail('composer covers the anchored text')
  } else fail('could not measure composer/anchor geometry')

  const hiddenPanelComment = `Hidden panel comment ${Date.now()}`
  await p.fill('.comment-composer--anchored .comment-input', hiddenPanelComment)
  await p.locator('.comment-composer--anchored .btn-accept').click()
  await p.keyboard.press('Meta+\\')
  await p.locator('.comment-card', { hasText: hiddenPanelComment }).waitFor({ timeout: 10000 })
  ok('comment posted from the anchored composer landed in the rail')
  await p.close()

  // --- Resolve persistence: accept/reject/resolve must survive a refresh ---
  // (regression for the optimistic-id resolve 404 and silent non-persistence)
  const persistDoc = await (
    await fetch(`${BASE}/api/docs`, {
      method: 'POST',
      headers: { 'X-Agent-Name': 'check', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Persistence check',
        markdown: 'Persistence paragraph alpha bravo charlie delta echo foxtrot golf hotel.',
      }),
    })
  ).json()
  const seedSuggestion = (anchor) =>
    fetch(`${BASE}/api/docs/${persistDoc.slug}/suggestions`, {
      method: 'POST',
      headers: { 'X-Agent-Name': 'check', 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: 'persistence rewrite', intent: 'check', anchor_text: anchor }),
    })
  await seedSuggestion('alpha')
  await seedSuggestion('bravo')

  const q = await makePage('persist')
  await q.goto(`${BASE}/d/${persistDoc.slug}`)
  await q.waitForSelector('.doc-status--live', { timeout: 15000 })
  await q.waitForTimeout(800) // initial Yjs bind + margin card placement settle

  // Accept one, reject the other; both decisions must survive a reload.
  await q.locator('.margin-card .btn-accept').first().click()
  await q.waitForFunction(() => document.querySelectorAll('.margin-card').length === 1, undefined, {
    timeout: 10000,
  })
  await q.locator('.margin-card .btn-reject').first().click()
  await q.waitForFunction(() => document.querySelectorAll('.margin-card').length === 0, undefined, {
    timeout: 10000,
  })
  await q.reload()
  await q.waitForSelector('.doc-status--live', { timeout: 15000 })
  await q.waitForTimeout(800) // post-reload card re-derivation settle
  const cardsBack = await q.locator('.margin-card').count()
  if (cardsBack === 0) ok('accepted and rejected suggestions stayed resolved across reload')
  else fail(`${cardsBack} resolved suggestion card(s) reappeared after reload`)

  // A freshly posted (optimistic) comment must not offer Resolve until the
  // server id arrives — hold the POST open to keep the optimistic window.
  let commentPostHeld = false
  await q.route('**/comments', async (route) => {
    // Hold only the FIRST comment-creation POST; anything else (and any
    // later POST) passes through untouched so a background request can't
    // consume the delay meant for the optimistic window.
    if (route.request().method() !== 'POST' || commentPostHeld) {
      await route.continue()
      return
    }
    commentPostHeld = true
    await new Promise((resolve) => setTimeout(resolve, 1500))
    await route.continue()
  })
  await q.locator('.milkdown .ProseMirror p').first().dblclick({ position: { x: 12, y: 10 } })
  await q.locator('.selection-toolbar.is-placed').waitFor({ timeout: 5000 })
  await q.locator('.selection-toolbar button', { hasText: 'Comment' }).first().click()
  const persistComment = `Persistence comment ${Date.now()}`
  await q.fill('.comment-composer--anchored .comment-input', persistComment)
  await q.locator('.comment-composer--anchored .btn-accept').click()
  await q.locator('.comment-card', { hasText: persistComment }).waitFor({ timeout: 2000 })
  const resolveDuringWindow = await q
    .locator('.comment-card', { hasText: persistComment })
    .locator('.comment-resolve')
    .count()
  if (resolveDuringWindow === 0) ok('optimistic comment hides Resolve until the server id arrives')
  else fail('Resolve offered on an optimistic comment (would PATCH a negative id)')

  // After reconciliation the button appears; resolving must persist.
  await q
    .locator('.comment-card', { hasText: persistComment })
    .locator('.comment-resolve')
    .waitFor({ timeout: 10000 })
  await q.locator('.comment-card', { hasText: persistComment }).locator('.comment-resolve').click()
  await q.waitForFunction(
    (text) =>
      !Array.from(document.querySelectorAll('.comment-card:not(.is-resolved)')).some((card) =>
        card.textContent?.includes(text),
      ),
    persistComment,
    { timeout: 10000 },
  )
  await q.reload()
  await q.waitForSelector('.doc-status--live', { timeout: 15000 })
  await q.waitForTimeout(800) // post-reload comment list settle
  const resolvedCameBack = await q
    .locator('.comment-card:not(.is-resolved)', { hasText: persistComment })
    .count()
  if (resolvedCameBack === 0) ok('resolved comment stayed resolved across reload')
  else fail('resolved comment reappeared open after reload')

  // Inline tracked edit: accept then reload immediately — the resolve syncs
  // through Yjs and must already be on the server. (Boundary note: local
  // updates made while the cable is disconnected are only re-sent at the
  // next reconnect handshake — a refresh inside that window loses them.
  // Not simulated here; see docs/plans/2026-06-07-001 R3.)
  await q.click('.mode-control-trigger')
  await q.locator('.mode-control-option', { hasText: 'Suggest' }).click()
  await q.click('.milkdown .ProseMirror')
  await q.keyboard.press('Meta+ArrowDown')
  await q.keyboard.press('End')
  const trackedSentinel = `persist-${Date.now()}`
  await q.keyboard.type(` ${trackedSentinel}`)
  await q.locator('.milkdown ins.sug-ins', { hasText: trackedSentinel }).first().waitFor({ timeout: 5000 })
  await q.waitForTimeout(1200) // let the insertion itself persist first
  await q.locator('.margin-card--inline .btn-accept').first().click()
  await q.reload()
  await q.waitForSelector('.doc-status--live', { timeout: 15000 })
  await q.waitForTimeout(1200)
  const trackedStillMarked = await q
    .locator('.milkdown ins.sug-ins', { hasText: trackedSentinel })
    .count()
  const trackedTextKept = await q
    .locator('.milkdown .ProseMirror', { hasText: trackedSentinel })
    .count()
  if (trackedStillMarked === 0 && trackedTextKept > 0) {
    ok('inline tracked-edit accept persisted across an immediate reload')
  } else {
    fail(`inline accept did not persist: marks=${trackedStillMarked} text=${trackedTextKept}`)
  }
  await q.close()

  // --- Accept all + replace semantics ---
  // Mirrors the J3YVc161mb double-outline incident: agents quote markdown
  // SOURCE in `replaces` (heading markers, backslash escapes), and accepted
  // replacements must actually replace — never leave the old text behind.
  const bulkDoc = await (
    await fetch(`${BASE}/api/docs`, {
      method: 'POST',
      headers: { 'X-Agent-Name': 'check', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Accept all check',
        markdown:
          '# Bulk doc\n\n## Talk outline (~60 minutes: 45 talk + Q&A)\n\nIntro paragraph stays.\n\n### 1. Cold open (3 min)\n\nOriginal cold open copy.\n\n### 2. Receipts (5 min)\n\nOriginal receipts copy.\n',
      }),
    })
  ).json()
  const bulkSuggest = (payload) =>
    fetch(`${BASE}/api/docs/${bulkDoc.slug}/suggestions`, {
      method: 'POST',
      headers: { 'X-Agent-Name': 'Scout', 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
  // (a) heading quoted as markdown source with escapes — the exact
  //     production payload shape that used to silently append
  await bulkSuggest({
    body: '## Talk outline (30 min talk + Q\\&A separate)',
    intent: 'retime',
    replaces: '## Talk outline (\\~60 minutes: 45 talk + Q\\&A)',
  })
  // (b) multi-block replaces (heading + paragraph) with a multi-block body
  await bulkSuggest({
    body: '### 1. Cold open (2 min)\n\nTighter cold open copy.',
    intent: 'tighten',
    replaces: '### 1. Cold open (3 min)\n\nOriginal cold open copy.',
  })
  // (c) plain-text inline replace — the path that always worked
  await bulkSuggest({
    body: 'Sharper receipts copy.',
    intent: 'sharpen',
    replaces: 'Original receipts copy.',
  })
  const bulk = await makePage('a')
  await bulk.goto(`${BASE}/d/${bulkDoc.slug}`)
  await bulk.waitForSelector('.doc-status--live', { timeout: 15000 })
  await bulk.waitForTimeout(1000)

  // Per-card accept of the multi-block suggestion first — exercises the
  // single-accept path and accept_all's already-resolved exclusion.
  const multiBlockCard = bulk.locator('.margin-card', { hasText: 'tighten' })
  await multiBlockCard.locator('.btn-accept').click()
  const perCardReplaced = await bulk
    .waitForFunction(
      () => {
        const text = document.querySelector('.milkdown .ProseMirror')?.textContent ?? ''
        return (
          text.includes('Tighter cold open copy.') &&
          !text.includes('Original cold open copy.') &&
          text.includes('Cold open (2 min)') &&
          !text.includes('Cold open (3 min)')
        )
      },
      undefined,
      { timeout: 10000 },
    )
    .then(() => true)
    .catch(() => false)
  if (perCardReplaced) ok('per-card accept replaced a multi-block markdown-quoted section exactly')
  else fail('multi-block replace left old text behind or did not merge')

  const bulkBtnText = (await bulk.locator('.accept-all-button').textContent().catch(() => null))?.trim()
  if (bulkBtnText === 'Accept all 2') ok('Accept all button shows the remaining pending count')
  else fail(`Accept all button wrong or missing: "${bulkBtnText}"`)
  await bulk.locator('.accept-all-button').click()
  const assertBulkDocState = () => {
    const text = document.querySelector('.milkdown .ProseMirror')?.textContent ?? ''
    const once = (s) => text.split(s).length === 2
    const never = (s) => !text.includes(s)
    return (
      document.querySelectorAll('.margin-card').length === 0 &&
      once('Talk outline (30 min talk + Q&A separate)') &&
      never('60 minutes') &&
      once('Sharper receipts copy.') &&
      never('Original receipts copy.') &&
      once('Intro paragraph stays.') &&
      once('Tighter cold open copy.')
    )
  }
  const bulkMerged = await bulk
    .waitForFunction(assertBulkDocState, undefined, { timeout: 15000 })
    .then(() => true)
    .catch(() => false)
  if (bulkMerged) ok('Accept all replaced every quoted section exactly once (no duplication)')
  else {
    const debugText = await bulk.locator('.milkdown .ProseMirror').innerText()
    fail(`Accept all duplicated or dropped content:\n${debugText.slice(0, 400)}`)
  }
  if ((await bulk.locator('.accept-all-button').count()) === 0) {
    ok('Accept all button retired itself once nothing is pending')
  } else {
    fail('Accept all button still visible with no pending suggestions')
  }
  await bulk.waitForTimeout(1500) // let the snapshot debounce flush
  await bulk.reload()
  await bulk.waitForSelector('.doc-status--live', { timeout: 15000 })
  await bulk.waitForTimeout(800)
  const bulkPersisted = await bulk
    .waitForFunction(assertBulkDocState, undefined, { timeout: 10000 })
    .then(() => true)
    .catch(() => false)
  if (bulkPersisted) ok('bulk-accepted replacements persisted across reload')
  else fail('bulk accept state drifted after reload')
  await bulk.close()

  for (const [label, errs] of Object.entries(errors)) {
    const fatal = errs.filter(
      (e) =>
        !e.includes('favicon') &&
        !e.includes('Download the React DevTools') &&
        // Stale Active Storage blobs: prior runs paste images into the demo
        // doc whose blobs/variants no longer resolve — pollution, not a bug.
        !(e.includes('status of 404') && e.includes('/rails/active_storage/')),
    )
    if (fatal.length > 0) fail(`console errors in window ${label}:\n  ${fatal.join('\n  ')}`)
  }
  if (process.exitCode !== 1) console.log('\nAll browser checks passed.')
} catch (err) {
  fail(`browser check crashed: ${err.message}`)
} finally {
  await browser.close()
}
