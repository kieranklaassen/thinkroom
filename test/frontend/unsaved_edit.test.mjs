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

const { sessionAccess } = await import('../../app/frontend/pages/documents/session_access.ts')
const { UnsavedEditNotice } = await import('../../app/frontend/components/unsaved_edit_notice.tsx')

test('the editor session follows access, except while it holds an unsaved large edit', () => {
  for (const held of [true, false]) {
    for (const current of [true, false]) {
      assert.equal(sessionAccess(held, current, null), current)
      for (const state of ['sending', 'stuck']) assert.equal(sessionAccess(held, current, state), held)
    }
  }
})

test('the warning shows only while an edit is stuck, says what to do, and cannot be dismissed', () => {
  const render = (saveState) => renderToString(createElement(UnsavedEditNotice, { saveState }))
  assert.equal(render(null), '')
  assert.equal(render('sending'), '')
  const html = render('stuck')
  assert.match(html, /role="alert"/)
  assert.match(html, /Your latest changes are not saved/)
  assert.match(html, /Copy what you need before you reload or leave this page/)
  assert.doesNotMatch(html, /<button/)
})
