import type { OidcState } from '@fx42/clients'

const states = new Map<string, OidcState>()
const TTL = 10 * 60_000

function prune(): void {
  const now = Date.now()
  for (const [key, value] of states) if (now - value.createdAt > TTL) states.delete(key)
}

export function saveState(state: OidcState): string {
  prune()
  const key = crypto.randomUUID()
  states.set(key, state)
  return key
}

export function takeState(key: string): OidcState | null {
  prune()
  const state = states.get(key) ?? null
  if (state) states.delete(key)
  return state
}
