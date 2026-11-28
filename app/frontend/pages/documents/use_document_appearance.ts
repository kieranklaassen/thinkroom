import { useCallback, useEffect, useState, type CSSProperties } from 'react'
import { setCookie } from '../../lib/cookies'
import { applyTheme, type ThemeName } from '../../lib/theme'
import {
  RICH_BLOCK_WIDTH_EVENT,
  type RichBlockWidthEventDetail,
} from '../../editor/rich_block_width'
import type { DocumentProps } from './show'

interface DocumentAppearance {
  theme: ThemeName
  changeTheme: (next: ThemeName) => void
  documentWidth: number | null
  setDocumentWidth: (width: number | null) => void
  /** Custom widths for the page root; undefined when both are the default. */
  pageStyle: CSSProperties | undefined
}

/** Theme and column widths, seeded from the server-rendered cookies. */
export function useDocumentAppearance(
  ui: Pick<DocumentProps['ui'], 'theme' | 'document_width' | 'rich_content_width'>,
): DocumentAppearance {
  const [theme, setTheme] = useState(ui.theme)
  const changeTheme = useCallback((next: ThemeName) => {
    applyTheme(next)
    setTheme(next)
  }, [])
  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])
  const [documentWidth, setDocumentWidth] = useState<number | null>(ui.document_width)
  const [richContentWidth, setRichContentWidth] = useState<number | null>(ui.rich_content_width)

  useEffect(() => {
    const handleRichBlockWidth = (event: Event) => {
      const detail = (event as CustomEvent<RichBlockWidthEventDetail>).detail
      setRichContentWidth(detail.width)
      if (detail.commit) setCookie('pruf_rich_width', detail.width === null ? 'default' : String(detail.width))
    }
    window.addEventListener(RICH_BLOCK_WIDTH_EVENT, handleRichBlockWidth)
    return () => window.removeEventListener(RICH_BLOCK_WIDTH_EVENT, handleRichBlockWidth)
  }, [])

  const pageStyle = {
    ...(documentWidth === null ? {} : { '--document-width': `${documentWidth}px` }),
    ...(richContentWidth === null ? {} : { '--rich-content-width': `${richContentWidth}px` }),
  } as CSSProperties

  return {
    theme,
    changeTheme,
    documentWidth,
    setDocumentWidth,
    pageStyle: Object.keys(pageStyle).length === 0 ? undefined : pageStyle,
  }
}
