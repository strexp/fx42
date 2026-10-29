import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import type { CryptoPort } from '@fx42/application'

export class AesGcmCrypto implements CryptoPort {
  private readonly key: Buffer

  constructor(base64Key: string, readonly keyVersion = 1) {
    const key = Buffer.from(base64Key, 'base64')
    if (key.length !== 32) throw new Error('FX42_ENCRYPTION_KEY must be 32 bytes (base64)')
    this.key = key
  }

  encrypt(plain: string): { cipher: string; keyVersion: number } {
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', this.key, iv)
    const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
    const tag = cipher.getAuthTag()
    return {
      cipher: `v${this.keyVersion}:${iv.toString('base64')}:${tag.toString('base64')}:${ct.toString('base64')}`,
      keyVersion: this.keyVersion,
    }
  }

  decrypt(cipherText: string, keyVersion = 1): string {
    const parts = cipherText.split(':')
    if (parts.length !== 4) throw new Error('Invalid ciphertext format')
    const [version, ivB64, tagB64, ctB64] = parts
    if (version !== `v${keyVersion}`) throw new Error('Unsupported ciphertext version')
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(ivB64, 'base64'))
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'))
    return Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64')), decipher.final()]).toString('utf8')
  }

  hint(plain: string): string {
    return `…${plain.slice(-4)}`
  }
}

export function randomSecret(bytes = 32): string {
  return randomBytes(bytes).toString('base64')
}
