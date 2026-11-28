import { useEffect, useState } from 'react'
import type { EditorHandle } from '../../editor/milkdown_editor'

// Review-surface recompute signal, re-derived whenever the Yjs doc
// changes. The Yjs 'update' event is the signal — NOT the Milkdown
// listener, which skips addToHistory:false transactions and therefore
// never fires for remote collaborators' changes (a passive window would
// never see new cards). rAF-coalesced so a burst of keystrokes triggers
// one recompute.
export function useDocumentTick(handle: EditorHandle | null): number {
  const [docTick, setDocTick] = useState(0)
  useEffect(() => {
    if (!handle) return
    let raf = 0
    const bump = () => {
      if (raf) return
      raf = requestAnimationFrame(() => {
        raf = 0
        setDocTick((tick) => tick + 1)
      })
    }
    handle.ydoc.on('update', bump)
    return () => {
      if (raf) cancelAnimationFrame(raf)
      handle.ydoc.off('update', bump)
    }
  }, [handle])

  return docTick
}
