import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Head, Link, useForm } from '@inertiajs/react'
import { FeedbackButton } from '../../components/feedback_button'
import { AccountControl } from '../../components/account_control'
import { userIdentity } from '../../editor/identity'
import { useClaim } from '../../lib/use_claim'
import { useIsClient } from '../../lib/use_is_client'
import type { OwnershipPayload } from '../../components/ownership_chip'
import type { ViewerPayload } from '../../types/viewer'

type AgeGroup = 'this_week' | 'earlier'

type DocLink = {
  title: string
  slug: string
  tags: string[]
  created_at: string
  created_label: string
  age_group: AgeGroup
}

type RecentDoc = DocLink & OwnershipPayload

type Props = {
  yours: DocLink[]
  recent: RecentDoc[]
  viewer: ViewerPayload
}

const EARLIER_PREVIEW_LIMIT = 8
const GITHUB_REPOSITORY_URL = 'https://github.com/kieranklaassen/thinkroom'
const GITHUB_PROFILE_URL = 'https://github.com/kieranklaassen'

const errorText = (error: unknown): string | null => {
  if (Array.isArray(error)) return error.find((value) => typeof value === 'string') ?? null
  return typeof error === 'string' ? error : null
}

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

function TagEditor({ document, onClose }: { document: DocLink; onClose: () => void }) {
  const form = useForm(`DocumentTags:${document.slug}`, {
    tags: document.tags.join(', '),
  })
  const tagError = errorText(form.errors.tags)

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    form.transform((data) => ({
      tags: data.tags.split(',').map((tag) => tag.trim()),
    }))
    form.patch(`/d/${document.slug}/tags`, {
      preserveScroll: true,
      only: ['yours', 'recent', 'errors'],
      onSuccess: onClose,
    })
  }

  return (
    <form className="document-tag-editor" onSubmit={submit}>
      <label htmlFor={`tags-${document.slug}`}>Tags</label>
      <div className="document-tag-editor-controls">
        <input
          id={`tags-${document.slug}`}
          value={form.data.tags}
          onChange={(event) => form.setData('tags', event.target.value)}
          placeholder="Research, planning"
          autoFocus
          aria-describedby={`tags-help-${document.slug}`}
          aria-invalid={Boolean(tagError)}
        />
        <button className="document-tag-save" type="submit" disabled={form.processing}>
          {form.processing ? 'Saving…' : 'Save'}
        </button>
        <button
          className="document-tag-cancel"
          type="button"
          onClick={() => {
            form.clearErrors()
            onClose()
          }}
        >
          Cancel
        </button>
      </div>
      <p id={`tags-help-${document.slug}`} className="document-tag-help">
        Up to 8 tags, 32 characters each. Separate with commas.
      </p>
      {tagError && (
        <p className="document-tag-error" role="alert">
          {tagError}
        </p>
      )}
    </form>
  )
}

function DocumentTags({ tags }: { tags: string[] }) {
  if (tags.length === 0) return null

  return (
    <div className="document-tags" aria-label="Tags">
      {tags.map((tag) => (
        <span className="document-tag" key={tag.toLowerCase()}>
          {tag}
        </span>
      ))}
    </div>
  )
}

function DocumentRow({
  document,
  editable = false,
  claimerName,
}: {
  document: DocLink | RecentDoc
  editable?: boolean
  claimerName?: string
}) {
  const [editingTags, setEditingTags] = useState(false)
  const recentDocument = 'claimable' in document ? document : null

  return (
    <li className="document-row">
      <div className="document-row-summary">
        <div className="document-row-copy">
          <Link className="document-row-title" href={`/d/${document.slug}`} prefetch>
            {document.title}
          </Link>
          <time className="document-row-date" dateTime={document.created_at}>
            Created {document.created_label}
          </time>
        </div>
        <div className="document-row-actions">
          {editable && (
            <button
              className="document-tag-edit"
              type="button"
              aria-expanded={editingTags}
              onClick={() => setEditingTags((open) => !open)}
            >
              {document.tags.length > 0 ? 'Edit tags' : '+ Add tag'}
            </button>
          )}
          {recentDocument?.claimable && claimerName && (
            <RecentClaimButton slug={document.slug} claimerName={claimerName} />
          )}
          {recentDocument?.claimed && !recentDocument.yours && recentDocument.owner_name && (
            <span className="recent-owner">Owned by {recentDocument.owner_name}</span>
          )}
        </div>
      </div>
      <DocumentTags tags={document.tags} />
      {editingTags && <TagEditor document={document} onClose={() => setEditingTags(false)} />}
    </li>
  )
}

function DocumentGroup({
  title,
  documents,
  editable,
  claimerName,
}: {
  title: string
  documents: Array<DocLink | RecentDoc>
  editable?: boolean
  claimerName?: string
}) {
  if (documents.length === 0) return null
  const headingId = `document-group-${title.toLowerCase().replace(/\s+/g, '-')}`

  return (
    <section className="document-group" aria-labelledby={headingId}>
      <div className="document-group-heading">
        <h3 id={headingId}>{title}</h3>
        <span>{documents.length}</span>
      </div>
      <ul className="document-list">
        {documents.map((document) => (
          <DocumentRow
            key={document.slug}
            document={document}
            editable={editable}
            claimerName={claimerName}
          />
        ))}
      </ul>
    </section>
  )
}

