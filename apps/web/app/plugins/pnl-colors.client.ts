export default defineNuxtPlugin(() => {
  const { applyStored, load } = usePnlColors()
  applyStored()
  onNuxtReady(load)
})
