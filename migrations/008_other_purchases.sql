-- 008_other_purchases.sql
-- Achats divers (Colruyt, Comarché, Conte de Salm) — saisie manuelle HTVA

CREATE TABLE IF NOT EXISTS other_purchases (
    id              SERIAL PRIMARY KEY,
    purchase_date   DATE,                  -- Date facture (NULL si non connue)
    period_month    VARCHAR(7) NOT NULL,   -- YYYY-MM (mois de référence)
    supplier        VARCHAR(100) NOT NULL, -- COLRUYT, COMARCHE, CONTE_DE_SALM
    category        VARCHAR(100),          -- BAR_BOISSONS, BAR_SNACKS, etc.
    amount_htva     NUMERIC(10,2) NOT NULL,
    amount_tva      NUMERIC(10,2),
    amount_ttc      NUMERIC(10,2),
    description     TEXT,                  -- Notes libres
    source          VARCHAR(50) DEFAULT 'MANUAL',  -- MANUAL | PDF | EXCEL
    imported_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_other_purchases_period   ON other_purchases(period_month);
CREATE INDEX IF NOT EXISTS idx_other_purchases_supplier ON other_purchases(supplier);
