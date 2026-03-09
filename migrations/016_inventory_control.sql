-- 016_inventory_control.sql
-- Historique des inventaires physiques + document financier de différence

CREATE TABLE IF NOT EXISTS inventory_counts (
  id                      SERIAL PRIMARY KEY,
  supplier_id             INTEGER NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  supplier_product_code   VARCHAR(80) NOT NULL DEFAULT '',
  product_label_norm      TEXT NOT NULL,
  theoretical_quantity    NUMERIC(14,3) NOT NULL DEFAULT 0,
  physical_quantity       NUMERIC(14,3) NOT NULL DEFAULT 0,
  difference_quantity     NUMERIC(14,3) NOT NULL DEFAULT 0,
  avg_purchase_unit_htva  NUMERIC(14,4) NOT NULL DEFAULT 0,
  difference_cost_htva    NUMERIC(14,4) NOT NULL DEFAULT 0,
  counted_on              DATE NOT NULL DEFAULT CURRENT_DATE,
  note                    TEXT,
  created_at              TIMESTAMPTZ DEFAULT NOW(),
  updated_at              TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (supplier_id, supplier_product_code, product_label_norm, counted_on)
);

CREATE INDEX IF NOT EXISTS idx_inventory_counts_supplier_date
  ON inventory_counts(supplier_id, counted_on DESC);

CREATE TABLE IF NOT EXISTS inventory_financial_documents (
  id                        SERIAL PRIMARY KEY,
  document_date             DATE NOT NULL DEFAULT CURRENT_DATE,
  total_difference_cost_htva NUMERIC(14,4) NOT NULL DEFAULT 0,
  lines_count               INTEGER NOT NULL DEFAULT 0,
  created_at                TIMESTAMPTZ DEFAULT NOW(),
  updated_at                TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (document_date)
);

CREATE TABLE IF NOT EXISTS inventory_financial_lines (
  id                      SERIAL PRIMARY KEY,
  document_id             INTEGER NOT NULL REFERENCES inventory_financial_documents(id) ON DELETE CASCADE,
  supplier_id             INTEGER NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  supplier_product_code   VARCHAR(80) NOT NULL DEFAULT '',
  product_label_norm      TEXT NOT NULL,
  theoretical_quantity    NUMERIC(14,3) NOT NULL DEFAULT 0,
  physical_quantity       NUMERIC(14,3) NOT NULL DEFAULT 0,
  difference_quantity     NUMERIC(14,3) NOT NULL DEFAULT 0,
  avg_purchase_unit_htva  NUMERIC(14,4) NOT NULL DEFAULT 0,
  difference_cost_htva    NUMERIC(14,4) NOT NULL DEFAULT 0,
  created_at              TIMESTAMPTZ DEFAULT NOW(),
  updated_at              TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (document_id, supplier_id, supplier_product_code, product_label_norm)
);

CREATE INDEX IF NOT EXISTS idx_inventory_fin_lines_doc
  ON inventory_financial_lines(document_id);
