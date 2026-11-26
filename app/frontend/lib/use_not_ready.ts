import { useIsClient } from './use_is_client'

const NOT_READY = { 'aria-disabled': true } as const
const READY = {}

/**
 * Props for a server-rendered control that only the page script can answer.
 * Until hydration it says so; aria-disabled rather than disabled, so it keeps
 * its place in the tab order and React can still replay a click that lands
 * between hydrateRoot and the first commit.
 */
export function useNotReady(): { 'aria-disabled'?: true } {
  return useIsClient() ? READY : NOT_READY
}
