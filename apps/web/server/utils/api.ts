import type { H3Event } from 'h3'
import { paginationSchema } from '@fx42/contracts'
import { AppError, newId } from '@fx42/shared'
import { ScamError } from '@fx42/application'
import type { ZodType } from 'zod'

export function requestId(): string {
  return `req_${newId()}`
}

export function apiHandler<T>(fn: (event: H3Event) => Promise<T> | T) {
  return defineEventHandler(async (event) => {
    const id = requestId()
    setHeader(event, 'x-request-id', id)
    try {
      return await fn(event)
    } catch (error) {
      if (error instanceof AppError) {
        setResponseStatus(event, error.httpStatus)
        return {
          error: {
            code: error.code,
            message: error.message,
            ...(error.details ? { details: error.details } : {}),
            requestId: id,
          },
        }
      }
      if (error instanceof ScamError) {
        setResponseStatus(event, error.status >= 400 && error.status < 600 ? error.status : 503)
        return {
          error: {
            code:
              error.status === 401 || error.status === 403 ? 'TOKEN_INVALID' : 'SCAM_UNAVAILABLE',
            message: error.message,
            requestId: id,
          },
        }
      }
      if (isZodError(error)) {
        setResponseStatus(event, 400)
        return {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid request',
            details: { issues: error.issues },
            requestId: id,
          },
        }
      }
      console.error(`[${id}]`, error)
      setResponseStatus(event, 500)
      return {
        error: {
          code: 'INTERNAL',
          message: 'Internal error',
          requestId: id,
        },
      }
    }
  })
}

export function isZodError(error: unknown): error is { issues: unknown[] } {
  return (
    typeof error === 'object' &&
    error !== null &&
    'issues' in error &&
    Array.isArray((error as { issues: unknown[] }).issues) &&
    (error as { name?: string }).name === 'ZodError'
  )
}

export async function parseBody<T>(event: H3Event, schema: ZodType<T>): Promise<T> {
  const body = await readBody(event)
  return schema.parse(body)
}

export function parseQuery<T>(event: H3Event, schema: ZodType<T>): T {
  return schema.parse(getQuery(event))
}

export function parsePagination(event: H3Event): { limit: number; offset: number } {
  const query = parseQuery(event, paginationSchema)
  const offset = Number(query.cursor ?? 0)
  return {
    limit: query.limit,
    offset: Number.isFinite(offset) && offset >= 0 ? offset : 0,
  }
}

export function clientIp(event: H3Event): string | null {
  const forwarded = getHeader(event, 'x-forwarded-for')
  if (forwarded) return forwarded.split(',')[0]?.trim() ?? null
  return getRequestIP(event, { xForwardedFor: true }) ?? null
}

export function modeFrom(value: unknown, fallback: 'real' | 'virtual'): 'real' | 'virtual' {
  return value === 'real' || value === 'virtual' ? value : fallback
}
