import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import ts from 'typescript'

// Only what the page renders matters here; visits and native chrome do not.
const stub = (source) => `data:text/javascript,${encodeURIComponent(source)}`
const react = JSON.stringify(import.meta.resolve('react'))
const STUBS = {
  '@inertiajs/react': stub(`
    import { createElement } from ${react}
    export const router = {}
    export const Head = () => null
    export const Link = ({ as = 'a', prefetch, method, ...props }) => createElement(as, props)
    export const useForm = () => ({ post() {}, processing: false, data: {}, errors: {} })
  `),
  '@ruby-native/react': stub(`
    export const NativeNavbar = () => null
    export const NativeButton = () => null
    export const NativeMenuItem = () => null
    export const NativeFab = () => null
    export const nativeHaptic = () => ({})
  `),
  riffrec: stub('export const RiffrecRecorder = () => null; export const downloadSessionArchive = () => {}'),
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (STUBS[specifier]) return { url: STUBS[specifier], shortCircuit: true }
    if (specifier.startsWith('.') && !path.extname(specifier) && context.parentURL?.startsWith('file:')) {
      const base = path.resolve(path.dirname(fileURLToPath(context.parentURL)), specifier)
      const file = [`${base}.ts`, `${base}.tsx`].find((candidate) => existsSync(candidate))
      if (file) return { url: pathToFileURL(file).href, shortCircuit: true }
    }
    return nextResolve(specifier, context)
  },
  load(url, context, nextLoad) {
    if (!url.endsWith('.tsx')) return nextLoad(url, context)
    const { outputText } = ts.transpileModule(readFileSync(fileURLToPath(url), 'utf8'), {
      compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ESNext },
    })
    return { format: 'module', source: outputText, shortCircuit: true }
  },
})

const { default: DocumentsIndex } = await import('../../app/frontend/pages/documents/index.tsx')

const doc = (slug, age_group) => ({
  title: slug, slug, tags: ['Research'], created_at: '2026-01-01T00:00:00Z', created_label: 'Jan 1', age_group,
  yours: true, claimable: false, owner_name: null,
})

const serverHtml = renderToString(
  createElement(DocumentsIndex, {
    yours: [doc('new', 'this_week'), ...Array.from({ length: 10 }, (_, i) => doc(`old-${i}`, 'earlier'))],
    yours_count: 11,
    archived_count: 1,
    recent: [{ ...doc('shared', 'earlier'), yours: false, claimable: true }],
    pinned: [{ ...doc('new', 'this_week'), pinned_at: '2026-01-01T00:00:00Z' }],
    continue_reading: null,
    today_label: 'Thursday, 1 January',
    day_part: 'morning',
    ui: { background: 'morning' },
    viewer: { name: 'Ada', guest: false, account: { id: 1, name: 'Ada', email: 'ada@example.com' } },
    csrf_token: 'token',
    webmcp: { tools: [] },
    nativeApp: false,
  }),
)
const tags = (name) => serverHtml.match(new RegExp(`<${name}\\b[^>]*>`, 'g')) ?? []

test('server-rendered buttons that need the page script say they are not ready, and stay focusable', () => {
  const scripted = tags('button').filter((button) => !button.includes('id="new-document-button"'))

  for (const control of [
    'pin-star', 'document-tag-edit', 'row-menu-button', 'agent-start-trigger', 'notebook-bar-button',
    'document-reveal', 'contents-archived-toggle', 'notebook-claim', 'account-signout', 'aria-pressed="false"',
  ]) {
    assert.ok(scripted.some((button) => button.includes(control)), `${control} is rendered`)
  }
  assert.deepEqual(scripted.filter((button) => !button.includes('aria-disabled="true"')), [])
  assert.deepEqual(scripted.filter((button) => / disabled(=|>|\s)/.test(button)), [])
})

test('controls that work without the page script are not marked', () => {
  const working = [
    ...tags('button').filter((button) => button.includes('id="new-document-button"')),
    ...tags('a'),
    ...tags('input').filter((input) => input.includes('type="search"')),
  ]

  assert.ok(working.length > 2)
  assert.deepEqual(working.filter((tag) => /disabled|readonly|aria-busy/i.test(tag)), [])
})
