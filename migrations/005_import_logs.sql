-- 005_import_logs.sql
-- Traçabilité des imports (pattern padel-service sync_logs)

CREATE TABLE IF NOT EXISTS import_logs (
    id              SERIAL PRIMARY KEY,
    started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    finished_at     TIMESTAMPTZ,
    supplier_code   VARCHAR(50),
    files_scanned   INTEGER DEFAULT 0,
    files_imported  INTEGER DEFAULT 0,
    files_skipped   INTEGER DEFAULT 0,
    files_error     INTEGER DEFAULT 0,
    status          VARCHAR(20) NOT NULL DEFAULT 'running',  -- running | success | error
    error_message   TEXT
);

CREATE INDEX IF NOT EXISTS idx_import_logs_started  ON import_logs(started_at);
CREATE INDEX IF NOT EXISTS idx_import_logs_supplier ON import_logs(supplier_code);
