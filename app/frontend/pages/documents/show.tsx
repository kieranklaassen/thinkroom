import { useMemo, useState } from 'react'
import { Head } from '@inertiajs/react'
import {
  DocumentEditor,
  type ConnectionStatus,
  type EditorHandle,
} from '../../editor/milkdown_editor'
import { userIdentity } from '../../editor/identity'

export interface DocumentProps {
  document: {
    id: number
    slug: string
    title: string
    seed_markdown: string | null
    has_state: boolean
  }
  summary: {
    total: number
    human_pct: number
    ai_pct: number
    unreviewed_pct: number
  }
}

export default function DocumentShow({ document: doc }: DocumentProps) {
  const identity = useMemo(userIdentity, [])
  const [status, setStatus] = useState<ConnectionStatus>('connecting')
  const [, setHandle] = useState<EditorHandle | null>(null)

  return (
    <>
      <Head title={doc.title} />
      <div className="doc-page">
        <header className="doc-header">
          <div className="doc-header-left">
            <a href="/" className="doc-home" aria-label="Home">
              P.
            </a>
            <span className="doc-title">{doc.title}</span>
            <span
              className={`doc-status doc-status--${status}`}
              title={status === 'live' ? 'Connected — edits sync live' : 'Connecting…'}
            />
          </div>
          <div className="doc-header-right">{/* presence · share · theme (later units) */}</div>
        </header>
        <main className="doc-body">
          <article className="doc-main">
            <DocumentEditor
              slug={doc.slug}
              identity={identity}
              onReady={setHandle}
              onStatus={setStatus}
            />
          </article>
        </main>
      </div>
    </>
  )
}
