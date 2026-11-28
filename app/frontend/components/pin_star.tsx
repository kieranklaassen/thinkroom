import { useNotReady } from '../lib/use_not_ready'

export function PinStar({
  title,
  pinned,
  pending,
  onToggle,
  buttonRef,
}: {
  title: string
  pinned: boolean
  pending: boolean
  onToggle: () => void
  buttonRef?: (button: HTMLButtonElement | null) => void
}) {
  const notReady = useNotReady()

  return (
    <button
      ref={buttonRef}
      type="button"
      className={`pin-star${pinned ? ' is-pinned' : ''}${pending ? ' is-pending' : ''}`}
      aria-pressed={pinned}
      aria-busy={pending || undefined}
      aria-label={`${pinned ? 'Unpin' : 'Pin'} ${title}`}
      title={pinned ? 'Unpin' : 'Pin'}
      {...notReady}
      onClick={onToggle}
    >
      <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
        <path
          d="M8 1.5l1.8 3.9 4.2.5-3.1 2.9.8 4.2L8 10.9 4.3 13l.8-4.2L2 5.9l4.2-.5L8 1.5z"
          fill={pinned ? 'currentColor' : 'none'}
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  )
}
