import Decimal from 'decimal.js'
import { normalizedPipSize } from '@fx42/domain'
import type { AppContext } from '@fx42/application'

type ConfigContext = Pick<AppContext, 'config'>

/**
 * The exchange stores and calculates in normalized USD-per-foreign-unit
 * prices. Every external price is presented in FTK, so the price conversion
 * left at the API boundary is the fixed FTK/USD rate. Keeping it here makes
 * the API boundary the single source of user-facing price units.
 */
export function ftkPriceFactor(ctx: ConfigContext): Decimal {
  return new Decimal(1).div(ctx.config.ftkUsdRate)
}

export function ftkPrice(ctx: ConfigContext, value: Decimal.Value): Decimal {
  return new Decimal(value).mul(ftkPriceFactor(ctx))
}

export function ftkPriceForSymbol(
  ctx: ConfigContext,
  symbol: string,
  value: Decimal.Value,
): string {
  const instrument = ctx.config.instruments.find((i) => i.symbol === symbol)
  return ftkPrice(ctx, value).toFixed(instrument?.pricePrecision ?? 8)
}

export function ftkPriceNullable(
  ctx: ConfigContext,
  symbol: string,
  value: string | null | undefined,
): string | null {
  return value === null || value === undefined ? null : ftkPriceForSymbol(ctx, symbol, value)
}

/**
 * Pip size in FTK at the current normalized price. For base=USD instruments
 * the configured native pip is converted to XXX/USD via `pipSize × P²`,
 * where P is the normalized price.
 */
export function ftkPipsForSymbol(ctx: ConfigContext, symbol: string, price: Decimal.Value): string {
  const instrument = ctx.config.instruments.find((i) => i.symbol === symbol)
  if (!instrument) return '0'
  return normalizedPipSize(instrument, price).mul(ftkPriceFactor(ctx)).toString()
}

/** Convert an FTK price entered by a user back to the internal USD price. */
export function nativePrice(ctx: ConfigContext, value: Decimal.Value): Decimal {
  return new Decimal(value).div(ftkPriceFactor(ctx))
}

export function nativePriceString(ctx: ConfigContext, value: Decimal.Value): string {
  return nativePrice(ctx, value).toString()
}
