import type { H3Event } from 'h3'

export interface SseStream {
  send(event: string | null, data: unknown): void
  comment(text: string): void
  end(): void
}

export function openSse(event: H3Event): SseStream {
  const res = event.node.res
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  })

  return {
    send(name, data) {
      const eventLine = name ? `event: ${name}\n` : ''
      res.write(`${eventLine}data: ${JSON.stringify(data)}\n\n`)
    },
    comment(text) {
      res.write(`: ${text}\n\n`)
    },
    end() {
      res.end()
    },
  }
}

/** Open a polling SSE stream and keep it alive until the client disconnects. */
export function streamSse(
  event: H3Event,
  options: {
    intervalMs: number
    heartbeatMs?: number
    send: (sse: SseStream) => void
    onCleanup?: () => void
  },
): Promise<void> {
  const sse = openSse(event)
  options.send(sse)
  const timer = setInterval(() => options.send(sse), options.intervalMs)
  const heartbeat = setInterval(() => sse.comment('ping'), options.heartbeatMs ?? 15_000)
  const cleanup = () => {
    clearInterval(timer)
    clearInterval(heartbeat)
    options.onCleanup?.()
    try {
      sse.end()
    } catch {
      // ignore
    }
  }
  event.node.req.on('close', cleanup)
  event.node.req.on('error', cleanup)
  return new Promise<void>(() => {})
}
