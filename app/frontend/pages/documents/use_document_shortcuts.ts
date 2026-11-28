import { useEffect } from 'react'
import { MODE_SHORTCUTS, type EditorMode } from '../../components/mode_control'
import { matchesShortcut } from '../../lib/shortcuts'
import type { ThemeName } from '../../lib/theme'

interface Options {
  theme: ThemeName
  changeTheme: (theme: ThemeName) => void
  availableModes: EditorMode[]
  modeLocked: boolean
  changeMode: (mode: EditorMode) => void
  togglePanel: () => void
  toggleFocus: () => void
}

// ⌘1–4 selects Edit/Suggest/Comment/Read. ⌘\ toggles the side panel,
// and ⌘. toggles suggestion focus. Control mirrors Command for parity.
export function useDocumentShortcuts({
  theme,
  changeTheme,
  availableModes,
  modeLocked,
  changeMode,
  togglePanel,
  toggleFocus,
}: Options): void {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (matchesShortcut(event, 'Period', true)) {
        event.preventDefault()
        changeTheme(theme === 'proof' ? 'whitey' : 'proof')
        return
      }
      const modeCode = Object.keys(MODE_SHORTCUTS).find((code) => matchesShortcut(event, code))
      const shortcutMode = modeCode ? MODE_SHORTCUTS[modeCode] : undefined
      if (shortcutMode) {
        if (modeLocked || !availableModes.includes(shortcutMode)) return
        event.preventDefault()
        changeMode(shortcutMode)
        return
      }
      if (matchesShortcut(event, 'Backslash')) {
        event.preventDefault()
        togglePanel()
      } else if (matchesShortcut(event, 'Period')) {
        event.preventDefault()
        toggleFocus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [availableModes, changeMode, changeTheme, modeLocked, theme, toggleFocus, togglePanel])
}
