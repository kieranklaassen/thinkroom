import type { MilkdownPlugin } from '@milkdown/kit/ctx'
import { provenanceAttr, provenanceIdentityCtx, provenanceSchema } from './mark'
import { provenanceParse, provenanceStringify } from './remark'
import { provenanceWriter } from './writer'

export const provenance: MilkdownPlugin[] = [
  provenanceIdentityCtx,
  provenanceAttr,
  provenanceSchema,
  provenanceStringify,
  provenanceParse,
  provenanceWriter,
].flat()

export * from './mark'
export * from './review'
export * from './summary'
export { SKIP_PROVENANCE } from './writer'
