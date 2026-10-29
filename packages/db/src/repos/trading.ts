import { AppError, newId } from '@fx42/shared'
import {
  mapFill,
  mapLiquidation,
  mapMarginEvent,
  mapOrder,
  mapPosition,
  mapTrigger,
  n,
} from '../database'
import type {
  FillRow,
  LiquidationRow,
  MarginEventRow,
  OrderRow,
  PositionRow,
  TriggerRow,
} from '../types'
import { RepoBase } from './base'

export class TradingRepos extends RepoBase {
  findOrderByClientId(accountId: string, clientOrderId: string): OrderRow | null {
    const row = this.sql
      .prepare('SELECT * FROM orders WHERE account_id = ? AND client_order_id = ?')
      .get(accountId, clientOrderId)
    return row ? mapOrder(row as Record<string, unknown>) : null
  }

  findOrderById(id: string): OrderRow | null {
    const row = this.sql.prepare('SELECT * FROM orders WHERE id = ?').get(id)
    return row ? mapOrder(row as Record<string, unknown>) : null
  }

  createOrder(input: {
    userId: string
    accountId: string
    symbol: string
    side: 'long' | 'short'
    unitsMicros: bigint
    leverage: number
    status: OrderRow['status']
    clientOrderId: string
    filledPrice: string | null
    notionalMicros: bigint
    feeMicros: bigint
    positionId: string | null
    reduceOnly?: boolean
    now: number
  }): OrderRow {
    const id = newId()
    this.sql
      .prepare(
        `INSERT INTO orders
          (id, user_id, account_id, symbol, side, type, reduce_only, units_micros, leverage, limit_price,
           stop_price, status, client_order_id, filled_price, notional_micros, fee_micros, filled_at,
           reject_reason, position_id, expires_at, created_at)
         VALUES (?, ?, ?, ?, ?, 'market', ?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?, ?, NULL, ?, NULL, ?)`,
      )
      .run(
        id,
        input.userId,
        input.accountId,
        input.symbol,
        input.side,
        input.reduceOnly ? 1 : 0,
        input.unitsMicros,
        BigInt(input.leverage),
        input.status,
        input.clientOrderId,
        input.filledPrice,
        input.notionalMicros,
        input.feeMicros,
        input.status === 'filled' ? BigInt(input.now) : null,
        input.positionId,
        BigInt(input.now),
      )
    return this.findOrderById(id)!
  }

  listOrders(accountId: string, limit: number, offset: number, status?: string): OrderRow[] {
    const rows = status
      ? this.sql
          .prepare(
            'SELECT * FROM orders WHERE account_id = ? AND status = ? ORDER BY created_at DESC LIMIT ? OFFSET ?',
          )
          .all(accountId, status, BigInt(limit), BigInt(offset))
      : this.sql
          .prepare(
            'SELECT * FROM orders WHERE account_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?',
          )
          .all(accountId, BigInt(limit), BigInt(offset))
    return (rows as Record<string, unknown>[]).map(mapOrder)
  }

  findOpenPosition(accountId: string, symbol: string): PositionRow | null {
    const row = this.sql
      .prepare("SELECT * FROM positions WHERE account_id = ? AND symbol = ? AND status = 'open'")
      .get(accountId, symbol)
    return row ? mapPosition(row as Record<string, unknown>) : null
  }

  findPositionById(id: string): PositionRow | null {
    const row = this.sql.prepare('SELECT * FROM positions WHERE id = ?').get(id)
    return row ? mapPosition(row as Record<string, unknown>) : null
  }

  listOpenPositionsByAccount(accountId: string): PositionRow[] {
    return (
      this.sql
        .prepare(
          "SELECT * FROM positions WHERE account_id = ? AND status = 'open' ORDER BY opened_at",
        )
        .all(accountId) as Record<string, unknown>[]
    ).map(mapPosition)
  }

  listOpenPositions(): Array<
    PositionRow & { mode: 'real' | 'virtual'; accountMode: 'real' | 'virtual' }
  > {
    const rows = this.sql
      .prepare(
        `SELECT p.*, ta.mode AS account_mode FROM positions p
         JOIN trading_accounts ta ON p.account_id = ta.id
         WHERE p.status = 'open'`,
      )
      .all() as Record<string, unknown>[]
    return rows.map((r) => ({
      ...mapPosition(r),
      mode: r.account_mode as 'real' | 'virtual',
      accountMode: r.account_mode as 'real' | 'virtual',
    }))
  }

