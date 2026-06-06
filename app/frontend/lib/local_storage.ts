/**
 * localStorage with private-mode tolerance: reads fall back, writes are
 * best-effort. One implementation for every stored UI flag/string (panel,
 * focus, editor mode, banner dismissals).
 */
export function getStoredFlag(key: string, fallback: boolean): boolean {
  try {
    const raw = localStorage.getItem(key)
    return raw === null ? fallback : raw === '1'
  } catch {
    return fallback
  }
}

export function setStoredFlag(key: string, value: boolean): void {
  try {
    localStorage.setItem(key, value ? '1' : '0')
  } catch {
    // private mode — the flag just won't persist
  }
}

export function getStoredString(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

export function setStoredString(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    // private mode — the value just won't persist
  }
}
