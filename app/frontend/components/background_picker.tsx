import { useEffect, useRef } from 'react'
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
      {({ close }) => <BackgroundOptions value={value} onChange={onChange} onSelect={close} />}
    </PopoverShell>
  )
}

/** The radiogroup mounts only while the popover is open, so focusing the
 *  active option on mount runs once per open, never on unrelated re-renders. */
function BackgroundOptions({ value, onChange, onSelect }: Props & { onSelect: () => void }) {
  const group = useRef<HTMLDivElement>(null)
  useEffect(() => {
    group.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus({ preventScroll: true })
  }, [])

  return (
    <div className="background-picker" role="radiogroup" aria-label="Background" ref={group}>
      {INDEX_BACKGROUNDS.map(({ name, label, description }, index) => (
        <button
          type="button"
          key={name}
          role="radio"
          aria-checked={value === name}
          tabIndex={value === name ? 0 : -1}
          className={`background-option${value === name ? ' is-active' : ''}`}
          onClick={() => {
            onChange(name)
            onSelect()
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
            group.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next]?.focus({ preventScroll: true })
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
  )
}
