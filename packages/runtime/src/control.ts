import { createServer, type Server } from 'node:net'
import { chmodSync, existsSync, unlinkSync } from 'node:fs'
import type { Logger } from './logger'

export interface ControlRequest {
  command: string
  [key: string]: unknown
}

export interface ControlResponse {
  ok: boolean
  data?: unknown
  error?: string
}

export class ControlServer {
  private server: Server | null = null

  constructor(
    private readonly socketPath: string,
    private readonly handler: (req: ControlRequest) => Promise<ControlResponse> | ControlResponse,
    private readonly log: Logger,
  ) {}

  start(): void {
    if (existsSync(this.socketPath)) {
      try {
        unlinkSync(this.socketPath)
      } catch {
        // ignore
      }
    }
    this.server = createServer((socket) => {
      let buffer = ''
      socket.on('data', (chunk) => {
        buffer += chunk.toString('utf8')
        let idx: number
        while ((idx = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, idx).trim()
          buffer = buffer.slice(idx + 1)
          if (!line) continue
          void this.handle(line, socket)
        }
      })
      socket.on('error', (error) => this.log.warn({ error: error.message }, 'control socket error'))
    })
    this.server.listen(this.socketPath, () => {
      try {
        chmodSync(this.socketPath, 0o600)
      } catch {
        // ignore
      }
      this.log.info({ socket: this.socketPath }, 'control socket listening')
    })
    this.server.on('error', (error) =>
      this.log.error({ error: error.message }, 'control socket failed'),
    )
  }

  private async handle(line: string, socket: import('node:net').Socket): Promise<void> {
    try {
      const req = JSON.parse(line) as ControlRequest
      const response = await this.handler(req)
      socket.write(`${JSON.stringify(response)}\n`)
    } catch (error) {
      socket.write(`${JSON.stringify({ ok: false, error: (error as Error).message })}\n`)
    }
  }

  stop(): void {
    this.server?.close()
    this.server = null
    if (existsSync(this.socketPath)) {
      try {
        unlinkSync(this.socketPath)
      } catch {
        // ignore
      }
    }
  }
}
