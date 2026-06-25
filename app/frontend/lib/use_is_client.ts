import { useSyncExternalStore } from 'react'

// The server snapshot is always false and the client snapshot is always true,
// so the first client render matches the server (false → no hydration
// mismatch) and the value flips to true on the next commit. Components gate
// browser-only subtrees (the live editor, anything reading window/localStorage
// at render time) behind this so they never render during SSR or the first
// hydration pass.
const subscribe = () => () => {}
const getClientSnapshot = () => true
const getServerSnapshot = () => false

export function useIsClient(): boolean {
  return useSyncExternalStore(subscribe, getClientSnapshot, getServerSnapshot)
}
