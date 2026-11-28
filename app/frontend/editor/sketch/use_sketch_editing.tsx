import { useEffect, useState, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import type { Ctx } from '@milkdown/kit/ctx'
import { editorViewCtx, type Editor } from '@milkdown/kit/core'
import { getSession } from '../collab_session'
import type { DocumentFormat } from '../document_format'
import { buildSnapshotPayload } from '../snapshots'
import { deleteSketchNode, focusAfterSketchNode, upsertSketchNode } from './doc_ops'
import type { SketchControls } from './node_view'
import { newSketchData, type SketchData } from './scene'
import { InlineSketch } from './sketch_inline'

interface ActiveSketch {
  data: SketchData
  mount: HTMLElement
  wrapper: HTMLElement
}

interface SketchEditingOptions {
  slug: string
  contentFormat: DocumentFormat
  get: () => Editor | undefined
  /** Filled on every render with what the sketch node views call. */
  controlsRef: RefObject<SketchControls | null>
  /** Read at call time: the mode can change between renders. */
  canEdit: () => boolean
}

/** Sketch edits from node views and the open inline editor; returns that editor's portal. */
export function useSketchEditing({
  slug,
  contentFormat,
  get,
  controlsRef,
  canEdit,
}: SketchEditingOptions): ReactNode {
  const [sketchDraft, setSketchDraft] = useState<ActiveSketch | undefined>(undefined)

  // Sketch writes bypass the debounced snapshot: a closed sketch editor must
  // be durable immediately (persistCurrentState uses keepalive when the save
  // fits, so one followed by navigation still lands).
  const persistSketchChange = (ctx: Ctx) => {
    const session = getSession(slug)
    if (session) {
      void session.provider.persistCurrentState(
        buildSnapshotPayload(ctx, session.ydoc, contentFormat),
      )
    }
  }

  const saveSketch = (data: SketchData, activate = false) => {
    if (!canEdit()) return
    const editor = get()
    if (!editor) return
    editor.action((ctx) => {
      if (upsertSketchNode(ctx.get(editorViewCtx), data, activate)) persistSketchChange(ctx)
    })
  }

  const deleteSketch = (id: string) => {
    if (!canEdit()) return
    const editor = get()
    if (!editor) return
    editor.action((ctx) => {
      if (deleteSketchNode(ctx.get(editorViewCtx), id)) persistSketchChange(ctx)
    })
    setSketchDraft(undefined)
  }

  const insertSketch = () => {
    if (!canEdit()) return
    saveSketch(newSketchData(), true)
  }

  const focusAfterSketch = (id: string) => {
    const editor = get()
    if (!editor) return
    editor.action((ctx) => focusAfterSketchNode(ctx.get(editorViewCtx), id))
  }

  controlsRef.current = {
    edit: (data, mount, wrapper) => setSketchDraft({ data, mount, wrapper }),
    save: (data) => {
      setSketchDraft((current) => current?.data.id === data.id ? { ...current, data } : current)
      saveSketch(data)
    },
    insert: insertSketch,
    delete: deleteSketch,
    close: (id) => setSketchDraft((current) => current?.data.id === id ? undefined : current),
    enabled: canEdit,
  }

  useEffect(() => {
    if (!sketchDraft) return
    sketchDraft.wrapper.classList.add('is-editing')
    return () => sketchDraft.wrapper.classList.remove('is-editing')
  }, [sketchDraft])

  return sketchDraft && sketchDraft.mount.isConnected && createPortal(
    <InlineSketch
      data={sketchDraft.data}
      wrapper={sketchDraft.wrapper}
      onChange={saveSketch}
      onDelete={deleteSketch}
      onDone={(focusAfter = false) => {
        const id = sketchDraft.data.id
        setSketchDraft(undefined)
        if (focusAfter) focusAfterSketch(id)
      }}
    />,
    sketchDraft.mount,
  )
}
