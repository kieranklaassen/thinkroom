import { useCallback, useEffect, useMemo } from 'react'
import { router } from '@inertiajs/react'
import type { EditorMode } from '../../components/mode_control'
import type { DocumentProps } from './show'

const documentModePath = (slug: string, mode: EditorMode) =>
  `/d/${encodeURIComponent(slug)}${mode === 'read' ? '' : `/${mode}`}`

const availableDocumentModes = (canWrite: boolean, canComment: boolean): EditorMode[] => {
  if (canWrite) return ['edit', 'suggest', 'comment', 'read']
  if (canComment) return ['comment', 'read']
  return ['read']
}

interface Options {
  slug: string
  /** The mode in the page props, which follow the URL. */
  urlMode: EditorMode
  canWrite: boolean
  canComment: boolean
}

interface DocumentMode {
  availableModes: EditorMode[]
  effectiveMode: EditorMode
  demoModeLocked: boolean
  modeLocked: boolean
  isReading: boolean
  changeMode: (mode: EditorMode) => void
}

/** The mode this viewer is in, the modes they may use, and the switch between them. */
export function useDocumentMode({ slug, urlMode, canWrite, canComment }: Options): DocumentMode {
  // Demo doc always opens in Edit and stays locked there. Ordinary documents
  // take mode directly from the Inertia page props/history entry.
  const demoModeLocked = slug === 'demo'
  const mode = demoModeLocked ? 'edit' : urlMode
  const availableModes = useMemo(
    () => availableDocumentModes(canWrite, canComment),
    [canComment, canWrite],
  )
  const modeAvailable = availableModes.includes(mode)
  const effectiveMode: EditorMode = modeAvailable ? mode : 'read'
  const modeLocked = demoModeLocked || availableModes.length === 1
  const changeMode = useCallback((nextMode: EditorMode) => {
    if (modeLocked || !availableModes.includes(nextMode) || nextMode === mode) return

    // This is an Inertia client-side visit: it pushes URL + props into Inertia
    // history without fetching or remounting the collaborative editor. Native
    // Back/Forward restores the matching ui.mode from that history entry.
    router.push<DocumentProps>({
      url: documentModePath(slug, nextMode),
      props: (props) => ({
        ...props,
        ui: { ...props.ui, mode: nextMode },
      }),
      preserveState: true,
      preserveScroll: true,
    })
  }, [availableModes, slug, mode, modeLocked])
  const isReading = effectiveMode === 'read'

  return { availableModes, effectiveMode, demoModeLocked, modeLocked, isReading, changeMode }
}

// An owner may lock editing while another viewer is on a write-mode URL.
// Replace (rather than push) that now-invalid entry with canonical Read so
// Back cannot return the viewer to an unavailable mode.
export function useReadModeFallback({
  slug,
  urlMode,
  availableModes,
  demoModeLocked,
}: {
  slug: string
  urlMode: EditorMode
  availableModes: EditorMode[]
  demoModeLocked: boolean
}): void {
  useEffect(() => {
    if (demoModeLocked || availableModes.includes(urlMode)) return

    router.replace<DocumentProps>({
      url: documentModePath(slug, 'read'),
      props: (props) => ({
        ...props,
        ui: { ...props.ui, mode: 'read' },
      }),
      preserveState: true,
      preserveScroll: true,
    })
  }, [availableModes, demoModeLocked, slug, urlMode])
}
