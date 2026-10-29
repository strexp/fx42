import { createHash } from 'node:crypto'
import * as client from 'openid-client'

export interface OidcProviderDefinition {
  id: string
  kind: 'dn42' | 'generic'
  issuer: string
  clientId: string
  clientSecret: string
  scopes: string[]
  /** Claim field carrying the DN42 MNT, default `active_mnt`. */
  mntClaim?: string
}

/** Derive the OIDC discovery document URL from an issuer. */
export function discoveryUrlFor(issuer: string): string {
  return `${issuer.replace(/\/+$/, '')}/.well-known/openid-configuration`
}

/** Derive the callback path for a provider from its id. */
export function callbackPathFor(providerId: string): string {
  return `/api/auth/oidc/${providerId}/callback`
}

export interface OidcState {
  providerId: string
  state: string
  nonce: string
  codeVerifier: string
  redirectTo: string | null
  createdAt: number
}

export interface OidcClaims {
  sub: string
  name?: string
  preferredUsername?: string
  email?: string
  activeMnt?: string
  activeName?: string
  raw: Record<string, unknown>
}

/**
 * Resolve a string claim used as the MNT.
 *
 * - A plain field name (`active_mnt`) is looked up inside the `dn42` claim
 *   object first, then at the top level, preserving the historical behaviour.
 * - A dotted path (`dn42.mnt`, `resource_access.dn42.mnt`) is resolved from the
 *   root claims object.
 */
export function readMntClaim(raw: Record<string, unknown>, field: string): string | undefined {
  const value = field.includes('.')
    ? field.split('.').reduce<unknown>((current, part) => {
        if (!current || typeof current !== 'object') return undefined
        return (current as Record<string, unknown>)[part]
      }, raw)
    : (() => {
        const dn42 = raw.dn42
        if (dn42 && typeof dn42 === 'object') {
          const nested = (dn42 as Record<string, unknown>)[field]
          if (typeof nested === 'string' && nested.trim()) return nested
        }
        return raw[field]
      })()
  return typeof value === 'string' && value.trim() ? value : undefined
}

export class OidcRegistry {
  private configurations = new Map<string, Promise<client.Configuration>>()
  private definitions = new Map<string, OidcProviderDefinition>()

  constructor(definitions: OidcProviderDefinition[]) {
    for (const def of definitions) this.definitions.set(def.id, def)
  }

  get(id: string): OidcProviderDefinition {
    const def = this.definitions.get(id)
    if (!def) throw new Error(`unknown OIDC provider ${id}`)
    return def
  }

  list(): OidcProviderDefinition[] {
    return [...this.definitions.values()]
  }

  private async configuration(id: string): Promise<client.Configuration> {
    let pending = this.configurations.get(id)
    if (!pending) {
      const def = this.get(id)
      pending = client.discovery(
        new URL(discoveryUrlFor(def.issuer)),
        def.clientId,
        def.clientSecret,
      )
      this.configurations.set(id, pending)
    }
    return pending
  }

  async begin(
    providerId: string,
    baseUrl: string,
    redirectTo: string | null,
  ): Promise<{ url: string; state: OidcState }> {
    const def = this.get(providerId)
    const config = await this.configuration(providerId)
    const state = client.randomState()
    const nonce = client.randomNonce()
    const codeVerifier = client.randomPKCECodeVerifier()
    const codeChallenge = await client.calculatePKCECodeChallenge(codeVerifier)
    const redirectUri = `${baseUrl.replace(/\/$/, '')}${callbackPathFor(providerId)}`
    const url = client.buildAuthorizationUrl(config, {
      redirect_uri: redirectUri,
      scope: def.scopes.join(' '),
      state,
      nonce,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    })
    return {
      url: url.toString(),
      state: {
        providerId,
        state,
        nonce,
        codeVerifier,
        redirectTo,
        createdAt: Date.now(),
      },
    }
  }

  async complete(
    providerId: string,
    currentUrl: string,
    stored: OidcState,
  ): Promise<{ claims: OidcClaims; tokens: client.TokenEndpointResponse }> {
    const def = this.get(providerId)
    const config = await this.configuration(providerId)
    const tokens = await client.authorizationCodeGrant(config, new URL(currentUrl), {
      expectedState: stored.state,
      expectedNonce: stored.nonce,
      pkceCodeVerifier: stored.codeVerifier,
    })
    const idClaims = (tokens.claims() ?? {}) as Record<string, unknown>
    let userinfo: Record<string, unknown> = {}
    if (tokens.access_token) {
      try {
        userinfo = (await client.fetchUserInfo(
          config,
          tokens.access_token,
          (idClaims.sub as string) ?? client.skipSubjectCheck,
        )) as unknown as Record<string, unknown>
      } catch {
        // userinfo is optional; ID token claims are sufficient for login
      }
    }
    const raw = { ...idClaims, ...userinfo }
    const sub = String(raw.sub ?? '')
    if (!sub) throw new Error('OIDC response has no sub')
    const dn42 = raw.dn42 as { active_name?: string } | undefined
    return {
      claims: {
        sub,
        name: (raw.name as string) ?? undefined,
        preferredUsername: (raw.preferred_username as string) ?? undefined,
        email: (raw.email as string) ?? undefined,
        activeMnt: readMntClaim(raw, def.mntClaim ?? 'active_mnt'),
        activeName: dn42?.active_name,
        raw,
      },
      tokens,
    }
  }
}

export function mockClaimsFor(providerId: string, kind: 'dn42' | 'generic'): OidcClaims {
  if (kind === 'dn42') {
    const alt = providerId.includes('alt')
    const activeMnt = 'ALICE-MNT'
    const sub = createHash('sha256').update(`${providerId}/${activeMnt}`).digest('hex')
    return {
      sub,
      name: alt ? 'Alice (alt)' : 'Alice',
      preferredUsername: 'alice',
      email: 'alice@example.dn42',
      activeMnt,
      activeName: 'Alice',
      raw: {},
    }
  }
  return {
    sub: 'mock-subject-bob',
    name: 'Bob',
    preferredUsername: 'bob',
    email: 'bob@example.net',
    raw: {},
  }
}
