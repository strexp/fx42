import type { Fx42Runtime } from '@fx42/runtime'
import { getRuntime } from '@fx42/runtime'
import type { AppContext } from '@fx42/application'

export function runtime(): Fx42Runtime {
  const rt = getRuntime()
  if (!rt) throw new Error('FX42 runtime is not ready')
  return rt
}

export function ctx(): AppContext {
  return runtime().ctx
}
