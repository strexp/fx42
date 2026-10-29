export type JobType =
  | 'liquidation'
  | 'auto-close'
  | 'withdrawal-execute'
  | 'withdrawal-reconcile'
  | 'deposit-sync'
  | 'reserve-monitor'
  | 'financing'
  | 'weekend-review'
  | 'recalc-risk'
  | 'reconcile'
  | 'cleanup'

export type EmptyJobPayload = Record<string, never>

export interface JobPayloads {
  liquidation: { positionId: string; version: number }
  'auto-close': { positionId: string; version: number }
  'withdrawal-execute': { withdrawalId: string }
  'withdrawal-reconcile': EmptyJobPayload
  'deposit-sync': EmptyJobPayload
  'reserve-monitor': EmptyJobPayload
  financing: { chargeDate?: number }
  'weekend-review': EmptyJobPayload
  'recalc-risk': EmptyJobPayload
  reconcile: EmptyJobPayload
  cleanup: EmptyJobPayload
}

export type JobRequest = {
  [K in JobType]: { type: K; payload: JobPayloads[K] }
}[JobType]

export type NoPayloadJob = {
  [K in JobType]: JobPayloads[K] extends EmptyJobPayload ? K : never
}[JobType]
