import { ensureRuntime, stopRuntime } from '@fx42/runtime'

export default defineNitroPlugin(async (nitroApp) => {
  await ensureRuntime()
  nitroApp.hooks.hook('close', async () => {
    await stopRuntime()
  })
})
