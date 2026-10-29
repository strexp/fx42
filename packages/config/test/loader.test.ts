import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { loadConfig, loadDotEnvFiles } from '../src/loader'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('dotenv loading', () => {
  it('does not fall back to an example config when the configured file is missing', () => {
    expect(() =>
      loadConfig({ filePath: 'config/does-not-exist.yaml', env: { NODE_ENV: 'test' }, checkSecrets: false }),
    ).toThrow(/Config file not found/)
  })

  it('loads values and does not override the process environment', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fx42-env-'))
    dirs.push(dir)
    const file = join(dir, '.env')
    writeFileSync(file, 'FX42_TEST_SECRET="quoted value"\nFX42_EXISTING=from-file\n')
    const env: NodeJS.ProcessEnv = { FX42_EXISTING: 'from-process' }
    loadDotEnvFiles([file], env)
    expect(env.FX42_TEST_SECRET).toBe('quoted value')
    expect(env.FX42_EXISTING).toBe('from-process')
  })
})
