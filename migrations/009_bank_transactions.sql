-- Migration 009 — Table bank_transactions
-- Import des relevés bancaires Belfius (CODA .CD2)

CREATE TABLE IF NOT EXISTS bank_transactions (
  id                   SERIAL PRIMARY KEY,
  account_iban         VARCHAR(34) NOT NULL,
  transaction_date     DATE NOT NULL,
  value_date           DATE,
  movement_number      INTEGER NOT NULL,
  bank_reference       VARCHAR(50),
  direction            VARCHAR(6) NOT NULL CHECK (direction IN ('CREDIT','DEBIT')),
  amount               NUMERIC(12,3) NOT NULL,   -- toujours positif
  signed_amount        NUMERIC(12,3) NOT NULL,   -- positif=entrant, négatif=sortant
  currency             VARCHAR(3) DEFAULT 'EUR',
  description          TEXT,
  counterparty_iban    VARCHAR(50),
  counterparty_name    TEXT,
  narrative            TEXT,
  source_file          TEXT NOT NULL,
  imported_at          TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(source_file, movement_number)
);

CREATE INDEX IF NOT EXISTS idx_bank_tx_date        ON bank_transactions(transaction_date);
CREATE INDEX IF NOT EXISTS idx_bank_tx_direction   ON bank_transactions(direction);
CREATE INDEX IF NOT EXISTS idx_bank_tx_counterparty ON bank_transactions(counterparty_name);
