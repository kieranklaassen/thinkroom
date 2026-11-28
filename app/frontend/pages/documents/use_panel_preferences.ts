import { useCallback, useEffect, useState } from 'react'
import type { ActivityFilter } from '../../components/activity_panel'
import { setCookie, setCookieFlag } from '../../lib/cookies'
import type { DocumentProps } from './show'

/** Side-panel and focus prefs, seeded from the server-rendered cookies and
 *  written back so the next SSR paint matches. Mode is intentionally absent:
 *  its shareable URL and Inertia history entry are its source of truth. */
export function usePanelPreferences(ui: DocumentProps['ui']) {
  const [panelOpen, setPanelOpen] = useState(ui.panel_open)
  const [focusMode, setFocusMode] = useState(ui.focus_mode)
  const [activityFilter, setActivityFilter] = useState(ui.activity_filter)
  const [commentsResolved, setCommentsResolved] = useState(ui.comments_resolved)
  const changeCommentsResolved = (value: boolean) => {
    setCommentsResolved(value)
    setCookieFlag('pruf_comments_resolved', value)
  }
  const [activityExpanded, setActivityExpanded] = useState(ui.activity_expanded)

  useEffect(() => {
    setCookieFlag('pruf_panel', panelOpen)
  }, [panelOpen])
  useEffect(() => {
    setCookieFlag('pruf_focus', focusMode)
  }, [focusMode])

  const togglePanel = useCallback(() => setPanelOpen((open) => !open), [])
  const toggleFocus = useCallback(() => setFocusMode((focus) => !focus), [])

  return {
    panelOpen,
    togglePanel,
    focusMode,
    setFocusMode,
    toggleFocus,
    commentsResolved,
    changeCommentsResolved,
    activityPreferences: {
      filter: activityFilter,
      expanded: activityExpanded,
      onFilterChange: (value: ActivityFilter) => {
        setActivityFilter(value)
        setCookie('pruf_activity_filter', value)
      },
      onExpandedChange: (value: boolean) => {
        setActivityExpanded(value)
        setCookieFlag('pruf_activity_expanded', value)
      },
    },
  }
}
