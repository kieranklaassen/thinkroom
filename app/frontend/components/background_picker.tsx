import { useRef } from 'react'
import { PopoverShell } from './popover_shell'

export const INDEX_BACKGROUNDS = [
  { name: 'morning', label: 'Morning', description: 'Pale sky, white paper' },
  { name: 'terracotta', label: 'Terracotta', description: 'Soft clay, warm accent' },
  { name: 'paper', label: 'Paper', description: 'Quiet warm grey' },
  { name: 'night', label: 'Night', description: 'Dark desk, dim paper' },
] as const

export type IndexBackground = (typeof INDEX_BACKGROUNDS)[number]['name']

interface Props {
  value: IndexBackground
  onChange: (background: IndexBackground) => void
}

/**
 * The index's Background menu: a radiogroup of preset surfaces in the shared
 * PopoverShell (mirrors ThemePicker's keyboard model). The choice persists in
 * the pruf_background cookie, which the server reads for first paint.
 */
export function BackgroundPicker({ value, onChange }: Props) {
  const group = useRef<HTMLDivElement>(null)

  return (
    <PopoverShell
      rootClassName="share-root background-picker-root"
      popoverClassName="share-popover background-popover"
      popoverLabel="Background"
      trigger={({ open, toggle }) => (
        <button
          type="button"
          className="notebook-bar-button"
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={toggle}
        >
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
            <rect x="3" y="4" width="18" height="16" rx="2" fill="none" stroke="currentColor" strokeWidth="1.8" />
            <circle cx="9" cy="10" r="2" fill="none" stroke="currentColor" strokeWidth="1.8" />
            <path d="M21 16l-5-5-9 9" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
          </svg>
          <span>Background</span>
        </button>
      )}
    >
      {({ close }) => (
        <div className="background-picker" role="radiogroup" aria-label="Background" ref={group}>
          {INDEX_BACKGROUNDS.map(({ name, label, description }, index) => (
            <button
              type="button"
              key={name}
              role="radio"
              aria-checked={value === name}
              tabIndex={value === name ? 0 : -1}
              className={`background-option${value === name ? ' is-active' : ''}`}
              ref={(button) => {
                if (button && value === name) button.focus({ preventScroll: true })
              }}
              onClick={() => {
                onChange(name)
                close()
              }}
              onKeyDown={(event) => {
                let next: number
                switch (event.key) {
                  case 'Home': next = 0; break
                  case 'End': next = INDEX_BACKGROUNDS.length - 1; break
                  case 'ArrowDown':
                  case 'ArrowRight': next = (index + 1) % INDEX_BACKGROUNDS.length; break
                  case 'ArrowUp':
                  case 'ArrowLeft': next = (index - 1 + INDEX_BACKGROUNDS.length) % INDEX_BACKGROUNDS.length; break
                  default: return
                }
                event.preventDefault()
                onChange(INDEX_BACKGROUNDS[next].name)
              }}
            >
              <span className={`background-swatch background-swatch--${name}`} aria-hidden="true" />
              <span className="background-copy">
                <span className="background-label">{label}</span>
                <span className="background-description">{description}</span>
              </span>
              <span className="background-check" aria-hidden="true">{value === name ? '✓' : ''}</span>
            </button>
          ))}
        </div>
      )}
    </PopoverShell>
  )
}
