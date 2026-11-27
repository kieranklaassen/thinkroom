import type { CableProvider } from './cable_provider'

export interface DocumentStart {
  provider: Pick<CableProvider, 'synced' | 'bind' | 'on' | 'off'>
  /** The local doc already holds content from the page. */
  hasLocalContent: boolean
  /** The saved source is shown as text, so the editor opens only if it holds
   *  the whole document. */
  sourcePreview: boolean
  /** Takes the seed the page was granted; false when there is none to apply. */
  takeSeed: () => boolean
  /** Opens the editor, running its first bind through `bind`. */
  open: (bind: (build: () => void) => void) => void
  ready: () => void
  /** The page keeps or returns to its preview. */
  unavailable: () => void
}

/**
 * Decides when a document's editor opens, and that it opens whole or not at
 * all. Content the page embeds opens at once. Behind a source preview the
 * editor waits for the handshake, because only then does the local doc hold
 * every stored edit for the first bind to show.
 */
export function startDocument(options: DocumentStart): () => void {
  const { provider, sourcePreview } = options
  let started = false
  let stopped = false
  const start = () => {
    if (started || stopped) return
    started = true
    try {
      options.open((build) => provider.bind(build, { complete: sourcePreview }))
    } catch (error) {
      console.warn('pruf: the editor could not open this document', error)
      options.unavailable()
      return
    }
    options.ready()
  }
  const unavailable = () => {
    if (!stopped) options.unavailable()
  }

  provider.on('unavailable', unavailable)
  if (provider.synced || (options.hasLocalContent && !sourcePreview) || options.takeSeed()) start()
  else provider.on('synced', start)

  return () => {
    stopped = true
    provider.off('synced', start)
    provider.off('unavailable', unavailable)
  }
}
