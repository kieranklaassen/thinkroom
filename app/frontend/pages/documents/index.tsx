import { useCallback, useState } from 'react'
import { Head, Link, useForm } from '@inertiajs/react'
import { FeedbackButton } from '../../components/feedback_button'
import { userIdentity } from '../../editor/identity'
import { useClaim } from '../../lib/use_claim'

interface DocLink {
  title: string
  slug: string
}

interface RecentDoc extends DocLink {
  claimed: boolean
  claimable: boolean
  owner_name: string | null
  yours: boolean
}

interface Props {
  yours: DocLink[]
  recent: RecentDoc[]
  viewer: { name: string | null; guest: boolean }
}

/**
 * Inline claim icon for a claimable Recent row. On win the scoped reload
 * moves the row to "Your docs"; on a lost race the row re-renders with the
 * winner's name — no error modal (the hook swallows the Inertia error).
 */
function RecentClaimButton({ slug, claimerName }: { slug: string; claimerName: string }) {
  const { claim, claiming, claimFailed } = useClaim(slug, claimerName, {
    only: ['yours', 'recent'],
  })
  return (
    <button
      className="recent-claim"
      aria-label="Claim this document"
      title={claimFailed ? 'Claim failed — try again' : 'Claim this document'}
      disabled={claiming}
      onClick={claim}
    >
      <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
        <path
          d="M8 1.5l1.8 3.9 4.2.5-3.1 2.9.8 4.2L8 10.9 4.3 13l.8-4.2L2 5.9l4.2-.5L8 1.5z"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.2"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  )
}

export default function DocumentsIndex({ yours, recent, viewer }: Props) {
  // Lazy initializer: the chosen session name wins; guests post their
  // random localStorage name as the fallback (the server prefers the
  // session name on create anyway). Staying on useForm keeps the
  // `processing` double-submit guard.
  const { post, processing } = useForm(() => ({ name: userIdentity(viewer.name).name }))
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
          <h1 className="landing-wordmark">
            <Link href="/" className="landing-wordmark-link">
              Pruf
            </Link>
          </h1>
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
          {yours.length > 0 && (
            <section className="landing-recent">
              <h2 className="landing-recent-heading">Your docs</h2>
              <ul>
                {yours.map((doc) => (
                  <li key={doc.slug}>
                    <Link href={`/d/${doc.slug}`} prefetch>
                      {doc.title}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <section className="landing-recent">
            <h2 className="landing-recent-heading">Recent</h2>
            {recent.length > 0 ? (
              <ul>
                {recent.map((doc) => (
                  <li key={doc.slug} className="recent-row">
                    <Link href={`/d/${doc.slug}`} prefetch>
                      {doc.title}
                    </Link>
                    {doc.claimable && (
                      <RecentClaimButton
                        slug={doc.slug}
                        claimerName={userIdentity(viewer.name).name}
                      />
                    )}
                    {doc.claimed && !doc.yours && doc.owner_name && (
                      <span className="recent-owner">Owned by {doc.owner_name}</span>
                    )}
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
