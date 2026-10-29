import { uuidv7 } from 'uuidv7'

export function newId(): string {
  return uuidv7()
}

export function shortRef(prefix: string): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  const bytes = crypto.getRandomValues(new Uint8Array(8))
  let suffix = ''
  for (const b of bytes) suffix += alphabet[b % alphabet.length]
  return `${prefix}-${suffix}`
}

export function memoCode(): string {
  return shortRef('FX42')
}

export function withdrawalRef(): string {
  return shortRef('FX42-WD')
}
