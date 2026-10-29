export default defineNuxtPlugin(() => {
  const { applyStored, load } = useUiTheme()
  applyStored()
  onNuxtReady(load)
})
