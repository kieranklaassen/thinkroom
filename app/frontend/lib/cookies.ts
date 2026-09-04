/**
 * Server-readable UI-pref persistence. Cookies (not localStorage) are the
 * source of truth for first paint so SSR can render panel/focus/width at their
 * stored values — no post-hydration flip. Document mode is URL-derived. Mirrors the theme cookie convention
 * in theme.ts: path=/, SameSite=Lax, one-year max-age.
 */
const ONE_YEAR_SECONDS = 31536000

export function setCookie(name: string, value: string): void {
  // SSR / non-browser guard — writes are a no-op on the server.
  if (typeof document === 'undefined') return
  try {
    document.cookie = `${name}=${encodeURIComponent(value)};path=/;max-age=${ONE_YEAR_SECONDS};samesite=lax`
  } catch {
    // Browser policy can reject storage. The current in-memory UI still works.
  }
}

export function setCookieFlag(name: string, value: boolean): void {
  setCookie(name, value ? '1' : '0')
}
