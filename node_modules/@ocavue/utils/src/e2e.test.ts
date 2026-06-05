// @vitest-environment node

import fs from 'node:fs'
import path from 'node:path'

import { x } from 'tinyexec'
import { glob } from 'tinyglobby'
import { describe, it, expect, beforeAll } from 'vitest'

const ROOT_DIR = path.join(import.meta.dirname, '..')
const E2E_OUT_DIR = path.join(ROOT_DIR, 'e2e', 'dist')

describe('e2e', () => {
  beforeAll(async () => {
    await x('pnpm', ['-w', 'build'], {
      nodeOptions: { cwd: ROOT_DIR, stdio: 'inherit' },
      throwOnError: true,
    })
    await x('pnpm', ['--filter', 'e2e', 'run', 'build'], {
      nodeOptions: { cwd: ROOT_DIR, stdio: 'inherit' },
      throwOnError: true,
    })
  })

  it('bundler outputs match snapshot', async () => {
    const files = await glob('**/*', { cwd: E2E_OUT_DIR, onlyFiles: true })
    const output = ['']

    for (const file of files.sort()) {
      const content = fs.readFileSync(path.join(E2E_OUT_DIR, file), 'utf-8')
      output.push('#'.repeat(80), file, '-'.repeat(80), content, '')
    }

    expect(output.join('\n')).toMatchSnapshot()
  })
})
