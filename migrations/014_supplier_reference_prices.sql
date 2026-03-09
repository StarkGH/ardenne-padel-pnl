-- 014_supplier_reference_prices.sql
-- Prix de référence par produit fournisseur (ex: Detrembleur)

CREATE TABLE IF NOT EXISTS supplier_reference_prices (
  id                   SERIAL PRIMARY KEY,
  supplier_id          INTEGER NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  supplier_product_code VARCHAR(80) NOT NULL,
  reference_unit_price NUMERIC(12,4) NOT NULL,
  created_at           TIMESTAMPTZ DEFAULT NOW(),
  updated_at           TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (supplier_id, supplier_product_code)
);

CREATE INDEX IF NOT EXISTS idx_supplier_reference_prices_supplier
  ON supplier_reference_prices(supplier_id);