  countOpenPositions(accountId: string): number {
    const row = this.sql
      .prepare("SELECT count(*) AS c FROM positions WHERE account_id = ? AND status = 'open'")
      .get(accountId) as { c: bigint }
    return n(row.c)
  }

  createPosition(input: {
    userId: string
    accountId: string
    symbol: string
    side: 'long' | 'short'
    unitsMicros: bigint
    entryPrice: string
    leverage: number
    maintenanceRatioBps: number
    marginMicros: bigint
    openFeeMicros: bigint
    now: number
  }): PositionRow {
    const id = newId()
    this.sql
      .prepare(
        `INSERT INTO positions
          (id, user_id, account_id, symbol, side, units_micros, entry_price, leverage,
           maintenance_ratio_bps, margin_micros, last_financing_at, auto_close_ratio_bps, open_fee_micros,
           realized_pnl_micros, status, close_price, close_reason, opened_at, closed_at, version)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, 0, 'open', NULL, NULL, ?, NULL, 0)`,
      )
      .run(
        id,
        input.userId,
        input.accountId,
        input.symbol,
        input.side,
        input.unitsMicros,
        input.entryPrice,
        BigInt(input.leverage),
        BigInt(input.maintenanceRatioBps),
        input.marginMicros,
        input.openFeeMicros,
        BigInt(input.now),
      )
    return this.findPositionById(id)!
  }

  updatePosition(
    id: string,
    input: {
      unitsMicros?: bigint
      entryPrice?: string
      marginMicros?: bigint
      realizedPnlMicros?: bigint
      autoCloseRatioBps?: number | null
      lastFinancingAt?: number | null
      version: number
    },
  ): PositionRow {
    const sets: string[] = ['version = version + 1']
    const params: unknown[] = []
    if (input.unitsMicros !== undefined) {
      sets.push('units_micros = ?')
      params.push(input.unitsMicros)
    }
    if (input.entryPrice !== undefined) {
      sets.push('entry_price = ?')
      params.push(input.entryPrice)
    }
    if (input.marginMicros !== undefined) {
      sets.push('margin_micros = ?')
      params.push(input.marginMicros)
    }
    if (input.realizedPnlMicros !== undefined) {
      sets.push('realized_pnl_micros = ?')
      params.push(input.realizedPnlMicros)
    }
    if (input.autoCloseRatioBps !== undefined) {
      sets.push('auto_close_ratio_bps = ?')
      params.push(input.autoCloseRatioBps === null ? null : BigInt(input.autoCloseRatioBps))
    }
    if (input.lastFinancingAt !== undefined) {
      sets.push('last_financing_at = ?')
      params.push(input.lastFinancingAt === null ? null : BigInt(input.lastFinancingAt))
    }
    params.push(id, BigInt(input.version))
    const result = this.sql
      .prepare(`UPDATE positions SET ${sets.join(', ')} WHERE id = ? AND version = ?`)
      .run(...params)
    if (Number(result.changes) === 0) {
      throw new AppError('POSITION_CLOSED', { message: 'position version conflict' })
    }
    return this.findPositionById(id)!
  }

  closePosition(
    id: string,
    input: {
      status: 'closed' | 'liquidated'
      closePrice: string
      closeReason: string
      unitsMicros: bigint
      marginMicros: bigint
      realizedPnlMicros: bigint
      now: number
      version: number
    },
  ): PositionRow {
    const result = this.sql
      .prepare(
        `UPDATE positions SET status = ?, close_price = ?, close_reason = ?, units_micros = ?,
           margin_micros = ?, realized_pnl_micros = ?, closed_at = ?, version = version + 1
         WHERE id = ? AND version = ?`,
      )
      .run(
        input.status,
        input.closePrice,
        input.closeReason,
        input.unitsMicros,
        input.marginMicros,
        input.realizedPnlMicros,
        BigInt(input.now),
        id,
        BigInt(input.version),
      )
    if (Number(result.changes) === 0) {
      throw new AppError('POSITION_CLOSED', { message: 'position version conflict' })
    }
    return this.findPositionById(id)!
  }

