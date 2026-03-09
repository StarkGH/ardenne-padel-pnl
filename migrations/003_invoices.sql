-- 003_invoices.sql
-- En-têtes de factures

CREATE TABLE IF NOT EXISTS invoices (
    id                SERIAL PRIMARY KEY,
    supplier_id       INTEGER NOT NULL REFERENCES suppliers(id),
    invoice_number    VARCHAR(30),
    invoice_date      DATE,
    bordereau_number  VARCHAR(30),
    due_date          DATE,
    reference         VARCHAR(60),           -- ex: '00008278/00012051'
    doc_type          VARCHAR(20) DEFAULT 'FACTURE',  -- FACTURE | AVOIR | CORRECTION
    total_htva_21     NUMERIC(10, 2),
    total_tva_21      NUMERIC(10, 2),
    total_htva_6      NUMERIC(10, 2),
    total_tva_6       NUMERIC(10, 2),
    vidanges_livrees  NUMERIC(10, 2),
    vidanges_reprises NUMERIC(10, 2),
    total_a_payer     NUMERIC(10, 2),
    source_file       TEXT,
    import_status     VARCHAR(20) DEFAULT 'OK',  -- OK | WARNING | ERROR | PARTIAL
    import_notes      TEXT,
    imported_at       TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (supplier_id, invoice_number)
);

CREATE INDEX IF NOT EXISTS idx_invoices_supplier    ON invoices(supplier_id);
CREATE INDEX IF NOT EXISTS idx_invoices_date        ON invoices(invoice_date);
CREATE INDEX IF NOT EXISTS idx_invoices_doc_type    ON invoices(doc_type);
CREATE INDEX IF NOT EXISTS idx_invoices_status      ON invoices(import_status);
