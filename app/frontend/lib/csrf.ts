export function csrfToken(): string {
  return (
    document.querySelector<HTMLMetaElement>('meta[name="csrf-token"]')?.content ?? ''
  )
}

/** For a page whose reload brought in a sign-in from another tab: its requests
 *  use the token of the session that reload answered for, which Inertia keeps
 *  in this cookie, instead of the first load's. */
export function adoptSessionCsrfToken(): void {
  const token = document.cookie.match(/(?:^|; )XSRF-TOKEN=([^;]+)/)?.[1]
  const meta = document.querySelector<HTMLMetaElement>('meta[name="csrf-token"]')
  if (token && meta) meta.content = decodeURIComponent(token)
}

export function jsonHeaders(): Record<string, string> {
  return {
    // Without it a refusal is a redirect, which fetch follows to another answer.
    Accept: 'application/json',
    'Content-Type': 'application/json',
    'X-CSRF-Token': csrfToken(),
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
