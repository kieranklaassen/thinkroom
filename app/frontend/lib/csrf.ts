/** Signing in or out in another tab replaces the token this page loaded with;
 *  the cookie is shared by every tab and replaced by those same answers. */
export function csrfToken(): string {
  return (
    cookieToken() ||
    (document.querySelector<HTMLMetaElement>('meta[name="csrf-token"]')?.content ?? '')
  )
}

function cookieToken(): string {
  try {
    const value = /(?:^|;\s*)XSRF-TOKEN=([^;]*)/.exec(document.cookie)?.[1] ?? ''
    return decodeURIComponent(value)
  } catch {
    return ''
  }
}

export function sessionHeaders(): Record<string, string> {
  return {
    'X-CSRF-Token': csrfToken(),
    // The answer can set the session cookie; this makes it set the token with it.
    'X-Requested-With': 'XMLHttpRequest',
  }
}

export function jsonHeaders(): Record<string, string> {
  return {
    // Without it a refusal is a redirect, which fetch follows to another answer.
    Accept: 'application/json',
    'Content-Type': 'application/json',
    ...sessionHeaders(),
  }
}

/** fetch wrappers for non-Inertia JSON endpoints (snapshots, bulk accept). */
export async function postJSON(url: string, body: unknown): Promise<Response> {
  return jsonRequest('POST', url, body)
}

export async function patchJSON(url: string, body: unknown): Promise<Response> {
  return jsonRequest('PATCH', url, body)
}

async function jsonRequest(method: string, url: string, body: unknown): Promise<Response> {
  return fetch(url, {
    method,
    headers: jsonHeaders(),
    body: JSON.stringify(body),
  })
}
