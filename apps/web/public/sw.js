const CACHE_NAME = 'fx42-pwa-v1'
const OFFLINE_URL = '/offline.html'
const PRECACHE_URLS = [
  OFFLINE_URL,
  '/manifest.webmanifest',
  '/favicon-dark.svg',
  '/favicon-light.svg',
  '/icons/apple-touch-icon.png',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-192.png',
  '/icons/icon-maskable-512.png',
]

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME)
      await cache.addAll(PRECACHE_URLS)
      await self.skipWaiting()
    })(),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys()
      await Promise.all(
        names.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name)),
      )
      await self.clients.claim()
    })(),
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return
  // API responses and SSE streams are always live and must never be cached.
  if (url.pathname.startsWith('/api/')) return

  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          return await fetch(request)
        } catch {
          const cache = await caches.open(CACHE_NAME)
          return (await cache.match(OFFLINE_URL)) ?? Response.error()
        }
      })(),
    )
    return
  }

  // App icons, the manifest and the favicon are immutable per deploy and safe to
  // serve from the cache first, refreshing the entry in the background.
  if (
    url.pathname === '/manifest.webmanifest' ||
    url.pathname.startsWith('/icons/') ||
    url.pathname.startsWith('/favicon-')
  ) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_NAME)
        const cached = await cache.match(request)
        const refresh = fetch(request)
          .then((response) => {
            if (response.ok) return cache.put(request, response.clone())
            return undefined
          })
          .catch(() => undefined)

        if (cached) {
          event.waitUntil(refresh)
          return cached
        }

        await refresh
        return (await cache.match(request)) ?? Response.error()
      })(),
    )
  }
})
