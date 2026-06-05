import { Head } from '@inertiajs/react'

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
  return (
    <>
      <Head title={doc.title} />
      <div className="doc-page">
        <header className="doc-header">
          <span className="doc-title">{doc.title}</span>
        </header>
        <main className="doc-main">
          {/* Editor mounts here (U4) */}
          <div className="doc-editor" data-slug={doc.slug} />
        </main>
      </div>
    </>
  )
}
