// src/adapters/nextore-registers/importer.js
// Import des registres de caisse Nextore (JSON) → tables nr_registers / nr_payments / nr_categories / nr_sales
//
// Usage :
//   node src/adapters/nextore-registers/importer.js [--dry-run] [--dir=PATH]
//
// DIR par défaut : /home/stark2026/projects/nextore-registers/registers/

import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { pool, migrate, upsertNrRegister } from '../../../db.js';
import { NextoreRegisterParser } from './parser.js';

dotenv.config();

const DRY_RUN = process.argv.includes('--dry-run');
const DIR_ARG = process.argv.find(a => a.startsWith('--dir='))?.split('=').slice(1).join('=');
const REGISTERS_DIR = DIR_ARG || '/home/stark2026/projects/nextore-registers/registers';

// ─── Rapport d'import ────────────────────────────────────────────────────────

const report = { ok: [], skip: [], warning: [], error: [] };

function logResult(status, file, details) {
  const icons = { OK: '✅', SKIP: '⏭️ ', WARNING: '⚠️ ', ERROR: '❌' };
  const msg = `${icons[status] || '?'} [${status.padEnd(7)}] ${path.basename(file).padEnd(20)}  →  ${details}`;
  console.log(msg);
  report[status.toLowerCase()]?.push({ file, details });
}

// ─── Import d'un registre ─────────────────────────────────────────────────────

async function importRegister(filePath, parser) {
  let parsed;
  try {
    parsed = parser.parse(filePath);
  } catch (err) {
    logResult('ERROR', filePath, `Parsing échoué: ${err.message}`);
    return false;
  }

  const { register, payments, categories, sales } = parsed;

  // Registre vide (fond de caisse initial, 0 transactions)
  if (register.ticketsCount === 0 && register.totalTtc === 0) {
    if (DRY_RUN) {
      logResult('SKIP', filePath, `Registre #${register.id} vide (0 tickets, 0 TTC)`);
    } else {
      logResult('SKIP', filePath, `Registre #${register.id} vide (0 tickets, 0 TTC)`);
    }
    return false;
  }

  if (DRY_RUN) {
    const terrainAmt = sales.filter(s => s.segment === 'TERRAIN').reduce((a, s) => a + s.amount, 0);
    const barAmt     = categories.filter(c => c.segment === 'BAR').reduce((a, c) => a + c.amount, 0);
    const realPay    = payments.filter(p => !p.isSummary);
    logResult('OK', filePath,
      `[DRY-RUN] #${register.id}  ${register.openDate}  ` +
      `${register.totalTtc}€ TTC  (terrain:${terrainAmt.toFixed(2)}€  bar:${barAmt.toFixed(2)}€)  ` +
      `${register.ticketsCount} tickets  ${realPay.length} modes paiement`
    );
    return false;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { inserted } = await upsertNrRegister(client, { register, payments, categories, sales });
    await client.query('COMMIT');

    if (!inserted) {
      logResult('SKIP', filePath, `Registre #${register.id}  ${register.openDate}  déjà en base`);
      return false;
    }

    const terrainAmt = sales.filter(s => s.segment === 'TERRAIN').reduce((a, s) => a + s.amount, 0);
    const barAmt     = categories.filter(c => c.segment === 'BAR').reduce((a, c) => a + c.amount, 0);
    logResult('OK', filePath,
      `#${register.id}  ${register.openDate}  ${register.totalTtc}€ TTC  ` +
      `(terrain:${terrainAmt.toFixed(2)}€  bar:${barAmt.toFixed(2)}€)  ${register.ticketsCount} tickets`
    );
    return true;

  } catch (err) {
    await client.query('ROLLBACK');
    logResult('ERROR', filePath, `DB error: ${err.message}`);
    return false;
  } finally {
    client.release();
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(' Ardenne Padel PNL — Import registres Nextore');
  console.log(` Mode    : ${DRY_RUN ? 'DRY-RUN' : 'IMPORT'}`);
  console.log(` DIR     : ${REGISTERS_DIR}`);
  console.log('═══════════════════════════════════════════════════════════');

  if (!fs.existsSync(REGISTERS_DIR)) {
    console.error(`❌  Répertoire introuvable : ${REGISTERS_DIR}`);
    process.exit(1);
  }

  const files = fs.readdirSync(REGISTERS_DIR)
    .filter(f => f.endsWith('.json'))
    .sort((a, b) => {
      // Tri numérique par report_number (register_1 < register_10 < register_49)
      const na = parseInt(a.match(/\d+/)?.[0] ?? '0', 10);
      const nb = parseInt(b.match(/\d+/)?.[0] ?? '0', 10);
      return na - nb;
    })
    .map(f => path.join(REGISTERS_DIR, f));

  if (files.length === 0) {
    console.error(`❌  Aucun fichier .json trouvé dans : ${REGISTERS_DIR}`);
    process.exit(1);
  }

  console.log(`\n>>> ${files.length} fichiers trouvés\n`);

  if (!DRY_RUN) {
    console.log('>>> Migrations...');
    await migrate();
    console.log('');
  }

  // Logger le début dans import_logs
  let logId = null;
  if (!DRY_RUN) {
    const { rows } = await pool.query(
      `INSERT INTO import_logs (supplier_code, files_scanned, status)
       VALUES ($1, $2, 'running') RETURNING id`,
      ['NEXTORE_REGISTERS', files.length]
    );
    logId = rows[0].id;
  }

  const parser = new NextoreRegisterParser();
  let inserted = 0;

  for (const filePath of files) {
    const ok = await importRegister(filePath, parser);
    if (ok) inserted++;
  }

  // Résumé final
  console.log('\n───────────────────────────────────────────────────────────');
  console.log(' Résumé :');
  console.log(`  ✅ Insérés  : ${report.ok.length}`);
  console.log(`  ⏭️  Skipped  : ${report.skip.length}`);
  console.log(`  ⚠️  Warning  : ${report.warning.length}`);
  console.log(`  ❌ Erreurs  : ${report.error.length}`);
  console.log('───────────────────────────────────────────────────────────\n');

  if (!DRY_RUN && logId) {
    await pool.query(
      `UPDATE import_logs SET
         finished_at    = NOW(),
         files_imported = $1,
         files_skipped  = $2,
         files_error    = $3,
         status         = $4
       WHERE id = $5`,
      [
        report.ok.length,
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
