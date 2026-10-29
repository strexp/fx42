import { defineCommand, runMain } from 'citty'
import { loadEnv } from '@fx42/config'
import { openDatabase, migrate, DbRepos } from '@fx42/db'
import { systemClock } from '@fx42/shared'

const env = loadEnv(process.env)
const db = openDatabase(env.DATABASE_PATH)
migrate(db, { seed: false })
const repos = new DbRepos(db, systemClock)

const halt = defineCommand({
  meta: { name: 'halt', description: 'Halt opening (or all) trading through the control socket' },
  args: {
    all: { type: 'boolean', default: false },
    reason: { type: 'string', default: 'manual halt' },
  },
  async run({ args }) {
    await sendControl({ command: 'halt', all: args.all, reason: args.reason })
  },
})

const resume = defineCommand({
  meta: { name: 'resume', description: 'Resume trading' },
  args: { reason: { type: 'string', default: 'manual resume' } },
  async run({ args }) {
    await sendControl({ command: 'resume', reason: args.reason })
  },
})

const close = defineCommand({
  meta: { name: 'close', description: 'Close a position at the current market price' },
  args: {
    position: { type: 'positional', required: true },
    reason: { type: 'string', default: 'ops' },
  },
  async run({ args }) {
    await sendControl({ command: 'close', positionId: args.position, reason: args.reason })
  },
})

const status = defineCommand({
  meta: { name: 'status', description: 'Show runtime status via the control socket' },
  async run() {
    await sendControl({ command: 'status' })
  },
})

const adjust = defineCommand({
  meta: { name: 'adjust', description: 'Post a manual adjustment entry' },
  args: {
    user: { type: 'string' },
    to: { type: 'string' },
    amount: { type: 'string', required: true },
    mode: { type: 'string', default: 'real' },
    reason: { type: 'string', required: true },
  },
  run({ args }) {
    const mode = args.mode === 'virtual' ? 'virtual' : 'real'
    const amount = BigInt(Math.round(Number(args.amount) * 1e8))
    const now = Date.now()
    const entries: Array<{ walletId: string; amountMicros: bigint }> = []
    let actor: string | null = null
    if (args.user) {
      const user =
        repos.users.findUserById(args.user) ?? repos.users.findUserByMnt(args.user.toUpperCase())
      if (!user) throw new Error(`user not found: ${args.user}`)
      actor = user.id
      const account = repos.users.findAccountByUserMode(user.id, mode)
      if (!account) throw new Error(`account not found: ${mode}`)
      const wallet = repos.wallets.findUserWallet(account.id)
      if (!wallet) throw new Error('wallet not found')
      entries.push({ walletId: wallet.id, amountMicros: amount })
      entries.push({ walletId: `sys:${mode}:external_reserve`, amountMicros: -amount })
    } else if (args.to) {
      const kind = args.to
      entries.push({ walletId: `sys:${mode}:${kind}`, amountMicros: amount })
      entries.push({ walletId: `sys:${mode}:external_reserve`, amountMicros: -amount })
    } else {
      throw new Error('provide --user or --to')
    }
    const tx = repos.wallets.postLedger({
      mode,
      type: 'adjustment',
      refType: 'ops',
      refId: args.reason,
      memo: args.reason,
      entries,
      now,
    })
    repos.runtime.audit({
      actorId: actor,
      action: 'ops.adjust',
      target: args.user ?? args.to ?? null,
      before: null,
      after: { amount: args.amount, mode, reason: args.reason, tx },
      ip: null,
      now,
    })
    console.log(`adjustment posted: ${tx}`)
  },
})

const user = defineCommand({
  meta: { name: 'user', description: 'Suspend, resume or close a user' },
  args: {
    action: { type: 'positional', required: true },
    identifier: { type: 'positional', required: true },
    reason: { type: 'string', default: '' },
  },
  run({ args }) {
    const found =
      repos.users.findUserById(args.identifier) ??
      repos.users.findUserByMnt(args.identifier.toUpperCase())
    if (!found) throw new Error(`user not found: ${args.identifier}`)
    const statusMap: Record<string, 'active' | 'suspended' | 'closed'> = {
      suspend: 'suspended',
      resume: 'active',
      close: 'closed',
    }
    const next = statusMap[args.action]
    if (!next) throw new Error('action must be suspend|resume|close')
    repos.users.updateUserStatus(found.id, next)
    if (next !== 'active') repos.users.incrementSessionVersion(found.id)
    repos.runtime.audit({
      actorId: null,
      action: `ops.user.${args.action}`,
      target: found.id,
      before: { status: found.status },
      after: { status: next, reason: args.reason },
      ip: null,
      now: Date.now(),
    })
    console.log(`${found.id} -> ${next}`)
  },
})

