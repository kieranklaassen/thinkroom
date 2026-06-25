import { useCallback, useEffect, useState } from 'react'
import { Head, Link, useForm } from '@inertiajs/react'
import { FeedbackButton } from '../../components/feedback_button'
import { AccountControl } from '../../components/account_control'
import { userIdentity } from '../../editor/identity'
import { useClaim } from '../../lib/use_claim'
import { useIsClient } from '../../lib/use_is_client'
import type { OwnershipPayload } from '../../components/ownership_chip'
import type { ViewerPayload } from '../../types/viewer'

interface DocLink {
  title: string
  slug: string
  content_format: 'markdown' | 'html'
}

interface RecentDoc extends DocLink, OwnershipPayload {}

interface Props {
  yours: DocLink[]
  recent: RecentDoc[]
  viewer: ViewerPayload
}

const GITHUB_REPOSITORY_URL = 'https://github.com/kieranklaassen/thinkroom'
const GITHUB_PROFILE_URL = 'https://github.com/kieranklaassen'

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
  const { post, processing } = useForm(() => ({
    name: userIdentity(viewer.name).name,
  }))
  const [copied, setCopied] = useState(false)
  // RiffrecRecorder (the Feedback button) is not SSR-isomorphic — its Node
  // passthrough renders different markup than the browser build, so rendering
  // it on the server would mismatch on hydration. Gate it as a client-only
  // island: the corner shows AccountControl (SSR-safe) on first paint and the
  // Feedback button mounts one frame later, after hydration. On the doc page
  // FeedbackButton lives inside a closed HeaderMenu, so it never renders on
  // first paint there — this gate is only needed where it renders eagerly.
  const isClient = useIsClient()

  // SSR-safe: the server and the client's first render both use an empty
  // origin so the rendered agent instruction matches (no hydration mismatch);
  // the real origin is filled in a post-hydration effect, one frame later.
  const [origin, setOrigin] = useState('')
  useEffect(() => {
    setOrigin(window.location.origin)
  }, [])
  const agentInstruction =
    `Create a Thinkroom document for me: POST ${origin}/api/docs with JSON ` +
    `{"title": "…", "format": "markdown", "content": "# …"} ` +
    `or use "format": "html" with HTML content, plus an X-Agent-Name header. ` +
    `The response includes the share URL — open it and we'll collaborate live. ` +
    `Fetch the share URL (Accept: text/plain) for the full API guide.`

  const copyInstruction = useCallback(() => {
    void navigator.clipboard.writeText(agentInstruction).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    })
  }, [agentInstruction])

  const formatLabel = (format: DocLink['content_format']) =>
    format === 'html' ? 'HTML' : 'Markdown'

  return (
    <>
      <Head title="Thinkroom" />
      <div className="landing">
        <div className="landing-corner">
          <AccountControl viewer={viewer} />
          {isClient && <FeedbackButton />}
        </div>
        <main className="landing-main">
          <h1 className="landing-wordmark">
            <Link href="/" className="landing-wordmark-link">
              Thinkroom
            </Link>
          </h1>
          <p className="landing-tagline">Where deeper thinking compounds.</p>
          <p className="landing-byline">From the creator of Compound Engineering.</p>
          <div className="landing-actions">
            <button
              className="btn btn-primary"
              type="button"
              disabled={processing}
              onClick={() => post('/documents')}
            >
              {processing ? 'Creating…' : 'New document'}
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
                  <li key={doc.slug} className="recent-row">
                    <Link href={`/d/${doc.slug}`} prefetch>
                      {doc.title}
                    </Link>
                    <span className="format-label">{formatLabel(doc.content_format)}</span>
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
                    <span className="format-label">{formatLabel(doc.content_format)}</span>
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
        <footer className="landing-footer">
          <a
            className="landing-github"
            href={GITHUB_REPOSITORY_URL}
            target="_blank"
            rel="noreferrer"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path
                fill="currentColor"
                d="M12 2C6.48 2 2 6.58 2 12.22c0 4.5 2.87 8.32 6.84 9.67.5.1.68-.22.68-.49v-1.91c-2.78.62-3.37-1.21-3.37-1.21-.45-1.18-1.11-1.49-1.11-1.49-.91-.64.07-.62.07-.62 1 .07 1.53 1.05 1.53 1.05.89 1.56 2.34 1.11 2.91.85.09-.66.35-1.11.63-1.36-2.22-.26-4.56-1.14-4.56-5.05 0-1.12.39-2.03 1.03-2.75-.1-.26-.45-1.3.1-2.71 0 0 .84-.28 2.75 1.05A9.35 9.35 0 0 1 12 6.61c.85 0 1.7.12 2.5.34 1.91-1.33 2.75-1.05 2.75-1.05.55 1.41.2 2.45.1 2.71.64.72 1.03 1.63 1.03 2.75 0 3.92-2.34 4.78-4.57 5.04.36.32.68.94.68 1.89v3.11c0 .27.18.59.69.49A10.24 10.24 0 0 0 22 12.22C22 6.58 17.52 2 12 2Z"
              />
            </svg>
            <span>Open source on GitHub</span>
            <span className="landing-github-star" aria-hidden="true">★</span>
          </a>
          <p>
            Made with love <span aria-label="love">❤️</span> in Southern California by{' '}
            <a href={GITHUB_PROFILE_URL} target="_blank" rel="noreferrer">
              Kieran Klaassen
            </a>
          </p>
        </footer>
      </div>
    </>
  )
}
