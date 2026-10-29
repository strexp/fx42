import { runtime } from '../utils/runtime'

export default defineEventHandler(() => {
  return runtime().health()
})
