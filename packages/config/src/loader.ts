import { readFileSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { parseEnv } from 'node:util'
import { parse as parseYaml } from 'yaml'
import { z } from 'zod'
import { configSchema, stableStringify, type Fx42Config } from './schema'

const boolFromEnv = z
  .string()
  .optional()
  .transform((v) => v === '1' || v === 'true')

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    FX42_MODE: z.enum(['production', 'mock']).default('production'),
    DATABASE_PATH: z.string().default('./data/fx42.dev.db'),
    FX42_CONFIG_FILE: z.string().default('./config/fx42.yaml'),
    NUXT_SESSION_PASSWORD: z.string().min(32).optional(),
    NUXT_PUBLIC_BASE_URL: z.string().url().default('http://localhost:3000'),
    FX42_ENCRYPTION_KEY: z.string().optional(),
    SCAM_BASE_URL: z.string().url().default('https://scam.dn42'),
    // The reserve account is a system account, independent of any user.
    // Its token is supplied directly by the operator, never stored in SQLite.
    SCAM_RESERVE_TOKEN: z.string().min(1).optional(),
    SCAM_RESERVE_IBAN: z.string().min(1).optional(),
    BIQUOTE_REST_URL: z.string().url().default('https://biquote.io'),
    BIQUOTE_HUB_URL: z.string().url().default('https://biquote.io/hubs/tick'),
    FX42_ALLOW_RISK_CONFIG_CHANGE: boolFromEnv,
    FX42_CONTROL_SOCKET: z.string().default('/run/fx42/control.sock'),
    LOG_LEVEL: z.string().default('info'),
    METRICS_TOKEN: z.string().default('change-me'),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'production') {
      if (!env.NUXT_SESSION_PASSWORD) {
        ctx.addIssue({
          code: 'custom',
          path: ['NUXT_SESSION_PASSWORD'],
          message: 'required in production',
        })
      }
      if (!env.FX42_ENCRYPTION_KEY) {
        ctx.addIssue({
          code: 'custom',
          path: ['FX42_ENCRYPTION_KEY'],
          message: 'required in production',
        })
      }
      if (env.FX42_ENCRYPTION_KEY) {
        try {
          const bytes = Buffer.from(env.FX42_ENCRYPTION_KEY, 'base64')
          if (bytes.length !== 32) {
            ctx.addIssue({
              code: 'custom',
              path: ['FX42_ENCRYPTION_KEY'],
              message: 'must be base64 of exactly 32 bytes',
            })
          }
        } catch {
          ctx.addIssue({ code: 'custom', path: ['FX42_ENCRYPTION_KEY'], message: 'invalid base64' })
        }
      }
    }
  })

export type Env = z.infer<typeof envSchema>

export interface LoadedConfig {
  config: Fx42Config
  sourceYaml: string
  sourceHash: string
  canonicalJson: string
  canonicalHash: string
  filePath: string
}

export interface LoadOptions {
  filePath?: string
  env?: NodeJS.ProcessEnv
  checkSecrets?: boolean
}

export function loadEnv(env: NodeJS.ProcessEnv = process.env): Env {
  const controlSocketProvided = Boolean(env.FX42_CONTROL_SOCKET)
  const parsed = envSchema.safeParse(env)
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')
    throw new Error(`Invalid environment: ${issues}`)
  }
  // Local/mock development remains usable without configured secrets.
  if (parsed.data.FX42_MODE === 'mock' || parsed.data.NODE_ENV !== 'production') {
    if (!parsed.data.NUXT_SESSION_PASSWORD) {
      parsed.data.NUXT_SESSION_PASSWORD = 'fx42-development-session-password-please-change'
    }
    if (!parsed.data.FX42_ENCRYPTION_KEY) {
      parsed.data.FX42_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64')
    }
    if (!controlSocketProvided && parsed.data.FX42_CONTROL_SOCKET === '/run/fx42/control.sock') {
      parsed.data.FX42_CONTROL_SOCKET = './data/control.sock'
    }
  }
  if (parsed.data.FX42_MODE === 'mock') {
    // Keep these in sync with MockScamClient's built-in reserve account.
    parsed.data.SCAM_RESERVE_TOKEN ??= 'reserve-token'
    parsed.data.SCAM_RESERVE_IBAN ??= 'DN4200420000000000000001'
  }
  return parsed.data
}

/** Load .env files without overriding variables already set by the environment. */
export function loadDotEnvFiles(paths: string[], env: NodeJS.ProcessEnv = process.env): void {
  for (const path of paths) {
    if (!existsSync(path)) continue
    let values: Record<string, string | undefined>
    try {
      values = parseEnv(readFileSync(path, 'utf8'))
    } catch {
      continue
    }
    for (const [key, value] of Object.entries(values)) {
      if (value !== undefined && env[key] === undefined) env[key] = value
    }
  }
}

export function loadConfig(options: LoadOptions = {}): LoadedConfig {
  const env = options.env ?? process.env
  const cwd = process.cwd()
  const requested = options.filePath ?? env.FX42_CONFIG_FILE ?? './config/fx42.yaml'
  const filePath = resolve(cwd, requested)
  if (!existsSync(filePath)) {
    throw new Error(`Config file not found: ${filePath}`)
  }
  const sourceYaml = readFileSync(filePath, 'utf8')
  let raw: unknown
  try {
    raw = parseYaml(sourceYaml)
  } catch (error) {
    throw new Error(`YAML parse error in ${filePath}: ${(error as Error).message}`, {
      cause: error,
    })
  }
  const parsed = configSchema.safeParse(raw)
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n')
    throw new Error(`Invalid config ${filePath}:\n${issues}`)
  }
  const config = parsed.data
  // Validate provider secrets only when explicitly requested (web/runtime startup).
  if (options.checkSecrets !== false) {
    const missing = config.auth.providers
      .filter((p) => p.enabled && !env[p.clientSecretEnv])
      .map((p) => `${p.id} -> ${p.clientSecretEnv}`)
    if (missing.length > 0 && env.FX42_MODE !== 'mock') {
      throw new Error(`Missing OIDC client secrets: ${missing.join(', ')}`)
    }
  }
  const sourceHash = sha256(sourceYaml)
  const canonicalJson = stableStringify(config)
  return {
    config,
    sourceYaml,
    sourceHash,
    canonicalJson,
    canonicalHash: sha256(canonicalJson),
    filePath,
  }
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

export * from './schema'
