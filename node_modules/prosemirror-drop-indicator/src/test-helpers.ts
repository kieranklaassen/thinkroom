import { Schema, type Node as ProseMirrorNode } from 'prosemirror-model'
import { EditorState, type Plugin, NodeSelection } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'

import './test-style.css'

export const testSchema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: {
      content: 'text*',
      group: 'block',
      toDOM() {
        return ['p', 0]
      },
      parseDOM: [{ tag: 'p' }],
    },
    text: { group: 'inline' },
  },
  marks: {},
})

export interface CreateTestViewOptions {
  paragraphTexts?: readonly string[]
  plugins?: readonly Plugin[]
  /**
   * The position where a node selection should be placed initially.
   */
  nodeSelectionPos?: number
}

export interface TestView {
  view: EditorView
  doc: ProseMirrorNode
  positions: readonly number[]
  destroy: () => void
}

export function createTestView({
  paragraphTexts = ['one', 'two'],
  plugins = [],
  nodeSelectionPos,
}: CreateTestViewOptions = {}): TestView {
  const paragraphs = paragraphTexts.map((text) =>
    testSchema.node(
      'paragraph',
      null,
      text ? [testSchema.text(text)] : undefined,
    ),
  )
  const doc = testSchema.node('doc', null, paragraphs)

  const positions: number[] = []
  doc.forEach((_, offset) => {
    positions.push(offset)
  })

  const selection =
    nodeSelectionPos !== undefined
      ? NodeSelection.create(doc, nodeSelectionPos)
      : undefined

  const state = EditorState.create({
    doc,
    selection,
    plugins: [...plugins],
  })

  const container = document.createElement('div')
  container.classList.add('test-editor-root')
  document.body.appendChild(container)

  let view: EditorView
  view = new EditorView(container, {
    state,
    dispatchTransaction(tr) {
      const newState = view.state.apply(tr)
      view.updateState(newState)
    },
  })
  view.dom.classList.add('test-editor-content')

  return {
    view,
    doc,
    positions,
    destroy: () => {
      view.destroy()
      container.remove()
    },
  }
}
