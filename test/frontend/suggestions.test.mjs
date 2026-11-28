import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { registerHooks } from 'node:module'
import path from 'node:path'
import test, { mock } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Clock, Container, Ctx } from '@milkdown/kit/ctx'
import {
  commands,
  config,
  Editor,
  editorState,
  editorViewCtx,
  init,
  keymap,
  parser,
  parserCtx,
  ParserReady,
  pasteRule,
  schema,
  schemaCtx,
  serializer,
} from '@milkdown/kit/core'
import { EditorState } from '@milkdown/kit/prose/state'
import { $markSchema } from '@milkdown/kit/utils'

// Merging needs neither the HTML format nor the plugin that writes typed text's provenance.
const stub = (source) => `data:text/javascript,${encodeURIComponent(source)}`
const STUBS = {
  './provenance': stub('export const SKIP_PROVENANCE = "skip-provenance"'),
  './document_format': stub('export const sourceParser = (_format, markdownParser) => markdownParser'),
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL?.endsWith('/editor/suggestions.ts') && STUBS[specifier]) {
      return { url: STUBS[specifier], shortCircuit: true }
    }
    if (/^\.\.?\//.test(specifier) && context.parentURL?.startsWith('file:')) {
      const file = `${path.resolve(path.dirname(fileURLToPath(context.parentURL)), specifier)}.ts`
      if (existsSync(file)) return { url: pathToFileURL(file).href, shortCircuit: true }
    }
    return nextResolve(specifier, context)
  },
})

// Milkdown's timers signal each other through window events.
const events = new EventTarget()
for (const name of ['addEventListener', 'removeEventListener', 'dispatchEvent']) {
  globalThis[name] ??= events[name].bind(events)
}

const { markdownPresets } = await import('../../app/frontend/editor/schema_attributes.ts')
const { MAX_DOCUMENT_SIZE } = await import('../../app/frontend/editor/document_size_guard.ts')
const { applySuggestion } = await import('../../app/frontend/editor/suggestions.ts')

const provenanceMark = $markSchema('provenance', () => ({
  attrs: { kind: {}, author: {}, state: {} },
  parseMarkdown: { match: () => false, runner: () => {} },
  toMarkdown: { match: () => false, runner: () => {} },
}))

// The editor's parser and schema, up to the parser; no view, so no DOM.
async function buildMarkdown() {
  const ctx = new Ctx(new Container(), new Clock())
  const editor = Editor.make()
  const core = [schema, parser, serializer, commands, keymap, pasteRule, editorState]
  const plugins = [...core, init(editor), config(async () => {}), ...markdownPresets, ...provenanceMark]
  plugins.map((plugin) => plugin(ctx)).forEach((runner) => void runner?.())
  await ctx.wait(ParserReady)
  return { parse: ctx.get(parserCtx), schema: ctx.get(schemaCtx) }
}
// Milkdown's own timeouts would keep the process open for seconds.
mock.timers.enable({ apis: ['setTimeout'] })
const markdown = await buildMarkdown()
mock.timers.reset()

function open(source, { limit = MAX_DOCUMENT_SIZE } = {}) {
  const view = {
    state: EditorState.create({ doc: markdown.parse(source) }),
    dispatch(tr) { view.state = view.state.apply(tr) },
  }
  const slices = new Map([[editorViewCtx, view], [parserCtx, markdown.parse], [schemaCtx, markdown.schema]])
  const ctx = { get: (slice) => slices.get(slice) ?? { limit } }
  const accept = (suggestion) => applySuggestion({ action: (run) => run(ctx) }, {
    author_name: 'Scout', author_kind: 'agent', replaces: null, anchor_text: null, ...suggestion,
  })
  return { view, accept }
}

const blocks = ({ state }) => state.doc.children.map((node) => [node.type.name, node.textContent])
const attributed = ({ state }) => {
  const runs = []
  state.doc.descendants((node) => {
    const mark = node.marks.find(({ type }) => type.name === 'provenance')
    if (mark) runs.push([node.text, { ...mark.attrs }])
  })
  return runs
}

