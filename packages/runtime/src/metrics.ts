import { Counter, Gauge, collectDefaultMetrics, type Registry } from 'prom-client'

export interface Metrics {
  liquidationsTotal: { inc: (labels: Record<string, string>) => void }
  reserveCoverage: { set: (v: number) => void }
  jobsPending: { set: (v: number) => void }
  jobsFailed: { inc: () => void }
  ledgerImbalance: { set: (v: number) => void }
}

export function createMetrics(registry: Registry): Metrics {
  collectDefaultMetrics({ register: registry })
  const liquidationsTotal = new Counter({
    name: 'fx42_liquidations_total',
    help: 'Liquidations processed',
    labelNames: ['result'],
    registers: [registry],
  })
  const reserveCoverage = new Gauge({
    name: 'fx42_reserve_coverage_ratio',
    help: 'Reserve coverage',
    registers: [registry],
  })
  const jobsPending = new Gauge({
    name: 'fx42_jobs_pending',
    help: 'Pending jobs',
    registers: [registry],
  })
  const jobsFailed = new Counter({
    name: 'fx42_jobs_failed_total',
    help: 'Failed jobs',
    registers: [registry],
  })
  const ledgerImbalance = new Gauge({
    name: 'fx42_ledger_imbalance',
    help: 'Ledger imbalance',
    registers: [registry],
  })
  return {
    liquidationsTotal: { inc: (labels) => liquidationsTotal.inc(labels) },
    reserveCoverage: { set: (v) => reserveCoverage.set(v) },
    jobsPending: { set: (v) => jobsPending.set(v) },
    jobsFailed: { inc: () => jobsFailed.inc() },
    ledgerImbalance: { set: (v) => ledgerImbalance.set(v) },
  }
}
