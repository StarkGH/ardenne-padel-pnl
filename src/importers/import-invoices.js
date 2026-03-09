// src/importers/import-invoices.js
// Script principal : scan DATA_DIR → parse → validate → upsert PostgreSQL
// Usage : node src/importers/import-invoices.js [--dry-run] [--supplier detrembleur]

import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { pool, migrate, upsertInvoice, insertInvoiceLines } from '../../db.js';
import { DetrembleurParser } from '../parsers/detrembleur.js';
import { RetailReceiptParser } from '../parsers/retail-receipt-parser.js';

dotenv.config();

const DRY_RUN    = process.argv.includes('--dry-run');
const SUPPLIER   = (process.argv.find(a => a.startsWith('--supplier='))?.split('=')[1] || 'detrembleur').toLowerCase();
const DATA_DIR   = process.env.DATA_DIR ||
  '/mnt/c/Users/stark/OneDrive - Antoine Zingaro (CQFD Consult)/Boulot New/Ardenne Padel/_Finance/PNL/Shared/BAR/DB';

// ─── Configuration des suppliers ─────────────────────────────────────────────

const SUPPLIERS = {
  detrembleur: {
    code:    'DETREMBLEUR',
    pattern: /^DETREMBLEUR.*\.pdf$/i,
    parser:  new DetrembleurParser(),
  },
  colruyt: {
    code: 'COLRUYT',
    pattern: /COLRUYT.*\.(csv|xlsx|xls|pdf|jpg|jpeg|png)$/i,
    parser: new RetailReceiptParser({ supplierCode: 'COLRUYT' }),
  },
  comarche: {
    code: 'COMARCHE',
    pattern: /COMARCHE.*\.(csv|xlsx|xls|pdf|jpg|jpeg|png)$/i,
    parser: new RetailReceiptParser({ supplierCode: 'COMARCHE' }),
  },
  conte_salm: {
    code: 'CONTE_SALM',
    pattern: /(CONTE.*SALM|LES.*CONTES?.*SALM|SALMA).*\.(csv|xlsx|xls|pdf|jpg|jpeg|png)$/i,
    parser: new RetailReceiptParser({ supplierCode: 'CONTE_SALM' }),
  },
};

function listFilesRecursive(rootDir) {
  const out = [];
  const walk = (dir) => {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        walk(p);
      } else if (e.isFile()) {
        out.push(p);
      }
    }
  };
  walk(rootDir);
  return out;
}

// ─── Rapport d'import ────────────────────────────────────────────────────────

const report = { ok: [], skip: [], warning: [], error: [] };

function logResult(status, file, details) {
  const icons = { OK: '✅', SKIP: '⏭️ ', WARNING: '⚠️ ', ERROR: '❌' };
  const msg = `${icons[status] || '?'} [${status.padEnd(7)}] ${path.basename(file)}  →  ${details}`;
  console.log(msg);
  report[status.toLowerCase()]?.push({ file, details });
}

// ─── Import d'une facture ────────────────────────────────────────────────────

