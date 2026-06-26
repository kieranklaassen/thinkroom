import { useState } from 'react'

export type ThemeName = 'proof' | 'whitey'

const STORAGE_KEY = 'proof:theme'

function currentTheme(): ThemeName {
  const fromDom = document.documentElement.dataset.theme
  return fromDom === 'whitey' ? 'whitey' : 'proof'
}

/** Apply instantly (no reload), persist for future visits (localStorage +
 *  cookie so the server paints the right theme on first byte). */
function applyTheme(theme: ThemeName): void {
  document.documentElement.dataset.theme = theme
  try {
    localStorage.setItem(STORAGE_KEY, theme)
  } catch {
    // private mode — cookie still covers persistence
  }
  document.cookie = `proof_theme=${theme};path=/;max-age=31536000;samesite=lax`
}

export function ThemePicker() {
  const [theme, setTheme] = useState<ThemeName>(() =>
    typeof document === 'undefined' ? 'proof' : currentTheme(),
  )

  const pick = (next: ThemeName) => {
    setTheme(next)
    applyTheme(next)
  }

  return (
    <span className="theme-picker" role="radiogroup" aria-label="Theme">
      {(['proof', 'whitey'] as ThemeName[]).map((name) => (
        <button
          key={name}
          role="radio"
          aria-checked={theme === name}
          className={`theme-option ${theme === name ? 'is-active' : ''}`}
          onClick={() => pick(name)}
          title={name === 'proof' ? 'Thinkroom — warm paper' : 'Whitey — clean white'}
        >
          <span className={`theme-swatch theme-swatch--${name}`} />
          <span className="theme-label">{name === 'proof' ? 'Thinkroom' : 'Whitey'}</span>
        </button>
      ))}
    </span>
  )
}
