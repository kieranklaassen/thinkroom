import { useCallback, useState } from 'react'
import { Head, Link, useForm } from '@inertiajs/react'
import { FeedbackButton } from '../../components/feedback_button'

interface Props {
  recent: { title: string; slug: string }[]
}

export default function DocumentsIndex({ recent }: Props) {
  const { post, processing } = useForm({})
  const [copied, setCopied] = useState(false)

  const origin = typeof window === 'undefined' ? '' : window.location.origin
  const agentInstruction =
    `Create a Pruf document for me: POST ${origin}/api/docs with JSON ` +
    `{"title": "…", "markdown": "# …"} and an X-Agent-Name header. ` +
    `The response includes the share URL — open it and we'll collaborate live. ` +
    `Fetch the share URL (Accept: text/plain) for the full API guide.`

  const copyInstruction = useCallback(() => {
    void navigator.clipboard.writeText(agentInstruction).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    })
  }, [agentInstruction])

  return (
    <>
      <Head title="Pruf" />
      <div className="landing">
        <div className="landing-corner"><FeedbackButton /></div>
        <main className="landing-main">
          <h1 className="landing-wordmark">Pruf</h1>
          <p className="landing-tagline">
            A collaborative editor that remembers who wrote what — humans and AI,
            side by side, every word attributed.
          </p>
          <div className="landing-actions">
            <button
              className="btn btn-primary"
              disabled={processing}
              onClick={() => post('/documents')}
            >
              New document
            </button>
            {recent.some((d) => d.slug === 'demo') && (
              <Link href="/d/demo" className="btn btn-ghost" prefetch>
                Open the demo
              </Link>
            )}
          </div>
          <section className="landing-recent">
            <h2 className="landing-recent-heading">Recent</h2>
            {recent.length > 0 ? (
              <ul>
                {recent.map((doc) => (
                  <li key={doc.slug}>
                    <Link href={`/d/${doc.slug}`} prefetch>
                      {doc.title}
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="landing-recent-empty">
                Documents you open in this browser show up here.
              </p>
            )}
          </section>
          <section className="landing-agent">
            <h2 className="landing-recent-heading">Have an agent start a doc</h2>
            <p className="landing-agent-hint">
              Paste this to any agent that can make HTTP requests:
            </p>
            <div className="landing-agent-block">
              <code>{agentInstruction}</code>
              <button className="share-copy" onClick={copyInstruction}>
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
          </section>
        </main>
      </div>
    </>
  )
}
