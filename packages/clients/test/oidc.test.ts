import { describe, expect, it } from 'vitest'
import { callbackPathFor, discoveryUrlFor, readMntClaim } from '../src/oidc'

describe('OIDC endpoint derivation', () => {
  it('derives the discovery URL from the issuer', () => {
    expect(discoveryUrlFor('https://oauth.dn42')).toBe(
      'https://oauth.dn42/.well-known/openid-configuration',
    )
  })

  it('trims trailing slashes from the issuer', () => {
    expect(discoveryUrlFor('https://oauth.dn42///')).toBe(
      'https://oauth.dn42/.well-known/openid-configuration',
    )
  })

  it('keeps an issuer path component', () => {
    expect(discoveryUrlFor('http://localhost:3000/mock-oidc')).toBe(
      'http://localhost:3000/mock-oidc/.well-known/openid-configuration',
    )
  })

  it('derives the callback path from the provider id', () => {
    expect(callbackPathFor('oauth-dn42')).toBe('/api/auth/oidc/oauth-dn42/callback')
  })
})

describe('readMntClaim', () => {
  it('reads active_mnt from the dn42 claim by default', () => {
    expect(readMntClaim({ dn42: { active_mnt: 'ALICE-MNT' } }, 'active_mnt')).toBe('ALICE-MNT')
  })

  it('falls back to the top-level claim', () => {
    expect(readMntClaim({ active_mnt: 'TOP-MNT' }, 'active_mnt')).toBe('TOP-MNT')
  })

  it('reads a custom field from the dn42 claim', () => {
    expect(readMntClaim({ dn42: { mnt: 'CUSTOM-MNT' } }, 'mnt')).toBe('CUSTOM-MNT')
  })

  it('supports a dotted claim path', () => {
    expect(
      readMntClaim({ resource_access: { dn42: { mnt: 'PATH-MNT' } } }, 'resource_access.dn42.mnt'),
    ).toBe('PATH-MNT')
  })

  it('returns undefined for missing, empty or non-string claims', () => {
    expect(readMntClaim({}, 'active_mnt')).toBeUndefined()
    expect(readMntClaim({ dn42: { active_mnt: '   ' } }, 'active_mnt')).toBeUndefined()
    expect(readMntClaim({ dn42: { active_mnt: 42 } }, 'active_mnt')).toBeUndefined()
  })
})
