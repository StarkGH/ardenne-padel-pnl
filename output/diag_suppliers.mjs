import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { pool } from '/home/stark2026/projects/ardenne-padel-pnl/db.js';

dotenv.config({ path: '/home/stark2026/projects/ardenne-padel-pnl/.env' });
const dataDir = process.env.DATA_DIR || '';

function walk(dir, out = []) {
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
  catch { return out; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.isFile()) out.push(p);
  }
  return out;
}

const files = dataDir ? walk(dataDir) : [];
const fileScan = {
  data_dir: dataDir,
  total_files: files.length,
  colruyt_expected: files.filter(f => /COLRUYT.*\.(csv|xlsx|xls)$/i.test(path.basename(f))),
  comarche_expected: files.filter(f => /COMARCHE.*\.(csv|xlsx|xls)$/i.test(path.basename(f))),
  colruyt_any: files.filter(f => /colruyt/i.test(path.basename(f))),
  comarche_any: files.filter(f => /comarch|comarche/i.test(path.basename(f))),
};

const c = await pool.connect();
try {
  const countsQ = await c.query(`
    SELECT s.code,
      (SELECT COUNT(*) FROM invoices i WHERE i.supplier_id = s.id) AS invoices,
      (SELECT COUNT(*) FROM invoice_lines il JOIN invoices i2 ON i2.id = il.invoice_id WHERE i2.supplier_id = s.id AND il.line_type='PRODUCT') AS invoice_lines,
      (SELECT COUNT(*) FROM supplier_products sp WHERE sp.supplier_id = s.id) AS supplier_products
    FROM suppliers s
    WHERE s.code IN ('DETREMBLEUR','COLRUYT','COMARCHE')
    ORDER BY s.code
  `);

  const logsQ = await c.query(`
    SELECT supplier_code, status, files_scanned, files_imported, files_skipped, files_error, started_at, finished_at
    FROM import_logs
    WHERE supplier_code IN ('COLRUYT','COMARCHE','DETREMBLEUR')
    ORDER BY id DESC
    LIMIT 20
  `);

  console.log(JSON.stringify({ fileScan, dbCounts: countsQ.rows, recentImportLogs: logsQ.rows }, null, 2));
} finally {
  c.release();
  await pool.end();
}
