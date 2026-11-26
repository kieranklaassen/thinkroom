import { warmHighlighter } from './highlighter'
import { warmSketchTools } from './sketch/excalidraw_loader'

/** Start loading what the document's own blocks need, as early as possible:
 * by the time the collab doc binds, sketches render their exact preview into
 * the first painted frame and code is already colored. The server preview is
 * the earliest place a block can be seen. Text documents need neither. */
export const warmForContent = (contentHtml: string): void => {
  if (/<pre[\s>]/.test(contentHtml)) warmHighlighter()
  if (contentHtml.includes('thinkroom-sketch')) warmSketchTools()
}
