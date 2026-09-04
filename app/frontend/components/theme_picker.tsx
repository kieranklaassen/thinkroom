import { useEffect, useRef } from 'react'
import type { ThemeName } from '../lib/theme'
import { PopoverShell } from './popover_shell'

const THEMES = [
  { name: 'proof', label: 'Thinkroom', description: 'Warm paper, thoughtful contrast' },
  { name: 'whitey', label: 'Whitey', description: 'Clean white, editorial serif' },
] as const

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
    if (autoFocus) group.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus({ preventScroll: true })
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
            onClick={() => { onChange(name); onSelect?.() }}
            onKeyDown={(event) => {
              if (!['ArrowDown', 'ArrowRight', 'ArrowUp', 'ArrowLeft', 'Home', 'End'].includes(event.key)) return
              event.preventDefault()
              const next = event.key === 'Home' ? 0 : event.key === 'End' ? THEMES.length - 1
                : (index + (['ArrowDown', 'ArrowRight'].includes(event.key) ? 1 : -1) + THEMES.length) % THEMES.length
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
      <div className="theme-shortcut">Cycle themes <kbd>⌘/Ctrl ⇧ .</kbd></div>
    </div>
  )
}

export function ThemeSwitcher(props: Props) {
  return (
    <PopoverShell
      rootClassName="share-root theme-switcher-root"
      popoverClassName="share-popover theme-popover"
      popoverLabel="Document theme"
      trigger={({ open, toggle }) => (
        <button type="button" className="chrome-toggle theme-trigger" aria-label="Change theme"
          aria-haspopup="dialog" aria-expanded={open} title="Change theme (⌘/Ctrl ⇧ .)" onClick={toggle}>
          <span aria-hidden="true">◐</span>
        </button>
      )}
    >
      {({ close }) => <ThemePicker {...props} onSelect={close} autoFocus />}
    </PopoverShell>
  )
}
