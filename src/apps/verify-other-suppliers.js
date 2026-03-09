import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { pool } from '../../db.js';

dotenv.config();

const BASE = process.env.MAPPINGS_UI_BASE || 'http://localhost:8090';
const DATA_DIR = process.env.DATA_DIR || '';

function walk(dir, out = []) {
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.isFile()) out.push(p);
  }
  return out;
}

async function getJson(pathname) {
  const res = await fetch(`${BASE}${pathname}`);
  if (!res.ok) throw new Error(`${pathname} -> HTTP ${res.status}`);
  return res.json();
}

async function main() {
  const files = DATA_DIR ? walk(DATA_DIR) : [];
  const colAny = files.filter(f => /colruyt/i.test(path.basename(f)));
  const comAny = files.filter(f => /comarch|comarche/i.test(path.basename(f)));
  const colExpected = files.filter(f => /COLRUYT.*\.(csv|xlsx|xls)$/i.test(path.basename(f)));
  const comExpected = files.filter(f => /COMARCHE.*\.(csv|xlsx|xls)$/i.test(path.basename(f)));

  const client = await pool.connect();
  let counts;
  try {
    const { rows } = await client.query(`
      SELECT s.code,
        (SELECT COUNT(*) FROM invoices i WHERE i.supplier_id = s.id) AS invoices,
        (SELECT COUNT(*) FROM supplier_products sp WHERE sp.supplier_id = s.id) AS supplier_products
      FROM suppliers s
      WHERE s.code IN ('COLRUYT','COMARCHE')
      ORDER BY s.code
    `);
    counts = rows;
  } finally {
    client.release();
    await pool.end();
  }

  const uiCol = await getJson('/api/supplier-commandes?supplier=COLRUYT');
  const uiCom = await getJson('/api/supplier-commandes?supplier=COMARCHE');

  const report = {
    base_url: BASE,
    data_dir: DATA_DIR,
    files_detected: {
      colruyt_any: colAny.length,
      comarche_any: comAny.length,
      colruyt_expected_tabular: colExpected.length,
      comarche_expected_tabular: comExpected.length,
      samples: {
        colruyt_any: colAny.slice(0, 5),
        comarche_any: comAny.slice(0, 5),
      },
    },
    db_counts: counts,
    ui_counts: {
      colruyt_rows: Array.isArray(uiCol) ? uiCol.length : -1,
      comarche_rows: Array.isArray(uiCom) ? uiCom.length : -1,
    },
  };

  console.log(JSON.stringify(report, null, 2));

  const hasOtherData =
    (Array.isArray(uiCol) && uiCol.length > 0) ||
    (Array.isArray(uiCom) && uiCom.length > 0);
  if (!hasOtherData) {
    process.exitCode = 2;
  }
}

main().catch(err => {
  console.error(`❌ ${err.message}`);
  process.exit(1);
});

