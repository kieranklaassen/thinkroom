import type { Uploader } from '@milkdown/kit/plugin/upload'
import type { Node } from '@milkdown/kit/prose/model'

interface UploadResponse {
  src?: string
  error?: string
}

/** Use the same validated upload boundary as agents and return canonical HTML src. */
export const uploadImage = async (file: File, agentName: string): Promise<string> => {
  const form = new FormData()
  form.append('file', file)
  const response = await fetch('/api/uploads', {
    method: 'POST',
    headers: { 'X-Agent-Name': agentName },
    body: form,
  })
  const payload = (await response.json()) as UploadResponse
  if (!response.ok || !payload.src) {
    throw new Error(payload.error ?? `upload failed (${response.status})`)
  }
  return payload.src
}

/**
 * Paste/drop handler for the Milkdown upload plugin: images go through
 * Active Storage; the resulting URL lands in the image node, which is plain
 * text inside the Yjs doc — so it syncs and survives reload like everything.
 */
export const imageUploader = (agentName: string): Uploader => async (files, schema) => {
  const images: File[] = []
  for (let i = 0; i < files.length; i += 1) {
    const file = files.item(i)
    if (file?.type.startsWith('image/')) images.push(file)
  }
  if (images.length === 0) return []

  const nodes = await Promise.all(
    images.map(async (image) => {
      const src = await uploadImage(image, agentName)
      return schema.nodes.image.createAndFill({ src, alt: image.name }) as Node
    }),
  )
  return nodes.filter(Boolean)
}
