// src/adapters/belfius-coda/importer.js
// Import des fichiers Belfius CODA (.CD2) → table bank_transactions
//
// Usage :
//   node src/adapters/belfius-coda/importer.js [--dry-run] [--dir=PATH]
//
// DIR par défaut : /tmp/coda_test/  (fichiers .CD2 déjà extraits)
// Si le répertoire contient des .zip : extraction via unzip dans /tmp/coda_import_YYYYMMDD/

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import dotenv from 'dotenv';
import { pool, migrate, upsertBankTransaction } from '../../../db.js';
import { CodaParser } from './parser.js';

dotenv.config();

const DRY_RUN = process.argv.includes('--dry-run');
const DIR_ARG = process.argv.find(a => a.startsWith('--dir='))?.split('=').slice(1).join('=');
const CODA_DIR = DIR_ARG || '/tmp/coda_test';

// ─── Rapport d'import ────────────────────────────────────────────────────────

const report = { ok: [], skip: [], warning: [], error: [] };

function logResult(status, file, details) {
  const icons = { OK: '✅', SKIP: '⏭️ ', WARNING: '⚠️ ', ERROR: '❌' };
  const msg = `${icons[status] || '?'} [${status.padEnd(7)}] ${path.basename(file)}  →  ${details}`;
  console.log(msg);
  report[status.toLowerCase()]?.push({ file, details });
}

// ─── Extraction ZIP si besoin ─────────────────────────────────────────────────

function extractZipsIfNeeded(dir) {
  const zips = fs.readdirSync(dir).filter(f => /\.zip$/i.test(f));
  if (zips.length === 0) return dir;

  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const tmpDir = `/tmp/coda_import_${today}`;
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

  for (const zip of zips) {
    const zipPath = path.join(dir, zip);
    console.log(`>>> Extraction ZIP : ${zip} → ${tmpDir}`);
    try {
      execSync(`unzip -o -j "${zipPath}" "*.CD2" "*.cd2" "*.COD" "*.cod" -d "${tmpDir}"`, { stdio: 'pipe' });
    } catch (err) {
      console.warn(`⚠️  Extraction partielle pour ${zip}: ${err.message}`);
    }
  }
  return tmpDir;
}

// ─── Import d'un fichier CODA ─────────────────────────────────────────────────

async function importCodaFile(filePath, parser) {
  let parsed;
  try {
    parsed = parser.parse(filePath);
  } catch (err) {
    logResult('ERROR', filePath, `Parsing échoué: ${err.message}`);
    return { inserted: 0, skipped: 0 };
  }

  const { fileDate, accountIban, transactions } = parsed;

  if (!transactions.length) {
    logResult('SKIP', filePath, `Aucune transaction (${fileDate})`);
    return { inserted: 0, skipped: 0 };
  }

  if (DRY_RUN) {
    logResult('OK', filePath,
      `[DRY-RUN] ${fileDate}  IBAN:${accountIban}  ${transactions.length} transactions`
    );
    return { inserted: 0, skipped: 0 };
  }

  // Upsert en transaction DB
  const client = await pool.connect();
  let inserted = 0;
  let skipped  = 0;

  try {
    await client.query('BEGIN');

    for (const tx of transactions) {
      const { inserted: isNew } = await upsertBankTransaction(client, tx);
      if (isNew) inserted++;
      else       skipped++;
    }

    await client.query('COMMIT');

    const msg = `${fileDate}  IBAN:${accountIban}  +${inserted} insérées  ⏭️${skipped} déjà en base`;
    logResult(inserted > 0 || skipped === transactions.length ? 'OK' : 'WARNING', filePath, msg);

  } catch (err) {
    await client.query('ROLLBACK');
    logResult('ERROR', filePath, `DB error: ${err.message}`);
    inserted = 0;
    skipped  = 0;
  } finally {
    client.release();
  }

  return { inserted, skipped };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(' Ardenne Padel PNL — Import CODA Belfius (.CD2)');
  console.log(` Mode    : ${DRY_RUN ? 'DRY-RUN' : 'IMPORT'}`);
  console.log(` DIR     : ${CODA_DIR}`);
  console.log('═══════════════════════════════════════════════════════════');

  // Vérifier le répertoire
  if (!fs.existsSync(CODA_DIR)) {
    console.error(`❌  Répertoire introuvable : ${CODA_DIR}`);
    process.exit(1);
  }

  // Extraire les ZIPs si présents dans le répertoire
  const workDir = extractZipsIfNeeded(CODA_DIR);

  // Scanner les .CD2 / .COD
  const files = fs.readdirSync(workDir)
    .filter(f => /\.(CD2|COD)$/i.test(f))
    .sort()
    .map(f => path.join(workDir, f));

  if (files.length === 0) {
    console.error(`❌  Aucun fichier .CD2/.COD trouvé dans : ${workDir}`);
    process.exit(1);
  }

  console.log(`\n>>> ${files.length} fichiers trouvés\n`);

  // Migrations (si pas DRY_RUN)
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
      ['BELFIUS_CODA', files.length]
    );
    logId = rows[0].id;
  }

  // Importer chaque fichier
  const parser = new CodaParser();
  let totalInserted = 0;
  let totalSkipped  = 0;

  for (const filePath of files) {
    const { inserted, skipped } = await importCodaFile(filePath, parser);
    totalInserted += inserted;
    totalSkipped  += skipped;
  }

  // Résumé final
  console.log('\n───────────────────────────────────────────────────────────');
  console.log(' Résumé :');
  console.log(`  ✅ OK       : ${report.ok.length} fichiers`);
  console.log(`  ⏭️  Skipped  : ${report.skip.length} fichiers`);
  console.log(`  ⚠️  Warning  : ${report.warning.length} fichiers`);
  console.log(`  ❌ Error    : ${report.error.length} fichiers`);
  if (!DRY_RUN) {
    console.log(`  ➕ Insérées : ${totalInserted} transactions`);
    console.log(`  ⏭️  Doublons : ${totalSkipped} transactions`);
  }
  console.log('───────────────────────────────────────────────────────────\n');

  // Mettre à jour import_logs
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