export default function DocumentsIndex({ yours, recent, viewer }: Props) {
  const [identityName] = useState(() => userIdentity(viewer.name).name)
  const { post, processing } = useForm(() => ({
    name: identityName,
  }))
  const [copied, setCopied] = useState(false)
  const [agentInstructionsOpen, setAgentInstructionsOpen] = useState(false)
  const [selectedTag, setSelectedTag] = useState<string | null>(null)
  const [showAllEarlier, setShowAllEarlier] = useState(false)
  const isClient = useIsClient()

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

  const availableTags = yours.reduce<string[]>((tags, document) => {
    document.tags.forEach((tag) => {
      if (!tags.some((existingTag) => existingTag.toLowerCase() === tag.toLowerCase())) {
        tags.push(tag)
      }
    })
    return tags
  }, [])
  const activeTag = availableTags.includes(selectedTag ?? '') ? selectedTag : null
  const visibleDocuments = activeTag
    ? yours.filter((document) =>
        document.tags.some((tag) => tag.toLowerCase() === activeTag.toLowerCase()),
      )
    : yours
  const thisWeek = visibleDocuments.filter((document) => document.age_group === 'this_week')
  const earlier = visibleDocuments.filter((document) => document.age_group === 'earlier')
  const visibleEarlier =
    showAllEarlier || activeTag ? earlier : earlier.slice(0, EARLIER_PREVIEW_LIMIT)
  const hiddenEarlierCount = earlier.length - visibleEarlier.length
  const claimerName = identityName

  return (
    <>
      <Head title="Thinkroom" />
      <div className="landing">
        <div className="landing-corner">
          <AccountControl viewer={viewer} />
          {isClient && <FeedbackButton />}
        </div>
        <main className="landing-main">
          <header className="landing-hero">
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
              <button
                id="agent-start-trigger"
                className="btn btn-agent"
                type="button"
                aria-expanded={agentInstructionsOpen}
                aria-controls="agent-start-instructions"
                onClick={() => setAgentInstructionsOpen((open) => !open)}
              >
                Have an agent start one
              </button>
              {recent.some((document) => document.slug === 'demo') && (
                <Link href="/d/demo" className="btn btn-ghost" prefetch>
                  Open the demo
                </Link>
              )}
            </div>
          </header>

          {agentInstructionsOpen && (
            <section
              id="agent-start-instructions"
              className="landing-agent"
              aria-labelledby="agent-start-trigger"
            >
              <p className="landing-agent-hint">
                Paste this to any agent that can make HTTP requests:
              </p>
              <div className="landing-agent-block">
                <code>{agentInstruction}</code>
                <button className="share-copy" type="button" onClick={copyInstruction}>
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </div>
            </section>
          )}

          <section className="document-library" aria-labelledby="your-documents-heading">
            <div className="document-library-heading">
              <div>
                <h2 id="your-documents-heading">Your documents</h2>
                <p>{yours.length === 1 ? '1 document' : `${yours.length} documents`}</p>
              </div>
              {availableTags.length > 0 && (
                <div className="document-tag-filters" aria-label="Filter documents by tag">
                  <button
                    className={activeTag === null ? 'is-active' : undefined}
                    type="button"
                    aria-pressed={activeTag === null}
                    onClick={() => setSelectedTag(null)}
                  >
                    All
                  </button>
                  {availableTags.map((tag) => (
                    <button
                      className={activeTag === tag ? 'is-active' : undefined}
                      type="button"
                      key={tag.toLowerCase()}
                      aria-pressed={activeTag === tag}
                      onClick={() => setSelectedTag(tag)}
                    >
                      {tag}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {yours.length === 0 ? (
              <p className="document-library-empty">
                Create a document and it will stay close at hand here.
              </p>
            ) : visibleDocuments.length === 0 ? (
              <p className="document-library-empty">No documents use this tag yet.</p>
            ) : (
              <div className="document-groups">
                <DocumentGroup title="This week" documents={thisWeek} editable />
                <DocumentGroup title="Earlier" documents={visibleEarlier} editable />
                {hiddenEarlierCount > 0 && (
                  <button
                    className="document-reveal"
                    type="button"
                    onClick={() => setShowAllEarlier(true)}
                  >
                    Show {hiddenEarlierCount} more
                  </button>
                )}
              </div>
            )}
          </section>

          {recent.length > 0 && (
            <section className="document-library document-library--recent" aria-labelledby="recent-documents-heading">
              <div className="document-library-heading">
                <div>
                  <h2 id="recent-documents-heading">Recently opened</h2>
                  <p>Documents from this browser</p>
                </div>
              </div>
              <DocumentGroup title="Recent" documents={recent} claimerName={claimerName} />
            </section>
          )}

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
