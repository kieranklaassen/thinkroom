import { once } from './once'

/**
 * Checks if current environment supports [regex lookbehind assertion](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Regular_expressions/Lookbehind_assertion).
 *
 * @returns `true` if the current environment supports regex lookbehind assertion, `false` otherwise.
 */
export const supportsRegexLookbehind: () => boolean = /* @__PURE__ */ once(
  () => {
    try {
      return 'ab'.replaceAll(new RegExp('(?<=a)b', 'g'), 'c') === 'ac'
    } catch {
      /* v8 ignore start */
      return false
      /* v8 ignore stop */
    }
  },
)