  updatePositionMaintenanceRatio(positionId: string, maintenanceRatioBps: number): void {
    this.sql
      .prepare('UPDATE positions SET maintenance_ratio_bps = ?, version = version + 1 WHERE id = ?')
      .run(BigInt(maintenanceRatioBps), positionId)
  }

  createFill(input: {
    orderId: string
    userId: string
    accountId: string
    positionId: string | null
    symbol: string
    side: 'long' | 'short'
    action: string
    unitsMicros: bigint
    price: string
    notionalMicros: bigint
    feeMicros: bigint
    realizedPnlMicros: bigint
    now: number
  }): FillRow {
    const id = newId()
    this.sql
      .prepare(
        `INSERT INTO fills
          (id, order_id, user_id, account_id, position_id, symbol, side, action, units_micros, price,
           notional_micros, fee_micros, realized_pnl_micros, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.orderId,
        input.userId,
        input.accountId,
        input.positionId,
        input.symbol,
        input.side,
        input.action,
        input.unitsMicros,
        input.price,
        input.notionalMicros,
        input.feeMicros,
        input.realizedPnlMicros,
        BigInt(input.now),
      )
    const row = this.sql.prepare('SELECT * FROM fills WHERE id = ?').get(id)
    return mapFill(row as Record<string, unknown>)
  }

  listFills(userId: string, limit: number, offset: number): FillRow[] {
    return (
      this.sql
        .prepare('SELECT * FROM fills WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?')
        .all(userId, BigInt(limit), BigInt(offset)) as Record<string, unknown>[]
    ).map(mapFill)
  }

  findFillByOrderId(orderId: string): FillRow | null {
    const row = this.sql.prepare('SELECT * FROM fills WHERE order_id = ?').get(orderId)
    return row ? mapFill(row as Record<string, unknown>) : null
  }

  listFillsByPosition(positionId: string): FillRow[] {
    return (
      this.sql
        .prepare('SELECT * FROM fills WHERE position_id = ? ORDER BY created_at')
        .all(positionId) as Record<string, unknown>[]
    ).map(mapFill)
  }

  listFillPnlSince(
    userId: string,
    since: number,
  ): Array<{ realizedPnlMicros: bigint; createdAt: number }> {
    const rows = this.sql
      .prepare(
        'SELECT realized_pnl_micros, created_at FROM fills WHERE user_id = ? AND created_at >= ?',
      )
      .all(userId, BigInt(since)) as Array<{ realized_pnl_micros: bigint; created_at: bigint }>
    return rows.map((r) => ({
      realizedPnlMicros: r.realized_pnl_micros,
      createdAt: Number(r.created_at),
    }))
  }

  listFinancingChargesForUserSince(
    userId: string,
    since: number,
  ): Array<{ amountMicros: bigint; chargeDate: number }> {
    const rows = this.sql
      .prepare(
        `SELECT f.amount_micros, f.charge_date
         FROM financing_charges f
         JOIN positions p ON f.position_id = p.id
         WHERE p.user_id = ? AND f.charge_date >= ?`,
      )
      .all(userId, BigInt(since)) as Array<{ amount_micros: bigint; charge_date: bigint }>
    return rows.map((r) => ({ amountMicros: r.amount_micros, chargeDate: Number(r.charge_date) }))
  }

  upsertTrigger(positionId: string, kind: 'tp' | 'sl', price: string, now: number): void {
    this.sql
      .prepare(
        "UPDATE price_triggers SET status = 'cancelled' WHERE position_id = ? AND kind = ? AND status = 'active'",
      )
      .run(positionId, kind)
    this.sql
      .prepare(
        `INSERT INTO price_triggers (id, position_id, kind, trigger_price, status, created_at)
         VALUES (?, ?, ?, ?, 'active', ?)`,
      )
      .run(newId(), positionId, kind, price, BigInt(now))
  }

  cancelTriggers(positionId: string): void {
    this.sql
      .prepare(
        "UPDATE price_triggers SET status = 'cancelled' WHERE position_id = ? AND status = 'active'",
      )
      .run(positionId)
  }

  listActiveTriggers(positionId: string): TriggerRow[] {
    return (
      this.sql
        .prepare("SELECT * FROM price_triggers WHERE position_id = ? AND status = 'active'")
        .all(positionId) as Record<string, unknown>[]
    ).map(mapTrigger)
  }

  listAllActiveTriggers(): TriggerRow[] {
    return (
      this.sql.prepare("SELECT * FROM price_triggers WHERE status = 'active'").all() as Record<
        string,
        unknown
      >[]
    ).map(mapTrigger)
  }

  markTrigger(id: string, status: 'triggered' | 'cancelled'): void {
    this.sql.prepare('UPDATE price_triggers SET status = ? WHERE id = ?').run(status, id)
  }

  createMarginEvent(
    positionId: string,
    deltaMicros: bigint,
    reason: string,
    now: number,
  ): MarginEventRow {
    const id = newId()
    this.sql
      .prepare(
        'INSERT INTO position_margin_events (id, position_id, delta_micros, reason, created_at) VALUES (?, ?, ?, ?, ?)',
      )
      .run(id, positionId, deltaMicros, reason, BigInt(now))
    const row = this.sql.prepare('SELECT * FROM position_margin_events WHERE id = ?').get(id)
    return mapMarginEvent(row as Record<string, unknown>)
  }

  createLiquidation(input: {
    positionId: string
    userId: string
    markPrice: string
    closePrice: string
    equityMicros: bigint
    deficitMicros: bigint
    penaltyMicros: bigint
    now: number
  }): LiquidationRow {
    const id = newId()
    this.sql
      .prepare(
        `INSERT INTO liquidations
          (id, position_id, user_id, mark_price, close_price, equity_micros, deficit_micros, penalty_micros, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.positionId,
        input.userId,
        input.markPrice,
        input.closePrice,
        input.equityMicros,
        input.deficitMicros,
        input.penaltyMicros,
        BigInt(input.now),
      )
    const row = this.sql.prepare('SELECT * FROM liquidations WHERE id = ?').get(id)
    return mapLiquidation(row as Record<string, unknown>)
  }

  createFinancingChargeIfAbsent(input: {
    positionId: string
    chargeDate: number
    rateBps: number
    amountMicros: bigint
    ledgerTxId: string
    now: number
  }): boolean {
    const result = this.sql
      .prepare(
        `INSERT OR IGNORE INTO financing_charges
          (id, position_id, charge_date, rate_bps, amount_micros, ledger_tx_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        newId(),
        input.positionId,
        BigInt(input.chargeDate),
        BigInt(input.rateBps),
        input.amountMicros,
        input.ledgerTxId,
        BigInt(input.now),
      )
    return Number(result.changes) > 0
  }

  listFinancingCharges(positionId: string): Array<Record<string, unknown>> {
    return this.sql
      .prepare('SELECT * FROM financing_charges WHERE position_id = ? ORDER BY charge_date')
      .all(positionId) as Record<string, unknown>[]
  }

  netExposureUsd(
    symbol: string,
    mode: 'real' | 'virtual',
    markPrice: string,
    quoteToUsd: string,
  ): number {
    const rows = this.sql
      .prepare(
        `SELECT p.side, p.units_micros FROM positions p
         JOIN trading_accounts ta ON p.account_id = ta.id
         WHERE p.symbol = ? AND p.status = 'open' AND ta.mode = ?`,
      )
      .all(symbol, mode) as Array<{ side: string; units_micros: bigint }>
    const signed = rows.reduce(
      (sum, r) => sum + (r.side === 'long' ? 1 : -1) * (Number(r.units_micros) / 1e8),
      0,
    )
    return signed * Number(markPrice) * Number(quoteToUsd)
  }

  hasOpenPositions(userId: string): boolean {
    const row = this.sql
      .prepare("SELECT count(*) AS c FROM positions WHERE user_id = ? AND status = 'open'")
      .get(userId) as { c: bigint }
    return n(row.c) > 0
  }

  hasPendingFunding(userId: string): boolean {
    const row = this.sql
      .prepare(
        `SELECT (SELECT count(*) FROM deposits WHERE user_id = ? AND status = 'pending') +
                (SELECT count(*) FROM withdrawals WHERE user_id = ? AND status IN ('requested','sending')) AS c`,
      )
      .get(userId, userId) as { c: bigint }
    return n(row.c) > 0
  }
}
