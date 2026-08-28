import type { MilkdownPlugin } from '@milkdown/kit/ctx'
import { highlighterAttr, highlighterSchema } from './mark'
import { highlighterParse, highlighterStringify } from './remark'

// "textHighlighter" to stay clearly apart from ./highlighter.ts (the Shiki
// code-block parser); the ProseMirror mark itself is named "highlighter".
export const textHighlighter: MilkdownPlugin[] = [
  highlighterAttr,
  highlighterSchema,
  highlighterStringify,
  highlighterParse,
].flat()

export * from './palette'
export * from './commands'
export * from './scan'
