-- 012_product_mappings.sql
-- Référentiel de correspondance Nextore <-> produits fournisseurs
-- Supporte:
--   - mapping direct (article fournisseur vendu tel quel)
--   - mapping recette (article Nextore composé de plusieurs ingrédients)

CREATE TABLE IF NOT EXISTS nextore_products (
  id            SERIAL PRIMARY KEY,
  code          VARCHAR(200) UNIQUE NOT NULL,   -- code interne normalisé (ex: MAZOUT - 25 CL)
  label         TEXT NOT NULL,                  -- libellé affiché
  source        VARCHAR(40) NOT NULL DEFAULT 'unknown',
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS supplier_products (
  id                     SERIAL PRIMARY KEY,
  supplier_id            INTEGER NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  supplier_product_code  VARCHAR(80) NOT NULL DEFAULT '',  -- vide si pas de code fiable
  label                  TEXT NOT NULL,
  label_norm             TEXT NOT NULL,                     -- normalisé pour unicité
  default_unit           VARCHAR(30),
  tva_rate               VARCHAR(5),
  last_unit_price        NUMERIC(10,4),
  source                 VARCHAR(40) NOT NULL DEFAULT 'unknown',
  created_at             TIMESTAMPTZ DEFAULT NOW(),
  updated_at             TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (supplier_id, supplier_product_code, label_norm)
);

CREATE INDEX IF NOT EXISTS idx_supplier_products_supplier ON supplier_products(supplier_id);
CREATE INDEX IF NOT EXISTS idx_supplier_products_label_norm ON supplier_products(label_norm);

CREATE TABLE IF NOT EXISTS product_mappings (
  id                  SERIAL PRIMARY KEY,
  nextore_product_id  INTEGER NOT NULL REFERENCES nextore_products(id) ON DELETE CASCADE,
  supplier_product_id INTEGER NOT NULL REFERENCES supplier_products(id) ON DELETE CASCADE,
  mapping_type        VARCHAR(20) NOT NULL CHECK (mapping_type IN ('DIRECT', 'RECIPE')),
  quantity_value      NUMERIC(12,4),
  quantity_unit       VARCHAR(20), -- cl, ml, l, g, piece, etc.
  note                TEXT,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (nextore_product_id, supplier_product_id, mapping_type, quantity_value, quantity_unit)
);

CREATE INDEX IF NOT EXISTS idx_product_mappings_nextore ON product_mappings(nextore_product_id);
CREATE INDEX IF NOT EXISTS idx_product_mappings_supplier_product ON product_mappings(supplier_product_id);
