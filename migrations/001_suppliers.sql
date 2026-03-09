-- 001_suppliers.sql
-- Référentiel fournisseurs

CREATE TABLE IF NOT EXISTS suppliers (
    id          SERIAL PRIMARY KEY,
    code        VARCHAR(50) UNIQUE NOT NULL,   -- 'DETREMBLEUR', 'COLRUYT', 'NOWJOBS', …
    name        TEXT NOT NULL,
    vat_number  VARCHAR(20),
    address     TEXT,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Insérer les fournisseurs connus d'emblée
INSERT INTO suppliers (code, name) VALUES
    ('DETREMBLEUR', 'Detrembleur SA'),
    ('COLRUYT',     'Colruyt'),
    ('COMARCHE',    'Comarché'),
    ('CONTE_SALM',  'Conte de Salm'),
    ('NOWJOBS',     'Nowjobs')
ON CONFLICT (code) DO NOTHING;
