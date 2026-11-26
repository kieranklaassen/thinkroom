export const isOffline = (): boolean => navigator.onLine === false

let reconnection: Promise<void> | null = null

/** Resolves at once while connected, otherwise on reconnecting. However many
 * callers wait, they share one listener. */
const connected = (): Promise<void> => {
  if (!isOffline()) return Promise.resolve()
  reconnection ??= new Promise((resolve) => {
    window.addEventListener('online', () => {
      reconnection = null
      resolve()
    }, { once: true })
  })
  return reconnection
}

/** Browsers remember a failed dynamic import until reload, so a library import
 * must never start offline. Wraps one into two loaders: `whenOnline` waits for
 * the connection, `now` rejects without importing. A load already started or
 * finished is shared and works offline. */
export const connectedImport = <T>(load: () => Promise<T>) => {
  let current: Promise<T> | null = null

  const start = (): Promise<T> => {
    current ??= load().catch((error: unknown) => {
      current = null
      throw error
    })
    return current
  }
  const whenOnline = async (): Promise<T> => {
    while (!current && isOffline()) await connected()
    return start()
  }
  const now = async (): Promise<T> => {
    if (!current && isOffline()) throw new Error('Offline')
    return start()
  }
  return { now, whenOnline }
}