const unmatched = defineCommand({
  meta: { name: 'unmatched', description: 'Inspect or process unmatched transfers' },
  subCommands: {
    list: defineCommand({
      meta: { name: 'list' },
      run() {
        const rows = repos.funding.listUnmatched('open')
        if (!rows.length) console.log('no unmatched transfers')
        for (const row of rows) console.log(JSON.stringify(row))
      },
    }),
    ignore: defineCommand({
      meta: { name: 'ignore' },
      args: { id: { type: 'positional', required: true } },
      run({ args }) {
        repos.funding.setUnmatchedStatus(args.id, 'ignored')
        repos.runtime.audit({
          actorId: null,
          action: 'ops.unmatched.ignore',
          target: args.id,
          before: null,
          after: null,
          ip: null,
          now: Date.now(),
        })
        console.log(`ignored ${args.id}`)
      },
    }),
    match: defineCommand({
      meta: { name: 'match' },
      args: {
        id: { type: 'positional', required: true },
        user: { type: 'string', required: true },
        mode: { type: 'string', default: 'real' },
      },
      run({ args }) {
        const row = repos.funding.listUnmatched('open').find((r) => r.id === args.id)
        if (!row) throw new Error('unmatched transfer not found')
        const userRow =
          repos.users.findUserById(args.user) ?? repos.users.findUserByMnt(args.user.toUpperCase())
        if (!userRow) throw new Error('user not found')
        const mode = args.mode === 'virtual' ? 'virtual' : 'real'
        const account = repos.users.findAccountByUserMode(userRow.id, mode)
        if (!account) throw new Error('account not found')
        const amount = BigInt(row.amountMicros as bigint)
        const wallet = repos.wallets.findUserWallet(account.id)!
        const now = Date.now()
        const deposit = repos.transaction(() => {
          const created = repos.funding.createDeposit({
            userId: userRow.id,
            accountId: account.id,
            mode,
            method: 'transfer',
            amountMicros: amount,
            requestId: null,
            memoCode: null,
            expiresAt: null,
            status: 'pending',
            now,
          })
          repos.wallets.postLedger({
            mode,
            type: 'deposit',
            refType: 'deposit',
            refId: created.id,
            memo: 'manual unmatched match',
            entries: [
              { walletId: wallet.id, amountMicros: amount },
              { walletId: `sys:${mode}:external_reserve`, amountMicros: -amount },
            ],
            now,
          })
          repos.funding.creditDeposit({
            id: created.id,
            scamTxId: Number(row.scamTxId),
            receivedMicros: amount,
            feeMicros: 0n,
            creditedMicros: amount,
            raw: JSON.stringify(row),
            now,
          })
          repos.funding.setUnmatchedStatus(args.id, 'matched')
          repos.runtime.audit({
            actorId: null,
            action: 'ops.unmatched.match',
            target: args.id,
            before: null,
            after: { userId: userRow.id, depositId: created.id },
            ip: null,
            now,
          })
          return created
        })
        console.log(`matched ${args.id} -> ${deposit.id}`)
      },
    }),
  },
})

const risk = defineCommand({
  meta: { name: 'risk', description: 'Show open positions and risk flags' },
  run() {
    console.log('halt_opening:', repos.runtime.getFlag('halt_opening'))
    console.log('halt_all:', repos.runtime.getFlag('halt_all'))
    console.log(
      'jobs pending:',
      repos.jobs.countJobs('pending'),
      'failed:',
      repos.jobs.countJobs('failed'),
    )
    for (const p of repos.trading.listOpenPositions()) {
      console.log(
        JSON.stringify({
          id: p.id,
          symbol: p.symbol,
          side: p.side,
          units: p.unitsMicros.toString(),
          margin: p.marginMicros.toString(),
          leverage: p.leverage,
          mmr: p.maintenanceRatioBps,
        }),
      )
    }
  },
})

const reserve = defineCommand({
  meta: { name: 'reserve', description: 'Show reserve coverage flag and configured reserve account' },
  run() {
    const iban = env.SCAM_RESERVE_IBAN ?? ''
    console.log('reserve_iban:', iban ? `${iban.slice(0, 10)}…${iban.slice(-4)}` : 'none')
    console.log('coverage_ok:', repos.runtime.getFlag('reserve_coverage_ok'))
  },
})

const main = defineCommand({
  meta: { name: 'fx42-ops', description: 'FX42 operations CLI' },
  subCommands: { halt, resume, close, status, adjust, user, unmatched, risk, reserve },
})

export async function runCli() {
  try {
    await runMain(main)
  } finally {
    db.close()
  }
}

if (process.argv[1]?.endsWith('cli/src/index.ts')) {
  runCli().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}

async function sendControl(payload: Record<string, unknown>): Promise<void> {
  const net = await import('node:net')
  const socketPath = env.FX42_CONTROL_SOCKET
  await new Promise<void>((resolve, reject) => {
    const socket = net.createConnection(socketPath, () => {
      socket.write(`${JSON.stringify(payload)}\n`)
    })
    let buffer = ''
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8')
      if (buffer.includes('\n')) {
        console.log(buffer.trim())
        socket.end()
        resolve()
      }
    })
    socket.on('error', reject)
    socket.on('close', () => resolve())
  })
}
