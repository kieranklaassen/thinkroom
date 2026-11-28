import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import ts from 'typescript'

registerHooks({
  load(url, context, nextLoad) {
    if (!url.endsWith('.tsx')) return nextLoad(url, context)
    const { outputText } = ts.transpileModule(readFileSync(fileURLToPath(url), 'utf8'), {
      compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ESNext },
    })
    return { format: 'module', source: outputText, shortCircuit: true }
  },
})

const { UnsavedEditNotice } = await import('../../app/frontend/components/unsaved_edit_notice.tsx')

test('the notice shows only for an unsaved edit, says what to do, and cannot be dismissed', () => {
  assert.equal(renderToString(createElement(UnsavedEditNotice, { unsaved: false })), '')
  const html = renderToString(createElement(UnsavedEditNotice, { unsaved: true }))
  assert.match(html, /role="alert"/)
  assert.match(html, /doc-notice--pinned/, 'stays in view in a scrolled document')
  assert.match(html, /too large to save[^]*can be lost/)
  assert.match(html, /Copy what you need before you reload or leave/)
  assert.doesNotMatch(html, /<button/)
})
