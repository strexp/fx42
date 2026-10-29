import { afterEach, describe, expect, it, vi } from 'vitest'
import { BiquoteClient } from '../src/biquote'

afterEach(() => vi.unstubAllGlobals())

describe('BiquoteClient.latest', () => {
  it('parses the object map returned by /api/latest', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            EURUSD: {
              symbol: 'EURUSD',
              bid: 1.11645,
              ask: 1.11651,
              mid: 1.11648,
              marketState: 'open',
              stale: false,
              quoteAgeSeconds: 1,
              timestamp: '2026-10-29T17:01:45Z',
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      ),
    )
    const client = new BiquoteClient('https://biquote.test')
    const ticks = await client.latest(['EURUSD'])
    expect(ticks).toHaveLength(1)
    expect(ticks[0]).toMatchObject({
      symbol: 'EURUSD',
      bid: '1.11645',
      ask: '1.11651',
      mid: '1.11648',
      marketState: 'open',
    })
  })
})
