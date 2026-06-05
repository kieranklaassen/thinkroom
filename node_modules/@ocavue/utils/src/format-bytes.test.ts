// @vitest-environment node

import { describe, expect, it } from 'vitest'

import { formatBytes } from './format-bytes'

describe('formatBytes', () => {
  it('formats bytes correctly', () => {
    expect(formatBytes(0)).toBe('0B')
    expect(formatBytes(100)).toBe('100B')
    expect(formatBytes(512)).toBe('512B')
    expect(formatBytes(1023)).toBe('1023B')
  })

  it('formats kilobytes correctly', () => {
    expect(formatBytes(1024)).toBe('1.0KB')
    expect(formatBytes(1536)).toBe('1.5KB')
    expect(formatBytes(2048)).toBe('2.0KB')
    expect(formatBytes(1024 * 1023)).toBe('1023.0KB')
  })

  it('formats megabytes correctly', () => {
    expect(formatBytes(1024 * 1024)).toBe('1.0MB')
    expect(formatBytes(1024 * 1024 * 1.5)).toBe('1.5MB')
    expect(formatBytes(1024 * 1024 * 2)).toBe('2.0MB')
    expect(formatBytes(1024 * 1024 * 1023)).toBe('1023.0MB')
  })

  it('formats gigabytes correctly', () => {
    expect(formatBytes(1024 * 1024 * 1024)).toBe('1.0GB')
    expect(formatBytes(1024 * 1024 * 1024 * 1.5)).toBe('1.5GB')
    expect(formatBytes(1024 * 1024 * 1024 * 2)).toBe('2.0GB')
  })

  it('handles very large numbers (stays at GB)', () => {
    expect(formatBytes(1024 * 1024 * 1024 * 1024)).toBe('1024.0GB')
    expect(formatBytes(1024 * 1024 * 1024 * 2048)).toBe('2048.0GB')
  })

  it('handles negative numbers', () => {
    expect(formatBytes(-100)).toBe('-100B')
    expect(formatBytes(-1024)).toBe('-1.0KB')
    expect(formatBytes(-1024 * 1024)).toBe('-1.0MB')
    expect(formatBytes(-1024 * 1024 * 1024)).toBe('-1.0GB')
  })

  it('handles decimal inputs', () => {
    expect(formatBytes(100.5)).toBe('100.5B')
    expect(formatBytes(1536.75)).toBe('1.5KB')
  })

  it('handles edge cases around unit boundaries', () => {
    expect(formatBytes(1023.9)).toBe('1023.9B')
    expect(formatBytes(1024.1)).toBe('1.0KB')
    expect(formatBytes(1048575.9)).toBe('1024.0KB')
    expect(formatBytes(1048576.1)).toBe('1.0MB')
  })
})
