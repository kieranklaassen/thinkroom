import { useEffect, useRef } from 'react'
import type { ThemeName } from '../lib/theme'
import { PopoverShell } from './popover_shell'

const THEMES = [
  { name: 'proof', label: 'Thinkroom', description: 'Warm paper, thoughtful contrast' },
  { name: 'whitey', label: 'Whitey', description: 'Clean white, editorial serif' },
] as const
const SHORTCUT_LABEL = '⌘/Ctrl ⇧ .'

interface Props {
  theme: ThemeName
  onChange: (theme: ThemeName) => void
}

export function ThemePicker({ theme, onChange, onSelect, autoFocus = false }: Props & {
  onSelect?: () => void
  autoFocus?: boolean
}) {
  const group = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (autoFocus) {
      group.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus({ preventScroll: true })
    }
  }, [autoFocus])
  return (
    <div className="theme-picker-content">
      <div className="theme-picker" role="radiogroup" aria-label="Theme" ref={group}>
        {THEMES.map(({ name, label, description }, index) => (
          <button
            type="button"
            key={name}
            role="radio"
            aria-checked={theme === name}
            tabIndex={theme === name ? 0 : -1}
            className={`theme-option ${theme === name ? 'is-active' : ''}`}
            onClick={() => {
              onChange(name)
              onSelect?.()
            }}
            onKeyDown={(event) => {
              let next: number
              switch (event.key) {
                case 'Home': next = 0; break
                case 'End': next = THEMES.length - 1; break
                case 'ArrowDown':
                case 'ArrowRight': next = (index + 1) % THEMES.length; break
                case 'ArrowUp':
                case 'ArrowLeft': next = (index - 1 + THEMES.length) % THEMES.length; break
                default: return
              }
              event.preventDefault()
              onChange(THEMES[next].name)
              group.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next]?.focus({ preventScroll: true })
            }}
          >
            <span className={`theme-swatch theme-swatch--${name}`} aria-hidden="true">Aa</span>
            <span className="theme-copy">
              <span className="theme-label">{label}</span>
              <span className="theme-description">{description}</span>
            </span>
            <span className="theme-check" aria-hidden="true">{theme === name ? '✓' : ''}</span>
          </button>
        ))}
      </div>
      <div className="theme-shortcut">Cycle themes <kbd>{SHORTCUT_LABEL}</kbd></div>
    </div>
  )
}

export function ThemeSwitcher({ onOpenChange, ...props }: Props & {
  onOpenChange?: (open: boolean) => void
}) {
  return (
    <PopoverShell
      rootClassName="share-root theme-switcher-root"
      popoverClassName="share-popover theme-popover"
      popoverLabel="Document theme"
      onOpenChange={onOpenChange}
      trigger={({ open, toggle }) => (
        <button
          type="button"
          className="chrome-toggle theme-trigger"
          aria-label="Change theme"
          aria-haspopup="dialog"
          aria-expanded={open}
          title={`Change theme (${SHORTCUT_LABEL})`}
          onClick={toggle}
        >
          <span aria-hidden="true">◐</span>
        </button>
      )}
    >
      {({ close }) => <ThemePicker {...props} onSelect={close} autoFocus />}
    </PopoverShell>
  )
}
