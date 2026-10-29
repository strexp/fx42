import { describe, expect, it } from 'vitest'
import { providerSchema } from '../src/schema'

const base = {
  id: 'oauth-dn42',
  kind: 'dn42' as const,
  displayName: 'oauth.dn42',
  issuer: 'https://oauth.dn42',
  clientId: 'client',
  clientSecretEnv: 'FX42_OIDC_SECRET',
  scopes: ['openid', 'dn42'],
  enabled: true,
}

describe('OIDC provider schema', () => {
  it('defaults mntClaim to active_mnt', () => {
    expect(providerSchema.parse(base).mntClaim).toBe('active_mnt')
  })

  it('accepts a custom mntClaim', () => {
    expect(providerSchema.parse({ ...base, mntClaim: 'dn42.mnt' }).mntClaim).toBe('dn42.mnt')
  })

  it('rejects an empty mntClaim', () => {
    expect(() => providerSchema.parse({ ...base, mntClaim: '  ' })).toThrow()
  })
})