async function importInvoice(filePath, supplierConfig) {
  const fileName = path.basename(filePath);

  let parsed;
  try {
    parsed = await supplierConfig.parser.parse(filePath);
  } catch (err) {
    logResult('ERROR', filePath, `Parsing échoué: ${err.message}`);
    return;
  }

  const { header, lines, summary, validation } = parsed;

  // Facture sans numéro → non importable
  if (!header.invoice_number) {
    logResult('ERROR', filePath, 'Numéro de facture introuvable');
    return;
  }

  // Notes d'import
  const importNotes = validation.valid ? null : validation.warnings.join(' | ');
  const importStatus = validation.valid ? 'OK' : (summary.total_a_payer === 0 ? 'ERROR' : 'WARNING');

  const invoiceData = {
    invoice_number:    header.invoice_number,
    invoice_date:      header.invoice_date,
    bordereau_number:  header.bordereau_number,
    due_date:          header.due_date,
    reference:         header.reference,
    doc_type:          header.doc_type,
    total_htva_21:     summary.total_htva_21,
    total_tva_21:      summary.total_tva_21,
    total_htva_6:      summary.total_htva_6,
    total_tva_6:       summary.total_tva_6,
    vidanges_livrees:  summary.vidanges_livrees,
    vidanges_reprises: summary.vidanges_reprises,
    total_a_payer:     summary.total_a_payer,
    source_file:       filePath,
    import_status:     importStatus,
    import_notes:      importNotes,
  };

  if (DRY_RUN) {
    const linesCount = lines.filter(l => l.line_type === 'PRODUCT').length;
    const status = validation.valid ? 'OK' : 'WARNING';
    logResult(status, filePath,
      `[DRY-RUN] FAC ${header.invoice_number}  ${summary.total_a_payer} €  (${linesCount} lignes produit)` +
      (importNotes ? `  ⚠️ ${importNotes}` : '')
    );
    return;
  }

  // Upsert en transaction
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { id: invoiceId, inserted } = await upsertInvoice(
      client, supplierConfig.code, invoiceData
    );

    if (!inserted) {
      await client.query('ROLLBACK');
      logResult('SKIP', filePath, `FAC ${header.invoice_number}  déjà en base`);
      return;
    }

    // Insérer les lignes
    const lineObjects = lines.map(l => ({
      product_code:     l.product_code,
      description:      l.description,
      quantity_colis:   l.quantity_colis,
      quantity_total:   l.quantity_total,
      unit_price:       l.unit_price,
      excise_ecoboni:   l.excise_ecoboni,
      discount_pct:     l.discount_pct,
      net_unit_price:   l.net_unit_price,
      line_total_htva:  l.line_total_htva,
      vid_unit:         l.vid_unit,
      vid_total:        l.vid_total,
      tva_rate:         l.tva_rate,
      line_type:        l.line_type,
    }));
    await insertInvoiceLines(client, invoiceId, lineObjects);

    await client.query('COMMIT');

    const linesCount = lines.filter(l => l.line_type === 'PRODUCT').length;
    const resultStatus = validation.valid ? 'OK' : 'WARNING';
    logResult(resultStatus, filePath,
      `FAC ${header.invoice_number}  ${summary.total_a_payer} €  (${linesCount} lignes)` +
      (importNotes ? `  ⚠️ ${importNotes}` : '')
    );

  } catch (err) {
    await client.query('ROLLBACK');
    logResult('ERROR', filePath, `DB error: ${err.message}`);
  } finally {
    client.release();
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(' Ardenne Padel PNL — Import factures fournisseurs');
  console.log(` Supplier : ${SUPPLIER}  |  Mode : ${DRY_RUN ? 'DRY-RUN' : 'IMPORT'}`);
  console.log(` DATA_DIR : ${DATA_DIR}`);
  console.log('═══════════════════════════════════════════════════════════');

  const supplierConfig = SUPPLIERS[SUPPLIER];
  if (!supplierConfig) {
    console.error(`❌  Supplier inconnu : ${SUPPLIER}. Disponibles: ${Object.keys(SUPPLIERS).join(', ')}`);
    process.exit(1);
  }

  if (!fs.existsSync(DATA_DIR)) {
    console.error(`❌  DATA_DIR introuvable : ${DATA_DIR}`);
    process.exit(1);
  }

  // Migrations (si pas DRY_RUN)
  if (!DRY_RUN) {
    console.log('\n>>> Migrations...');
    await migrate();
  }

  // Scanner les PDFs
  const files = listFilesRecursive(DATA_DIR)
    .filter(f => supplierConfig.pattern.test(path.basename(f)))
    .sort();

  console.log(`\n>>> ${files.length} fichiers trouvés\n`);

  // Logger l'import dans import_logs (si pas DRY_RUN)
  let logId = null;
  if (!DRY_RUN) {
    const { rows } = await pool.query(
      `INSERT INTO import_logs (supplier_code, files_scanned, status)
       VALUES ($1, $2, 'running') RETURNING id`,
      [supplierConfig.code, files.length]
    );
    logId = rows[0].id;
  }

  // Importer chaque fichier
  for (const filePath of files) {
    await importInvoice(filePath, supplierConfig);
  }

  // Résumé final
  console.log('\n───────────────────────────────────────────────────────────');
  console.log(' Résumé :');
  console.log(`  ✅ OK       : ${report.ok.length}`);
  console.log(`  ⏭️  Skipped  : ${report.skip.length}`);
  console.log(`  ⚠️  Warning  : ${report.warning.length}`);
  console.log(`  ❌ Error    : ${report.error.length}`);
  console.log('───────────────────────────────────────────────────────────\n');

  // Mettre à jour import_logs
  if (!DRY_RUN && logId) {
    await pool.query(
      `UPDATE import_logs SET
         finished_at     = NOW(),
         files_imported  = $1,
         files_skipped   = $2,
         files_error     = $3,
         status          = $4
       WHERE id = $5`,
      [
        report.ok.length + report.warning.length,
        report.skip.length,
        report.error.length,
        report.error.length > 0 ? 'error' : 'success',
        logId,
      ]
    );
  }

  if (!DRY_RUN) await pool.end();
}

main().catch(err => {
  console.error('❌  Erreur fatale :', err.message);
  process.exit(1);
});
