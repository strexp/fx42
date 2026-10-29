export type NotificationPayloads = {
  'margin.warning': { positionId: string; symbol: string; ratio: string }
  'margin.danger': { positionId: string; symbol: string; ratio: string }
  'margin.margin_call': { positionId: string; symbol: string; ratio: string }
  'weekend.margin': {
    positionId: string
    symbol: string
    required: string
    margin: string
  }
  'weekend.closed': { positionId: string; symbol: string; required: string }
  'financing.unpaid': { positionId: string; symbol: string; amount: string }
  'risk.recalculated': { positionId: string; symbol: string; maintenanceRatioBps: number }
  'position.closed': {
    positionId: string
    symbol: string
    closePrice: string
    reason: 'manual' | 'tp' | 'sl' | 'auto' | 'ops' | 'weekend'
    realized: string
    fullyClosed: boolean
  }
  liquidation: { positionId: string; symbol: string; closePrice: string; penalty: string }
  bad_debt: { positionId: string; symbol: string; badDebt: string }
  'deposit.credited': { depositId: string; amount: string }
  'withdrawal.sent': { withdrawalId: string; net: string }
  'withdrawal.failed': { withdrawalId: string; reason: string }
  'reserve.coverage': { coverage: string; balance: number; liabilities: number }
}

export type NotificationKind = keyof NotificationPayloads

export type NotificationItem = {
  id: string
  kind: NotificationKind
  payload: Record<string, unknown>
  readAt: string | null
  createdAt: string
}
