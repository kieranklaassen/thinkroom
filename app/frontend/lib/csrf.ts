export function csrfToken(): string {
  return (
    document.querySelector<HTMLMetaElement>('meta[name="csrf-token"]')?.content ?? ''
  )
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
    headers: {
      'Content-Type': 'application/json',
      'X-CSRF-Token': csrfToken(),
    },
    body: JSON.stringify(body),
  })
}
