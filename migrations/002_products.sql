-- 002_products.sql
-- Référentiel produits (enrichi à chaque import)

CREATE TABLE IF NOT EXISTS products (
    id               SERIAL PRIMARY KEY,
    supplier_id      INTEGER NOT NULL REFERENCES suppliers(id),
    product_code     VARCHAR(30),
    description      TEXT,
    tva_rate         VARCHAR(5),           -- '6%' | '21%' | '0%'
    last_unit_price  NUMERIC(10, 4),
    updated_at       TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (supplier_id, product_code)
);

CREATE INDEX IF NOT EXISTS idx_products_supplier ON products(supplier_id);
