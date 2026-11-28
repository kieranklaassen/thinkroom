import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
import test from 'node:test'
import ts from 'typescript'

const entry = new URL('../../app/frontend/editor/editor_assembly.ts', import.meta.url)
const assembly = (globalThis.assembly = { used: [], configured: [], configure: null })

// Everything the module imports is replaced by a function that answers with its
// own name and arguments; `key` is the name, as with Milkdown's ctx slices.
const stub = (names) => `data:text/javascript,${encodeURIComponent(names.map((name) =>
  name === 'Editor'
    ? `const chain = {
        config: (run) => { globalThis.assembly.configure = run; return chain },
        use: (plugin) => { globalThis.assembly.used.push(plugin.key); return chain },
      }
      export const Editor = { make: () => chain }`
    : `export const ${name} = Object.assign((...args) => { globalThis.assembly.configured.push('${name}'); return ['${name}', ...args] }, { key: '${name}' })`,
).join('\n'))}`
const STUBS = {}
for (const statement of ts.createSourceFile('x.ts', readFileSync(entry, 'utf8'), ts.ScriptTarget.Latest).statements) {
  if (!ts.isImportDeclaration(statement) || statement.importClause?.isTypeOnly) continue
  STUBS[statement.moduleSpecifier.text] =
    stub(statement.importClause.namedBindings.elements.map(({ name }) => name.text))
}
registerHooks({
  resolve: (specifier, context, nextResolve) =>
    context.parentURL === entry.href && STUBS[specifier]
      ? { url: STUBS[specifier], shortCircuit: true }
      : nextResolve(specifier, context),
})

const { assembleEditor } = await import(entry.href)

function assemble(options = {}, defaults = {}) {
  Object.assign(assembly, { used: [], configured: [] })
  const slices = { ...defaults }
  const name = (slice) => slice.key ?? slice
  assembleEditor({
    root: 'root', authorName: 'Ada', mermaidHints: { a: 1 },
    editable: () => true, sketchControls: () => ({}), onEditRefused: () => {}, ...options,
  })
  assembly.configure({
    set: (slice, value) => { assembly.configured.push(name(slice)); slices[name(slice)] = value },
    update: (slice, change) => { assembly.configured.push(name(slice)); slices[name(slice)] = change(slices[name(slice)] ?? {}) },
  })
  return { slices, configured: [...assembly.configured] }
}

test('plugins register in the order the editor depends on', () => {
  assemble()
  assert.deepEqual(assembly.used, [
    'markdownPresets', 'codeBlockView', 'interactiveTaskListItems', 'tableBlock', 'listener', 'clipboard', 'cursor',
    'indent', 'trailing', 'highlight', 'mermaidDiagrams', 'upload', 'provenance', 'textHighlighter', 'frontmatter',
    'sketchSchemaPlugins', 'sketchNodeViewPlugins', 'richBlockWidthControls', 'slashMenu', 'suggestChangesMarks',
    'suggestState', 'suggestGuard', 'documentSizeGuard', 'selectionWatcher', 'agentCursors', 'readPointers',
    'scrollSettle', 'longDocument', 'collab',
  ])
})

test('every feature is configured, in order', () => {
  assert.deepEqual(assemble().configured, [
    'rootCtx', 'provenanceIdentityCtx', 'mermaidRenderHintsCtx', 'documentSizeGuardCtx', 'sketchControlsCtx',
    'editorViewOptionsCtx', 'highlightPluginConfig', 'lazyShikiParser', 'uploadConfig', 'imageUploader',
    'configureCleanClipboard', 'configureSlashMenu', 'renderSoftBreaks', 'tableBlockConfig',
  ])
})

test('the page\'s values and the defaults each plugin had are both configured', () => {
  const kept = { kept: true }
  const { slices } = assemble({}, {
    documentSizeGuardCtx: kept, editorViewOptionsCtx: kept, highlightPluginConfig: kept, uploadConfig: kept,
    tableBlockConfig: kept,
  })
  assert.equal(slices.rootCtx, 'root')
  assert.deepEqual(slices.provenanceIdentityCtx, { name: 'Ada' })
  assert.deepEqual(slices.mermaidRenderHintsCtx, { a: 1 })
  assert.deepEqual(slices.uploadConfig, { kept: true, uploader: ['imageUploader', 'Ada'], enableHtmlFileUploader: true })
  assert.equal(slices.documentSizeGuardCtx.kept, true)
  assert.equal(slices.tableBlockConfig.kept, true)
  assert.equal(slices.tableBlockConfig.renderButton.key, 'tableButtonIcon')
  const { kept: highlighted, parser, languageExtractor } = slices.highlightPluginConfig
  assert.deepEqual([highlighted, parser], [true, ['lazyShikiParser']])
  assert.equal(languageExtractor({ attrs: { language: 'ruby' } }), 'ruby')
  assert.equal(languageExtractor({ attrs: {} }), '')
  const view = slices.editorViewOptionsCtx
  assert.deepEqual([view.kept, view.dispatchTransaction.key], [true, 'suggestDispatch'])
  assert.deepEqual(view.transformPastedHTML('<b>'), ['sanitizeHtml', '<b>', 'external'])
  assert.deepEqual(assemble({ mermaidHints: undefined }).slices.mermaidRenderHintsCtx, {})
})

test('mode, sketch controls and the refusal notice are read when they are used', () => {
  let editable = false
  let label = 'first'
  const calls = []
  const control = (name) => (...args) => { calls.push([label, name, ...args]); return label }
  const { slices } = assemble({
    editable: () => editable,
    sketchControls: () => Object.fromEntries(['edit', 'save', 'insert', 'delete', 'close', 'enabled'].map((name) => [name, control(name)])),
    onEditRefused: () => calls.push([label, 'refused']),
  })
  assert.equal(slices.editorViewOptionsCtx.editable(), false)
  editable = true
  assert.equal(slices.editorViewOptionsCtx.editable(), true)

  label = 'second'
  const controls = slices.sketchControlsCtx
  controls.edit('data', 'mount', 'wrapper')
  controls.save('data')
  controls.insert()
  controls.delete('id')
  controls.close('id')
  assert.equal(controls.enabled(), 'second')
  slices.documentSizeGuardCtx.onRefused()
  assert.deepEqual(calls, [
    ['second', 'edit', 'data', 'mount', 'wrapper'], ['second', 'save', 'data'], ['second', 'insert'],
    ['second', 'delete', 'id'], ['second', 'close', 'id'], ['second', 'enabled'], ['second', 'refused'],
  ])
})

test('a click opens a link only when no earlier handler took it', () => {
  const clickWith = (handlers) =>
    assemble({}, { editorViewOptionsCtx: { handleDOMEvents: handlers } }).slices.editorViewOptionsCtx.handleDOMEvents
  assert.equal(clickWith({ click: () => true }).click('view', 'event'), true)
  assert.deepEqual(clickWith({ click: () => false }).click('view', 'event'), ['openEditorLink', 'view', 'event'])
  assert.deepEqual(clickWith(undefined).click('view', 'event'), ['openEditorLink', 'view', 'event'])
  const keydown = () => true
  assert.equal(clickWith({ keydown }).keydown, keydown)
})
