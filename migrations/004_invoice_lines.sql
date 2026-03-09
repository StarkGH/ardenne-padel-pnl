-- 004_invoice_lines.sql
-- Lignes de détail des factures

CREATE TABLE IF NOT EXISTS invoice_lines (
    id               SERIAL PRIMARY KEY,
    invoice_id       INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    line_order       INTEGER,
    product_code     VARCHAR(30),
    description      TEXT,
    quantity_colis   NUMERIC(10, 3),    -- Ncolis  (nb de colis)
    quantity_total   NUMERIC(10, 3),    -- Ntotal  (unités individuelles)
    unit_price       NUMERIC(10, 4),    -- Prix Unit
    excise_ecoboni   NUMERIC(10, 4),    -- Accises + Ecoboni par unité
    discount_pct     NUMERIC(5, 2),     -- Remise %
    net_unit_price   NUMERIC(10, 4),    -- Prix Net (après remise + accises)
    line_total_htva  NUMERIC(10, 2),    -- Total HTVA ligne
    vid_unit         NUMERIC(10, 4),    -- Vidange par unité
    vid_total        NUMERIC(10, 2),    -- Total vidanges ligne
    tva_rate         VARCHAR(5),        -- '6%' | '21%' | '0%'
    line_type        VARCHAR(20) DEFAULT 'PRODUCT'
                     -- PRODUCT | GRATUIT | VIDANGE | RETOUR_VIDANGE
);

CREATE INDEX IF NOT EXISTS idx_lines_invoice   ON invoice_lines(invoice_id);
CREATE INDEX IF NOT EXISTS idx_lines_product   ON invoice_lines(product_code);
CREATE INDEX IF NOT EXISTS idx_lines_type      ON invoice_lines(line_type);
