// Generated from schema.sql. Run `pnpm db:schema` after editing the SQL file.
export const SCHEMA_SQL = String.raw`-- FX42 schema (SQLite 3, STRICT). Amounts are integer micros (1e-8) stored as int64.
-- All timestamps are Unix epoch milliseconds (UTC).

CREATE TABLE IF NOT EXISTS schema_migrations (
  version    INTEGER PRIMARY KEY,
  name       TEXT NOT NULL,
  applied_at INTEGER NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS users (
  id                      TEXT PRIMARY KEY,
  active_mnt              TEXT,
  display_name            TEXT,
  email                   TEXT,
  locale                  TEXT NOT NULL DEFAULT 'en' CHECK (locale IN ('zh-CN','en')),
  status                  TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','closed')),
  session_version         INTEGER NOT NULL DEFAULT 1,
  default_mode            TEXT NOT NULL DEFAULT 'virtual' CHECK (default_mode IN ('real','virtual')),
  onboarding_completed_at INTEGER,
  last_login_at           INTEGER,
  created_at              INTEGER NOT NULL
) STRICT;
CREATE UNIQUE INDEX IF NOT EXISTS users_mnt ON users (active_mnt) WHERE active_mnt IS NOT NULL;

CREATE TABLE IF NOT EXISTS user_identities (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id),
  provider_id   TEXT NOT NULL,
  provider_kind TEXT NOT NULL CHECK (provider_kind IN ('dn42','generic')),
  subject       TEXT NOT NULL,
  active_mnt    TEXT,
  email         TEXT,
  created_at    INTEGER NOT NULL,
  last_login_at INTEGER,
  UNIQUE (provider_id, subject),
  CHECK ((provider_kind = 'dn42' AND active_mnt IS NOT NULL) OR
         (provider_kind = 'generic' AND active_mnt IS NULL))
) STRICT;
CREATE INDEX IF NOT EXISTS user_identities_user ON user_identities (user_id);
CREATE INDEX IF NOT EXISTS user_identities_mnt ON user_identities (active_mnt) WHERE active_mnt IS NOT NULL;

CREATE TABLE IF NOT EXISTS trading_accounts (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id),
  mode       TEXT NOT NULL CHECK (mode IN ('real','virtual')),
  currency   TEXT NOT NULL CHECK (currency IN ('FTK','VFTK')),
  status     TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','closed')),
  created_at INTEGER NOT NULL,
  UNIQUE (user_id, mode),
  CHECK ((mode = 'real' AND currency = 'FTK') OR (mode = 'virtual' AND currency = 'VFTK'))
) STRICT;
CREATE INDEX IF NOT EXISTS trading_accounts_user ON trading_accounts (user_id);

CREATE TABLE IF NOT EXISTS terms_acceptances (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL UNIQUE REFERENCES users(id),
  mode        TEXT NOT NULL CHECK (mode IN ('real','virtual')),
  ip          TEXT,
  user_agent  TEXT,
  accepted_at INTEGER NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS scam_credentials (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id),
  token_cipher  TEXT NOT NULL,
  key_version   INTEGER NOT NULL DEFAULT 1,
  token_hint    TEXT NOT NULL,
  scam_user_id  INTEGER,
  scam_username TEXT,
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','invalid','unverified','revoked')),
  verified_at   INTEGER,
  last_used_at  INTEGER,
  revoked_at    INTEGER,
  created_at    INTEGER NOT NULL
) STRICT;
CREATE UNIQUE INDEX IF NOT EXISTS one_live_credential
  ON scam_credentials (user_id) WHERE status IN ('active','invalid','unverified');
CREATE INDEX IF NOT EXISTS scam_credentials_user ON scam_credentials (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS scam_accounts (
  id                      TEXT PRIMARY KEY,
  credential_id           TEXT NOT NULL REFERENCES scam_credentials(id) ON DELETE CASCADE,
  scam_account_id         INTEGER NOT NULL,
  iban                    TEXT NOT NULL,
  account_name            TEXT,
  balance_snapshot_micros INTEGER,
  is_primary              INTEGER NOT NULL DEFAULT 0 CHECK (is_primary IN (0,1)),
  synced_at               INTEGER,
  UNIQUE (credential_id, scam_account_id)
) STRICT;
CREATE UNIQUE INDEX IF NOT EXISTS one_primary_account
  ON scam_accounts (credential_id) WHERE is_primary = 1;

CREATE TABLE IF NOT EXISTS oidc_tokens (
  identity_id    TEXT PRIMARY KEY REFERENCES user_identities(id) ON DELETE CASCADE,
  access_cipher  TEXT,
  refresh_cipher TEXT,
  key_version    INTEGER NOT NULL DEFAULT 1,
  expires_at     INTEGER,
  updated_at     INTEGER NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS config_snapshots (
  id             TEXT PRIMARY KEY,
  file_path      TEXT NOT NULL,
  source_yaml    TEXT NOT NULL,
  canonical_json TEXT NOT NULL CHECK (json_valid(canonical_json)),
  source_hash    TEXT NOT NULL,
  canonical_hash TEXT NOT NULL,
  loaded_by      TEXT NOT NULL,
  loaded_at      INTEGER NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS config_snapshots_hash ON config_snapshots (source_hash, loaded_at);

CREATE TABLE IF NOT EXISTS market_prices (
  symbol       TEXT PRIMARY KEY,
  bid          TEXT NOT NULL,
  ask          TEXT NOT NULL,
  mid          TEXT NOT NULL,
  quote_to_usd TEXT NOT NULL,
  market_state TEXT NOT NULL CHECK (market_state IN ('open','closed')),
  stale        INTEGER NOT NULL DEFAULT 0 CHECK (stale IN (0,1)),
  quote_age_ms INTEGER NOT NULL,
  source_ts    INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS candles (
  symbol      TEXT NOT NULL,
  interval    TEXT NOT NULL CHECK (interval IN ('1m','5m','15m','30m','1h','4h','1d')),
  open_time   INTEGER NOT NULL,
  open        TEXT NOT NULL,
  high        TEXT NOT NULL,
  low         TEXT NOT NULL,
  close       TEXT NOT NULL,
  tick_volume INTEGER,
  is_open     INTEGER NOT NULL DEFAULT 0 CHECK (is_open IN (0,1)),
  fetched_at  INTEGER NOT NULL,
  PRIMARY KEY (symbol, interval, open_time)
) STRICT;

CREATE TABLE IF NOT EXISTS feed_status (
  id           INTEGER PRIMARY KEY CHECK (id = 1),
  connected    INTEGER NOT NULL DEFAULT 0 CHECK (connected IN (0,1)),
  last_tick_at INTEGER,
  reconnects   INTEGER NOT NULL DEFAULT 0,
  updated_at   INTEGER NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS wallets (
  id             TEXT PRIMARY KEY,
  account_id     TEXT REFERENCES trading_accounts(id),
  mode           TEXT NOT NULL CHECK (mode IN ('real','virtual')),
  kind           TEXT NOT NULL CHECK (kind IN ('user','fee_income','insurance_fund','external_reserve',
                                               'withdrawal_pending','margin_pool','exchange_pnl','bad_debt')),
  balance_micros INTEGER NOT NULL DEFAULT 0,
  allow_negative INTEGER NOT NULL DEFAULT 0 CHECK (allow_negative IN (0,1)),
  updated_at     INTEGER NOT NULL,
  CHECK (allow_negative = 1 OR balance_micros >= 0),
  CHECK ((account_id IS NOT NULL AND kind = 'user') OR (account_id IS NULL AND kind <> 'user'))
) STRICT;
CREATE UNIQUE INDEX IF NOT EXISTS wallets_account ON wallets (account_id) WHERE account_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS wallets_system ON wallets (kind, mode) WHERE account_id IS NULL;

CREATE TABLE IF NOT EXISTS ledger_txs (
  id           TEXT PRIMARY KEY,
  mode         TEXT NOT NULL CHECK (mode IN ('real','virtual')),
  type         TEXT NOT NULL,
  ref_type     TEXT NOT NULL,
  ref_id       TEXT,
  memo         TEXT,
  entry_count  INTEGER NOT NULL DEFAULT 0,
  total_micros INTEGER NOT NULL DEFAULT 0,
  finalized    INTEGER NOT NULL DEFAULT 0 CHECK (finalized IN (0,1)),
  created_at   INTEGER NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS ledger_txs_ref ON ledger_txs (ref_type, ref_id);

CREATE TABLE IF NOT EXISTS ledger_entries (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  tx_id                TEXT NOT NULL REFERENCES ledger_txs(id),
  wallet_id            TEXT NOT NULL REFERENCES wallets(id),
  amount_micros        INTEGER NOT NULL,
  balance_after_micros INTEGER NOT NULL,
  created_at           INTEGER NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS ledger_entries_wallet ON ledger_entries (wallet_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ledger_entries_tx ON ledger_entries (tx_id);

CREATE TRIGGER IF NOT EXISTS ledger_entries_ins AFTER INSERT ON ledger_entries BEGIN
  UPDATE ledger_txs
     SET entry_count = entry_count + 1,
         total_micros = total_micros + NEW.amount_micros
   WHERE id = NEW.tx_id AND finalized = 0;
  SELECT CASE WHEN changes() = 0 THEN RAISE(ABORT, 'ledger tx finalized or missing') END;
END;

CREATE TRIGGER IF NOT EXISTS ledger_txs_finalize BEFORE UPDATE OF finalized ON ledger_txs
WHEN NEW.finalized = 1 AND OLD.finalized = 0 BEGIN
  SELECT CASE WHEN NEW.entry_count < 2 OR NEW.total_micros <> 0
    THEN RAISE(ABORT, 'unbalanced ledger tx') END;
END;

CREATE TRIGGER IF NOT EXISTS ledger_entries_no_update BEFORE UPDATE ON ledger_entries BEGIN
  SELECT RAISE(ABORT, 'ledger entries are immutable');
END;

CREATE TRIGGER IF NOT EXISTS ledger_entries_no_delete BEFORE DELETE ON ledger_entries BEGIN
  SELECT RAISE(ABORT, 'ledger entries are immutable');
END;

CREATE TRIGGER IF NOT EXISTS ledger_entries_mode_check BEFORE INSERT ON ledger_entries
WHEN (SELECT mode FROM wallets WHERE id = NEW.wallet_id) <>
     (SELECT mode FROM ledger_txs WHERE id = NEW.tx_id)
BEGIN
  SELECT RAISE(ABORT, 'ledger mode mismatch');
END;

CREATE TRIGGER IF NOT EXISTS ledger_txs_no_unfinalize BEFORE UPDATE OF finalized ON ledger_txs
WHEN OLD.finalized = 1 AND NEW.finalized = 0 BEGIN
  SELECT RAISE(ABORT, 'ledger tx cannot be unfinalized');
END;

CREATE TABLE IF NOT EXISTS orders (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES users(id),
  account_id      TEXT NOT NULL REFERENCES trading_accounts(id),
  symbol          TEXT NOT NULL,
  side            TEXT NOT NULL CHECK (side IN ('long','short')),
  type            TEXT NOT NULL CHECK (type IN ('market','limit','stop')),
  reduce_only     INTEGER NOT NULL DEFAULT 0 CHECK (reduce_only IN (0,1)),
  units_micros    INTEGER NOT NULL CHECK (units_micros > 0),
  leverage        INTEGER NOT NULL,
  limit_price     TEXT,
  stop_price      TEXT,
  status          TEXT NOT NULL CHECK (status IN ('pending','filled','cancelled','rejected','expired')),
  client_order_id TEXT NOT NULL,
  filled_price    TEXT,
  notional_micros INTEGER NOT NULL DEFAULT 0,
  fee_micros      INTEGER NOT NULL DEFAULT 0,
  filled_at       INTEGER,
  reject_reason   TEXT,
  position_id     TEXT,
  expires_at      INTEGER,
  created_at      INTEGER NOT NULL,
  UNIQUE (account_id, client_order_id)
) STRICT;
CREATE INDEX IF NOT EXISTS orders_pending ON orders (status, symbol) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS orders_user ON orders (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS positions (
  id                    TEXT PRIMARY KEY,
  user_id               TEXT NOT NULL REFERENCES users(id),
  account_id            TEXT NOT NULL REFERENCES trading_accounts(id),
  symbol                TEXT NOT NULL,
  side                  TEXT NOT NULL CHECK (side IN ('long','short')),
  units_micros          INTEGER NOT NULL CHECK (units_micros >= 0),
  entry_price           TEXT NOT NULL,
  leverage              INTEGER NOT NULL,
  maintenance_ratio_bps INTEGER NOT NULL,
  margin_micros         INTEGER NOT NULL CHECK (margin_micros >= 0),
  last_financing_at     INTEGER,
  auto_close_ratio_bps  INTEGER,
  open_fee_micros       INTEGER NOT NULL DEFAULT 0,
  realized_pnl_micros   INTEGER NOT NULL DEFAULT 0,
  status                TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed','liquidated')),
  close_price           TEXT,
  close_reason          TEXT,
  opened_at             INTEGER NOT NULL,
  closed_at             INTEGER,
  version               INTEGER NOT NULL DEFAULT 0
) STRICT;
CREATE INDEX IF NOT EXISTS positions_user_status ON positions (user_id, status);
CREATE INDEX IF NOT EXISTS positions_symbol_open ON positions (symbol, status) WHERE status = 'open';
CREATE UNIQUE INDEX IF NOT EXISTS one_open_position
  ON positions (account_id, symbol) WHERE status = 'open';

CREATE TABLE IF NOT EXISTS fills (
  id                  TEXT PRIMARY KEY,
  order_id            TEXT NOT NULL REFERENCES orders(id),
  user_id             TEXT NOT NULL REFERENCES users(id),
  account_id          TEXT NOT NULL REFERENCES trading_accounts(id),
  position_id         TEXT REFERENCES positions(id),
  symbol              TEXT NOT NULL,
  side                TEXT NOT NULL CHECK (side IN ('long','short')),
  action              TEXT NOT NULL CHECK (action IN ('open','close','increase','reduce','flip')),
  units_micros        INTEGER NOT NULL,
  price               TEXT NOT NULL,
  notional_micros     INTEGER NOT NULL,
  fee_micros          INTEGER NOT NULL,
  realized_pnl_micros INTEGER NOT NULL DEFAULT 0,
  created_at          INTEGER NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS fills_user_time ON fills (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS fills_position ON fills (position_id);

CREATE TABLE IF NOT EXISTS financing_charges (
  id            TEXT PRIMARY KEY,
  position_id   TEXT NOT NULL REFERENCES positions(id),
  charge_date   INTEGER NOT NULL,
  rate_bps      INTEGER NOT NULL,
  amount_micros INTEGER NOT NULL,
  ledger_tx_id  TEXT REFERENCES ledger_txs(id),
  created_at    INTEGER NOT NULL,
  UNIQUE (position_id, charge_date)
) STRICT;

CREATE TABLE IF NOT EXISTS position_margin_events (
  id           TEXT PRIMARY KEY,
  position_id  TEXT NOT NULL REFERENCES positions(id),
  delta_micros INTEGER NOT NULL,
  reason       TEXT NOT NULL CHECK (reason IN ('add','remove','liquidation','financing','weekend_add','weekend_reduce')),
  created_at   INTEGER NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS price_triggers (
  id            TEXT PRIMARY KEY,
  position_id   TEXT NOT NULL REFERENCES positions(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL CHECK (kind IN ('tp','sl')),
  trigger_price TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','triggered','cancelled')),
  created_at    INTEGER NOT NULL
) STRICT;
CREATE UNIQUE INDEX IF NOT EXISTS one_active_trigger
  ON price_triggers (position_id, kind) WHERE status = 'active';

CREATE TABLE IF NOT EXISTS liquidations (
  id             TEXT PRIMARY KEY,
  position_id    TEXT NOT NULL REFERENCES positions(id),
  user_id        TEXT NOT NULL REFERENCES users(id),
  mark_price     TEXT NOT NULL,
  close_price    TEXT NOT NULL,
  equity_micros  INTEGER NOT NULL,
  deficit_micros INTEGER NOT NULL DEFAULT 0,
  penalty_micros INTEGER NOT NULL DEFAULT 0,
  created_at     INTEGER NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS deposits (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES users(id),
  account_id      TEXT NOT NULL REFERENCES trading_accounts(id),
  mode            TEXT NOT NULL CHECK (mode IN ('real','virtual')),
  method          TEXT NOT NULL CHECK (method IN ('transfer','virtual')),
  scam_tx_id      INTEGER UNIQUE,
  amount_micros   INTEGER NOT NULL CHECK (amount_micros > 0),
  received_micros INTEGER,
  fee_micros      INTEGER NOT NULL DEFAULT 0,
  credited_micros INTEGER,
  request_id      TEXT,
  status          TEXT NOT NULL CHECK (status IN ('pending','credited','expired','cancelled','failed')),
  memo_code       TEXT UNIQUE,
  expires_at      INTEGER,
  raw             TEXT CHECK (raw IS NULL OR json_valid(raw)),
  created_at      INTEGER NOT NULL,
  credited_at     INTEGER
) STRICT;
CREATE INDEX IF NOT EXISTS deposits_pending ON deposits (status, expires_at);
CREATE UNIQUE INDEX IF NOT EXISTS deposits_request ON deposits (account_id, request_id);
CREATE INDEX IF NOT EXISTS deposits_user ON deposits (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS withdrawals (
  id                     TEXT PRIMARY KEY,
  user_id                TEXT NOT NULL REFERENCES users(id),
  account_id             TEXT NOT NULL REFERENCES trading_accounts(id),
  mode                   TEXT NOT NULL CHECK (mode IN ('real','virtual')),
  amount_micros          INTEGER NOT NULL CHECK (amount_micros > 0),
  fee_micros             INTEGER NOT NULL,
  net_micros             INTEGER NOT NULL CHECK (net_micros > 0),
  destination_account_id TEXT REFERENCES scam_accounts(id) ON DELETE SET NULL,
  destination_iban       TEXT,
  status                 TEXT NOT NULL CHECK (status IN ('requested','sending','sent','settled','failed','cancelled')),
  idempotency_key        TEXT NOT NULL UNIQUE,
  scam_ref               TEXT UNIQUE,
  scam_tx_id             INTEGER UNIQUE,
  error                  TEXT,
  requested_at           INTEGER NOT NULL,
  sent_at                INTEGER
) STRICT;
CREATE INDEX IF NOT EXISTS withdrawals_status ON withdrawals (status, requested_at);
CREATE INDEX IF NOT EXISTS withdrawals_user ON withdrawals (user_id, requested_at DESC);

CREATE TABLE IF NOT EXISTS unmatched_transfers (
  id            TEXT PRIMARY KEY,
  scam_tx_id    INTEGER NOT NULL UNIQUE,
  from_account  TEXT,
  amount_micros INTEGER NOT NULL,
  description   TEXT,
  reason        TEXT NOT NULL DEFAULT 'unknown'
                  CHECK (reason IN ('no_memo','unknown_memo','memo_already_credited','expired','sender_mismatch','cancelled','other')),
  status        TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','matched','ignored')),
  created_at    INTEGER NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS deposit_sync_state (
  id              INTEGER PRIMARY KEY CHECK (id = 1),
  last_scam_tx_id INTEGER,
  last_scan_at    INTEGER,
  updated_at      INTEGER NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS notifications (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id),
  kind       TEXT NOT NULL,
  payload    TEXT NOT NULL CHECK (json_valid(payload)),
  read_at    INTEGER,
  created_at INTEGER NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS notifications_user ON notifications (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS audit_logs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id   TEXT REFERENCES users(id),
  action     TEXT NOT NULL,
  target     TEXT,
  before     TEXT CHECK (before IS NULL OR json_valid(before)),
  after      TEXT CHECK (after IS NULL OR json_valid(after)),
  ip         TEXT,
  created_at INTEGER NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS audit_actor ON audit_logs (actor_id, created_at DESC);

CREATE TABLE IF NOT EXISTS jobs (
  id           TEXT PRIMARY KEY,
  type         TEXT NOT NULL,
  priority     INTEGER NOT NULL DEFAULT 100,
  payload      TEXT NOT NULL CHECK (json_valid(payload)),
  dedupe_key   TEXT,
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','done','failed')),
  run_at       INTEGER NOT NULL,
  attempts     INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  locked_at    INTEGER,
  last_error   TEXT,
  created_at   INTEGER NOT NULL,
  finished_at  INTEGER
) STRICT;
CREATE INDEX IF NOT EXISTS jobs_ready ON jobs (status, priority, run_at);
CREATE UNIQUE INDEX IF NOT EXISTS jobs_active_dedupe ON jobs (type, dedupe_key)
  WHERE dedupe_key IS NOT NULL AND status IN ('pending','running');

CREATE TABLE IF NOT EXISTS runtime_flags (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  reason     TEXT,
  updated_by TEXT,
  updated_at INTEGER NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS reconciliation_reports (
  id         TEXT PRIMARY KEY,
  kind       TEXT NOT NULL,
  ok         INTEGER NOT NULL CHECK (ok IN (0,1)),
  details    TEXT CHECK (details IS NULL OR json_valid(details)),
  created_at INTEGER NOT NULL
) STRICT;
`
