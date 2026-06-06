import type { MilkdownPlugin } from '@milkdown/kit/ctx'
import { insertionSchema, deletionSchema, modificationSchema } from './marks'
import { suggestParse, suggestStringify } from './remark'

/**
 * Track-changes foundation: marks + markdown serialization. The interception
 * layer (dispatch wrapper, normalize guard) registers separately — marks must
 * exist for every client regardless of mode so synced suggestions render.
 */
export const suggestChangesMarks: MilkdownPlugin[] = [
  insertionSchema,
  deletionSchema,
  modificationSchema,
  suggestStringify,
  suggestParse,
].flat()

export * from './marks'
export * from './scan'
export * from './commands'
