import { DirectUpload } from '@rails/activestorage'
import type { Uploader } from '@milkdown/kit/plugin/upload'
import type { Node } from '@milkdown/kit/prose/model'

const DIRECT_UPLOAD_URL = '/rails/active_storage/direct_uploads'

/** Push a file through Active Storage direct upload, resolve to a blob URL. */
export const directUpload = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    new DirectUpload(file, DIRECT_UPLOAD_URL).create((error, blob) => {
      if (error || !blob) reject(error ?? new Error('upload failed'))
      else resolve(`/rails/active_storage/blobs/redirect/${blob.signed_id}/${encodeURIComponent(blob.filename)}`)
    })
  })

/**
 * Paste/drop handler for the Milkdown upload plugin: images go through
 * Active Storage; the resulting URL lands in the image node, which is plain
 * text inside the Yjs doc — so it syncs and survives reload like everything.
 */
export const imageUploader: Uploader = async (files, schema) => {
  const images: File[] = []
  for (let i = 0; i < files.length; i += 1) {
    const file = files.item(i)
    if (file?.type.startsWith('image/')) images.push(file)
  }
  if (images.length === 0) return []

  const nodes = await Promise.all(
    images.map(async (image) => {
      const src = await directUpload(image)
      return schema.nodes.image.createAndFill({ src, alt: image.name }) as Node
    }),
  )
  return nodes.filter(Boolean)
}
