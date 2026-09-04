import type { ThemeName } from '../lib/theme'

export function ThemePicker({ theme, onChange }: {
  theme: ThemeName
  onChange: (theme: ThemeName) => void
}) {

  return (
    <span className="theme-picker" role="radiogroup" aria-label="Theme">
      {(['proof', 'whitey'] as ThemeName[]).map((name) => (
        <button
          key={name}
          role="radio"
          aria-checked={theme === name}
          className={`theme-option ${theme === name ? 'is-active' : ''}`}
          onClick={() => onChange(name)}
          title={name === 'proof' ? 'Thinkroom — warm paper' : 'Whitey — clean white'}
        >
          <span className={`theme-swatch theme-swatch--${name}`} />
          <span className="theme-label">{name === 'proof' ? 'Thinkroom' : 'Whitey'}</span>
        </button>
      ))}
    </span>
  )
}