// The document after a suggestion is accepted, by block.
function accepted(source, suggestion) {
  const { view, accept } = open(source)
  assert.notEqual(accept(suggestion), null, 'the suggestion was not merged')
  view.state.doc.check()
  return blocks(view)
}

test('a suggestion anchored to a passage goes right after its block', () => {
  assert.deepEqual(accepted('First one.\n\nSecond one.', { body: 'Added.', anchor_text: 'First' }), [
    ['paragraph', 'First one.'], ['paragraph', 'Added.'], ['paragraph', 'Second one.'],
  ])
  assert.deepEqual(accepted('- item one\n- item two\n\nAfter.', { body: 'Added.', anchor_text: 'item one' }), [
    ['bullet_list', 'item oneitem two'], ['paragraph', 'Added.'], ['paragraph', 'After.'],
  ])
})

test('a suggestion whose passage is gone, repeated or not given goes at the end', () => {
  const source = 'Same words.\n\nSame words.\n\nLast.'
  for (const anchor_text of ['Not here', 'Same words', null]) {
    assert.deepEqual(accepted(source, { body: 'Added.', anchor_text }).slice(2), [
      ['paragraph', 'Last.'], ['paragraph', 'Added.'],
    ])
  }
})

test('a replacement quoted as Markdown source finds its rendered text inside a paragraph', () => {
  assert.deepEqual(accepted('Ship it. **Date:** May 1. Then rest.', { body: 'Date: June 2', replaces: '**Date:** May 1' }), [
    ['paragraph', 'Ship it. Date: June 2. Then rest.'],
  ])
})

test('a replacement after a line break changes only the quoted words', () => {
  assert.deepEqual(accepted('First line\\\nsecond lien\\\nthird line', { body: 'second line', replaces: 'second lien' }), [
    ['paragraph', 'First line\nsecond line\nthird line'],
  ])
})

test('a section quoted as Markdown source is replaced whole by the suggested blocks', () => {
  assert.deepEqual(
    accepted('Intro.\n\n## Old plan\n\nOld steps.\n\nOutro.', {
      body: '## New plan\n\nNew steps.\n\nMore steps.', replaces: '## Old plan\n\nOld steps.',
    }),
    [
      ['paragraph', 'Intro.'], ['heading', 'New plan'], ['paragraph', 'New steps.'],
      ['paragraph', 'More steps.'], ['paragraph', 'Outro.'],
    ],
  )
})

test('a paragraph replaced by several blocks leaves its neighbours whole', () => {
  assert.deepEqual(accepted('Intro.\n\nOld text.\n\nOutro.', { body: '## Heading\n\nNew text.', replaces: 'Old text.' }), [
    ['paragraph', 'Intro.'], ['heading', 'Heading'], ['paragraph', 'New text.'], ['paragraph', 'Outro.'],
  ])
})

test('a replacement whose target is gone or repeated changes nothing', () => {
  for (const replaces of ['Not here', 'twice']) {
    const { view, accept } = open('Say it twice and twice again.')
    const before = view.state.doc
    assert.equal(accept({ body: 'New.', replaces, anchor_text: 'Say it' }), null)
    assert.ok(view.state.doc.eq(before))
  }
})

test('only the merged text is credited, to a person as written or to a machine as pending review', () => {
  const credit = (author_kind) => {
    const { view, accept } = open('Keep this teh same.')
    accept({ body: 'the', replaces: 'teh', author_kind })
    return attributed(view)
  }
  assert.deepEqual(credit('human'), [['the', { kind: 'human', author: 'Scout', state: 'verbatim' }]])
  for (const machine of ['agent', 'ai']) {
    assert.deepEqual(credit(machine), [['the', { kind: 'ai', author: 'Scout', state: 'pending' }]])
  }
})

test('a suggestion that would make the document too large is refused and changes nothing', () => {
  const { view, accept } = open('Short.', { limit: 20 })
  const before = view.state.doc
  assert.equal(accept({ body: 'Far more text than the document may hold.' }), null)
  assert.ok(view.state.doc.eq(before))
})
