import { useRef, useState, type FormEvent, type MouseEvent as ReactMouseEvent } from 'react'
import { Link, router, useForm } from '@inertiajs/react'
import { useNotReady } from '../lib/use_not_ready'
import { LIST_PROPS, type DocLink } from '../pages/documents/document_lists'
import { PinStar } from './pin_star'
import { RowMenu } from './row_menu'
import { SwipeRow } from './swipe_row'

const errorText = (error: unknown): string | null => {
  if (Array.isArray(error)) return error.find((value) => typeof value === 'string') ?? null
  return typeof error === 'string' ? error : null
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
      only: LIST_PROPS,
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

export function ContentsRow({
  document,
  pinned,
  pending,
  onTogglePin,
  onArchive,
  onDelete,
  swipe,
}: {
  document: DocLink
  pinned: boolean
  pending: boolean
  onTogglePin: () => void
  onArchive: () => void
  onDelete: () => void
  swipe?: { deleting: boolean; onDelete: () => void; closeSignal: number }
}) {
  const notReady = useNotReady()
  const [editingTags, setEditingTags] = useState(false)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const menuButtonRef = useRef<HTMLButtonElement>(null)
  const menuItems = [
    { label: 'Open', onSelect: () => router.visit(`/d/${document.slug}`) },
    { label: pinned ? 'Unpin' : 'Pin', onSelect: onTogglePin },
    { label: document.tags.length > 0 ? 'Edit tags' : 'Add tag', onSelect: () => setEditingTags(true) },
    { label: 'Archive', onSelect: onArchive },
    { label: 'Delete…', onSelect: onDelete, danger: true },
  ]

  const body = (
    <>
      <div className="contents-row-line">
        <PinStar title={document.title} pinned={pinned} pending={pending} onToggle={onTogglePin} />
        <Link className="document-row-title" href={`/d/${document.slug}`} prefetch>
          {document.title}
        </Link>
        <button
          className="document-tag-edit"
          type="button"
          aria-expanded={editingTags}
          {...notReady}
          onClick={() => setEditingTags((open) => !open)}
        >
          {document.tags.length > 0 ? 'Edit tags' : '+ Add tag'}
        </button>
        <span className="contents-leader" aria-hidden="true" />
        <time className="contents-date" dateTime={document.created_at}>
          {document.created_label}
        </time>
        <button
          ref={menuButtonRef}
          className="row-menu-button"
          type="button"
          aria-label={`More actions for ${document.title}`}
          aria-haspopup="menu"
          aria-expanded={menu !== null}
          {...notReady}
          onClick={(event) => {
            const box = event.currentTarget.getBoundingClientRect()
            setMenu({ x: box.right - 208, y: box.bottom + 4 })
          }}
        >
          <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
            <circle cx="3.5" cy="8" r="1.3" fill="currentColor" />
            <circle cx="8" cy="8" r="1.3" fill="currentColor" />
            <circle cx="12.5" cy="8" r="1.3" fill="currentColor" />
          </svg>
        </button>
      </div>
      {document.tags.length > 0 && (
        <div className="contents-row-meta">
          {document.tags.map((tag) => (
            <span className="document-tag" key={tag.toLowerCase()}>
              {tag}
            </span>
          ))}
        </div>
      )}
      {editingTags && <TagEditor document={document} onClose={() => setEditingTags(false)} />}
      {menu && (
        <RowMenu
          label={`Actions for ${document.title}`}
          x={menu.x}
          y={menu.y}
          items={menuItems}
          onClose={(restoreFocus) => {
            setMenu(null)
            if (restoreFocus) menuButtonRef.current?.focus({ preventScroll: true })
          }}
        />
      )}
    </>
  )
  // Right-click anywhere on the row opens the same menu at the pointer.
  const openAtPointer = (event: ReactMouseEvent) => {
    event.preventDefault()
    setMenu({ x: event.clientX, y: event.clientY })
  }

  if (swipe) {
    return (
      <li className="contents-row contents-row--swipe" onContextMenu={openAtPointer}>
        <SwipeRow
          slug={document.slug}
          deleting={swipe.deleting}
          onDelete={swipe.onDelete}
          closeSignal={swipe.closeSignal}
        >
          <div className="swipe-row-padding">{body}</div>
        </SwipeRow>
      </li>
    )
  }

  return (
    <li className="contents-row" onContextMenu={openAtPointer}>
      {body}
    </li>
  )
}
