import { useCallback, useEffect, useState } from 'react'
import type { SheetKind } from '../../components/mobile_dock'
import { useMediaQuery } from '../../lib/use_media_query'

interface MobileSheets {
  isMobile: boolean
  activeSheet: SheetKind | null
  setActiveSheet: (kind: SheetKind | null) => void
  toggleSheet: (kind: SheetKind) => void
  closeSheet: () => void
  /** The suggestion the suggestions sheet opens on. */
  sheetFocusKey: string | null
  setSheetFocusKey: (key: string | null) => void
  openSuggestionSheet: (key: string) => void
}

/** The compact layout and the one bottom sheet it can have open. */
export function useMobileSheets(isClient: boolean): MobileSheets {
  // Compact or coarse-pointer screens: rail and margin cards give way to
  // anchor markers, a bottom dock, and sheets — the full product, rearranged
  // for one hand. The pointer branch catches wide landscape iPads. Masked by isClient
  // so the first render is the desktop layout on both server and client (the
  // matchMedia read happens only after mount) — the responsive collapse then
  // applies one frame later, matching the editor mount.
  const rawIsMobile = useMediaQuery('(max-width: 72rem), (hover: none) and (pointer: coarse)')
  const isMobile = isClient && rawIsMobile
  const [activeSheet, setActiveSheet] = useState<SheetKind | null>(null)
  const [sheetFocusKey, setSheetFocusKey] = useState<string | null>(null)

  useEffect(() => {
    if (!isMobile) setActiveSheet(null)
  }, [isMobile])

  const openSuggestionSheet = useCallback((key: string) => {
    setSheetFocusKey(key)
    setActiveSheet('suggestions')
  }, [])

  return {
    isMobile,
    activeSheet,
    setActiveSheet,
    toggleSheet: (kind) => setActiveSheet((current) => (current === kind ? null : kind)),
    closeSheet: () => setActiveSheet(null),
    sheetFocusKey,
    setSheetFocusKey,
    openSuggestionSheet,
  }
}
