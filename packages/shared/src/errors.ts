export type ErrorCode =
  | 'UNAUTHORIZED'
  | 'SESSION_INVALID'
  | 'OIDC_PROVIDER_UNKNOWN'
  | 'OIDC_PROVIDER_DISABLED'
  | 'OIDC_STATE_INVALID'
  | 'OIDC_CLAIM_MISSING'
  | 'OIDC_IDENTITY_MISMATCH'
  | 'OIDC_SUB_MISSING'
  | 'FORBIDDEN'
  | 'USER_SUSPENDED'
  | 'TOKEN_REQUIRED'
  | 'TERMS_REQUIRED'
  | 'ONBOARDING_REQUIRED'
  | 'ACCOUNT_INVALID'
  | 'TOKEN_INVALID'
  | 'REBIND_BLOCKED'
  | 'VALIDATION_ERROR'
  | 'SYMBOL_DISABLED'
  | 'INVALID_LEVERAGE'
  | 'INVALID_UNITS'
  | 'INVALID_LOTS'
  | 'HALTED'
  | 'WEEKEND_MARGIN'
  | 'DESTINATION_FORBIDDEN'
  | 'ORDER_TOO_SMALL'
  | 'ORDER_TOO_LARGE'
  | 'MARKET_CLOSED'
  | 'MARKET_STALE'
  | 'MARKET_HALTED'
  | 'SPREAD_SPIKE'
  | 'STALE_CLOSE_BLOCKED'
  | 'PRICE_MOVED'
  | 'INSUFFICIENT_BALANCE'
  | 'MARGIN_REQUIRED'
  | 'LEVERAGE_MISMATCH'
  | 'POSITION_LIMIT'
  | 'EXPOSURE_LIMIT'
  | 'POSITION_NOT_FOUND'
  | 'POSITION_CLOSED'
  | 'INVALID_TP_SL'
  | 'IDEMPOTENCY_CONFLICT'
  | 'DEPOSIT_LIMIT'
  | 'RESERVE_INSUFFICIENT'
  | 'SCAM_UNAVAILABLE'
  | 'SCAM_REJECTED'
  | 'RATE_LIMITED'
  | 'DB_BUSY'
  | 'INTERNAL'

const statusByCode: Record<ErrorCode, number> = {
  UNAUTHORIZED: 401,
  SESSION_INVALID: 401,
  OIDC_PROVIDER_UNKNOWN: 404,
  OIDC_PROVIDER_DISABLED: 403,
  OIDC_STATE_INVALID: 400,
  OIDC_CLAIM_MISSING: 403,
  OIDC_IDENTITY_MISMATCH: 403,
  OIDC_SUB_MISSING: 400,
  FORBIDDEN: 403,
  USER_SUSPENDED: 403,
  TOKEN_REQUIRED: 403,
  TERMS_REQUIRED: 403,
  ONBOARDING_REQUIRED: 403,
  ACCOUNT_INVALID: 403,
  TOKEN_INVALID: 400,
  REBIND_BLOCKED: 409,
  VALIDATION_ERROR: 400,
  SYMBOL_DISABLED: 400,
  INVALID_LEVERAGE: 400,
  INVALID_UNITS: 400,
  INVALID_LOTS: 400,
  HALTED: 409,
  WEEKEND_MARGIN: 409,
  DESTINATION_FORBIDDEN: 403,
  ORDER_TOO_SMALL: 400,
  ORDER_TOO_LARGE: 400,
  MARKET_CLOSED: 409,
  MARKET_STALE: 409,
  MARKET_HALTED: 409,
  SPREAD_SPIKE: 409,
  STALE_CLOSE_BLOCKED: 409,
  PRICE_MOVED: 409,
  INSUFFICIENT_BALANCE: 400,
  MARGIN_REQUIRED: 400,
  LEVERAGE_MISMATCH: 400,
  POSITION_LIMIT: 400,
  EXPOSURE_LIMIT: 400,
  POSITION_NOT_FOUND: 404,
  POSITION_CLOSED: 409,
  INVALID_TP_SL: 400,
  IDEMPOTENCY_CONFLICT: 409,
  DEPOSIT_LIMIT: 400,
  RESERVE_INSUFFICIENT: 503,
  SCAM_UNAVAILABLE: 503,
  SCAM_REJECTED: 502,
  RATE_LIMITED: 429,
  DB_BUSY: 503,
  INTERNAL: 500,
}

const messageByCode: Partial<Record<ErrorCode, string>> = {
  UNAUTHORIZED: 'Authentication required',
  SESSION_INVALID: 'Session is no longer valid',
  TERMS_REQUIRED: 'Terms must be accepted first',
  ONBOARDING_REQUIRED: 'Onboarding is not complete',
  TOKEN_REQUIRED: 'A scam.dn42 token is required for real mode',
  TOKEN_INVALID: 'Token is invalid',
  INSUFFICIENT_BALANCE: 'Not enough available balance',
  MARGIN_REQUIRED: 'Margin requirement not met',
  MARKET_CLOSED: 'Market is closed',
  MARKET_STALE: 'Quote is stale',
  STALE_CLOSE_BLOCKED: 'Closing is blocked because the feed is stale',
  HALTED: 'Trading is temporarily halted',
  RATE_LIMITED: 'Too many requests',
  INTERNAL: 'Internal error',
}

export class AppError extends Error {
  readonly code: ErrorCode
  readonly httpStatus: number
  readonly details?: Record<string, unknown>
  readonly requestId?: string

  constructor(
    code: ErrorCode,
    options: { message?: string; details?: Record<string, unknown>; requestId?: string } = {},
  ) {
    super(options.message ?? messageByCode[code] ?? code)
    this.name = 'AppError'
    this.code = code
    this.httpStatus = statusByCode[code]
    this.details = options.details
    this.requestId = options.requestId
  }

  toJSON() {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.details ? { details: this.details } : {}),
        ...(this.requestId ? { requestId: this.requestId } : {}),
      },
    }
  }
}

export function httpStatusForErrorCode(code: ErrorCode): number {
  return statusByCode[code]
}
