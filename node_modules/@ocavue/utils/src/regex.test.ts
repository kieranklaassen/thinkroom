// @vitest-environment node

import { describe, expect, it } from 'vitest'

import { supportsRegexLookbehind } from './regex'

describe('supportsRegexLookbehind', () => {
  it('returns a boolean', () => {
    expect(typeof supportsRegexLookbehind()).toBe('boolean')
  })

  it('returns true in modern environments', () => {
    expect(supportsRegexLookbehind()).toBe(true)
  })
})
