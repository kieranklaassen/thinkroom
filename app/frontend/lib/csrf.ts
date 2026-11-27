export function csrfToken(): string {
  return (
    document.querySelector<HTMLMetaElement>('meta[name="csrf-token"]')?.content ?? ''
  )
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
