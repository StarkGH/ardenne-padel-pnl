-- Migration 010 — Tables nextore-registers
-- Import des registres de caisse Nextore (.json)
-- Segments : TERRAIN | BAR | ACCES | TOTAL

CREATE TABLE IF NOT EXISTS nr_registers (
  id              INTEGER PRIMARY KEY,   -- report_number Nextore
  open_at         TIMESTAMPTZ,
  close_at        TIMESTAMPTZ,
  open_date       DATE,                  -- date de la caisse (pour agrégats)
  tickets_count   INTEGER,
  fond_caisse     NUMERIC(10,2),
  avoirs          NUMERIC(10,2),
  total_ttc       NUMERIC(10,2),
  source_file     TEXT NOT NULL,
  imported_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS nr_payments (
  id              SERIAL PRIMARY KEY,
  register_id     INTEGER NOT NULL REFERENCES nr_registers(id) ON DELETE CASCADE,
  method          TEXT NOT NULL,           -- CARTE BANCAIRE, CB STRIPE, ESPECES, ALMA, VIREMENT...
  count           INTEGER,
  amount          NUMERIC(10,2),
  is_summary      BOOLEAN DEFAULT FALSE    -- TRUE pour TOTAL / TOTAL Declare / TOTAL Ecart
);

CREATE TABLE IF NOT EXISTS nr_categories (
  id              SERIAL PRIMARY KEY,
  register_id     INTEGER NOT NULL REFERENCES nr_registers(id) ON DELETE CASCADE,
  label           TEXT NOT NULL,
  count           INTEGER,
  amount          NUMERIC(10,2),
  segment         VARCHAR(8) NOT NULL      -- BAR | ACCES | TOTAL
);

CREATE TABLE IF NOT EXISTS nr_sales (
  id              SERIAL PRIMARY KEY,
  register_id     INTEGER NOT NULL REFERENCES nr_registers(id) ON DELETE CASCADE,
  item            TEXT NOT NULL,
  count           INTEGER,
  amount          NUMERIC(10,2),
  segment         VARCHAR(8) NOT NULL      -- TERRAIN | BAR | ACCES | TOTAL
);

CREATE INDEX IF NOT EXISTS idx_nr_reg_date      ON nr_registers(open_date);
CREATE INDEX IF NOT EXISTS idx_nr_pay_reg       ON nr_payments(register_id);
CREATE INDEX IF NOT EXISTS idx_nr_cat_reg       ON nr_categories(register_id);
CREATE INDEX IF NOT EXISTS idx_nr_cat_seg       ON nr_categories(segment);
CREATE INDEX IF NOT EXISTS idx_nr_sales_reg     ON nr_sales(register_id);
CREATE INDEX IF NOT EXISTS idx_nr_sales_seg     ON nr_sales(segment);
