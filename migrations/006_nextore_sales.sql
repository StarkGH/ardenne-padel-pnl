-- 006_nextore_sales.sql
-- Ventes Nextore (caisse) — export "Rapport personnalisé - Ardenne padel.xlsx"

CREATE TABLE IF NOT EXISTS nextore_sales (
    id              SERIAL PRIMARY KEY,
    sale_date       DATE NOT NULL,
    sale_time       TIME,
    operation_id    VARCHAR(50),           -- VTE IDOPEx
    category        VARCHAR(100),          -- ASE LIBELLEx (ex: BIERE BOUTEILLE 33 CL)
    article_id      VARCHAR(50),           -- ART IDx
    article_name    VARCHAR(200),          -- ART NOMx
    section         VARCHAR(100),          -- CTR NOMx (section/rayon)
    quantity        NUMERIC(10,3),         -- VTE QTE
    amount_ht       NUMERIC(10,2),         -- VTE MONTANT HT
    amount_ttc      NUMERIC(10,2),         -- VTE MONTANT TTC
    tva_rate        NUMERIC(5,2),          -- VTE TAUX TVA (en %)
    payment_mode    VARCHAR(50),           -- MODEx
    is_bar          BOOLEAN NOT NULL DEFAULT FALSE,  -- catégorie bar (vs terrain/raquette)
    imported_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_nextore_date     ON nextore_sales(sale_date);
CREATE INDEX IF NOT EXISTS idx_nextore_category ON nextore_sales(category);
CREATE INDEX IF NOT EXISTS idx_nextore_is_bar   ON nextore_sales(is_bar);
