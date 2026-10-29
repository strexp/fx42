import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { parseEnv } from 'node:util'

// Nuxt normally reads .env from apps/web, while FX42 keeps it at the repo root.
for (const envPath of [
  fileURLToPath(new URL('../../.env.local', import.meta.url)),
  fileURLToPath(new URL('../../.env', import.meta.url)),
]) {
  if (!existsSync(envPath)) continue
  try {
    for (const [key, value] of Object.entries(parseEnv(readFileSync(envPath, 'utf8')))) {
      if (process.env[key] === undefined) process.env[key] = value
    }
  } catch {
    // ignore malformed env files; the runtime reports configuration errors
  }
}

export default defineNuxtConfig({
  compatibilityDate: '2026-01-01',
  devtools: { enabled: false },
  modules: [
    '@nuxt/ui',
    '@nuxt/icon',
    '@nuxtjs/i18n',
    '@nuxtjs/color-mode',
    'nuxt-auth-utils',
    'nuxt-security',
  ],
  colorMode: { preference: 'dark', fallback: 'dark', classSuffix: '', disableTransition: true },
  css: ['~/assets/css/main.css'],
  app: {
    head: {
      title: 'FX42',
      meta: [{ name: 'viewport', content: 'width=device-width, initial-scale=1' }],
    },
  },
  i18n: {
    strategy: 'no_prefix',
    defaultLocale: 'en',
    locales: [
      { code: 'zh-CN', name: '中文', file: 'zh-CN.json' },
      { code: 'en', name: 'English', file: 'en.json' },
    ],
    detectBrowserLanguage: false,
    bundle: { optimizeTranslationDirective: false },
  },
  nitro: {
    externals: { external: ['better-sqlite3'] },
    experimental: { asyncContext: true },
    esbuild: { options: { target: 'node24' } },
    routeRules: {
      '/sw.js': { headers: { 'cache-control': 'no-cache' } },
      '/manifest.webmanifest': { headers: { 'cache-control': 'public, max-age=3600' } },
      '/offline.html': { headers: { 'cache-control': 'public, max-age=3600' } },
    },
  },
  vite: {
    build: { target: 'es2022' },
  },
  security: {
    csrf: false,
    rateLimiter: false,
    headers: {
      crossOriginEmbedderPolicy: 'unsafe-none',
      contentSecurityPolicy: {
        'default-src': ["'self'"],
        'script-src': ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
        'style-src': ["'self'", "'unsafe-inline'"],
        'img-src': ["'self'", 'data:', 'blob:'],
        'connect-src': ["'self'", 'https:', 'wss:'],
        'font-src': ["'self'", 'data:'],
      },
      xFrameOptions: 'DENY',
      referrerPolicy: 'strict-origin-when-cross-origin',
    },
  },
  typescript: { strict: true, typeCheck: false },
  alias: {
    '@fx42/shared': fileURLToPath(new URL('../../packages/shared/src/index.ts', import.meta.url)),
    '@fx42/contracts': fileURLToPath(
      new URL('../../packages/contracts/src/index.ts', import.meta.url),
    ),
    '@fx42/domain': fileURLToPath(new URL('../../packages/domain/src/index.ts', import.meta.url)),
    '@fx42/config': fileURLToPath(new URL('../../packages/config/src/index.ts', import.meta.url)),
    '@fx42/db': fileURLToPath(new URL('../../packages/db/src/index.ts', import.meta.url)),
    '@fx42/clients': fileURLToPath(new URL('../../packages/clients/src/index.ts', import.meta.url)),
    '@fx42/application': fileURLToPath(
      new URL('../../packages/application/src/index.ts', import.meta.url),
    ),
    '@fx42/runtime': fileURLToPath(new URL('../../packages/runtime/src/index.ts', import.meta.url)),
  },
})
