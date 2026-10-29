export default defineNuxtPlugin(() => {
  if (!('serviceWorker' in navigator)) return
  // Dev mode uses HMR and a different asset graph, so keep the worker out of it.
  if (import.meta.dev) return

  const register = () => {
    navigator.serviceWorker.register('/sw.js').catch((error) => {
      console.warn('[pwa] service worker registration failed', error)
    })
  }

  // Hydration can finish after the load event, so register immediately in that case.
  if (document.readyState === 'complete') register()
  else window.addEventListener('load', register, { once: true })
})
