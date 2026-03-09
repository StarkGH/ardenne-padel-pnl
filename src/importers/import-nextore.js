// import-nextore.js — Import ventes Nextore depuis Excel
// Source : BAR/DB/Rapport personnalisé - Ardenne padel.xlsx

import ExcelJS from 'exceljs';
import { pool, migrate } from '../../db.js';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

const DATA_DIR = process.env.DATA_DIR || '/mnt/c/Users/stark/OneDrive - Antoine Zingaro (CQFD Consult)/Boulot New/Ardenne Padel/_Finance/PNL/Shared';

// Catégories BAR (à inclure)
const BAR_CATEGORIES = new Set([
  'FUT',
  'BIERE BOUTEILLE 33 CL',
  'BIERE BOUTEILLE 25 CL',
  'SOFT - 20 ou 25 CL',
  'SOFT - 33 CL',
  'SNACK',
  'Alcool : Vin, blanc Co, Spritz',
  'BOISSON CHAUDE',
  // Variantes orthographiques vues dans le fichier
  'BIERE 33CL',
  'BIERE 25CL',
  'SOFT',
  'BOISSON CHAUDE',
  'ALCOOL/VIN/COCKTAIL',
]);

function isBarCategory(category) {
  if (!category) return false;
  const cat = String(category).trim();
  // Correspondance exacte
  if (BAR_CATEGORIES.has(cat)) return true;
  // Correspondance partielle pour capturer les variantes
  const catUp = cat.toUpperCase();
  if (catUp.includes('BIERE') || catUp.includes('BIÈRE')) return true;
  if (catUp.includes('SOFT')) return true;
  if (catUp.includes('FUT') || catUp.includes('FÛT')) return true;
  if (catUp.includes('SNACK')) return true;
  if (catUp.includes('BOISSON CHAUDE') || catUp.includes('CAFÉ') || catUp.includes('CAFE')) return true;
  if (catUp.includes('ALCOOL') || catUp.includes('VIN') || catUp.includes('SPRITZ') || catUp.includes('COCKTAIL')) return true;
  // Exclusions explicites
  if (catUp.includes('TERRAIN') || catUp.includes('RAQUETTE') || catUp.includes('ACCESSOIRE') || catUp.includes('ANCIENNE')) return false;
  return false;
}

function parseDate(val) {
  if (!val) return null;
  if (val instanceof Date) return val;
  const s = String(val).trim();
  // Format DD/MM/YYYY
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (m) return new Date(parseInt(m[3]), parseInt(m[2]) - 1, parseInt(m[1]));
  // Format YYYY-MM-DD
  const m2 = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m2) return new Date(parseInt(m2[1]), parseInt(m2[2]) - 1, parseInt(m2[3]));
  return null;
}

function toNum(val) {
  if (val === null || val === undefined || val === '') return null;
  const n = parseFloat(String(val).replace(',', '.'));
  return isNaN(n) ? null : n;
}

async function importNextore(opts = {}) {
  const dryRun = opts.dryRun ?? false;
  const filePath = path.join(DATA_DIR, 'BAR/DB/Rapport personnalisé - Ardenne padel.xlsx');

  console.log(`📂 Lecture : ${filePath}`);
  console.log(dryRun ? '🔍 DRY-RUN (pas d\'insert)' : '💾 MODE IMPORT');

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);

  const ws = wb.worksheets[0];
  if (!ws) throw new Error('Aucun onglet trouvé dans le fichier Nextore');

  // Lire l'en-tête : ligne 1 = titre "Rapport personnalisé...", ligne 2 = vraies colonnes
  const headerRow = ws.getRow(2);
  const headers = [];
  headerRow.eachCell({ includeEmpty: true }, (cell, colNum) => {
    headers[colNum] = String(cell.value ?? '').trim();
  });
  const HEADER_ROW = 2;  // données commencent en ligne 3

  // Mapping colonnes → index
  function col(name) {
    const idx = headers.indexOf(name);
    if (idx === -1) {
      // Recherche partielle
      const partial = headers.findIndex(h => h && h.includes(name.replace(/x$/, '')));
      return partial === -1 ? null : partial;
    }
    return idx;
  }

  const colDate   = col('VTE DATEx');
  const colTime   = col('VTE TIME');
  const colOpe    = col('VTE IDOPEx');
  const colCat    = col('ASE LIBELLEx');
  const colArtId  = col('ART IDx');
  const colArtNom = col('ART NOMx');
  const colSec    = col('CTR NOMx');
  const colQty    = col('VTE QTE');
  const colHT     = col('VTE MONTANT HT');
  const colTTC    = col('VTE MONTANT TTC');
  const colTVA    = col('VTE TAUX TVA');
  const colMode   = col('MODEx');

  console.log(`📋 Colonnes détectées : Date=${colDate}, Catégorie=${colCat}, ArtNom=${colArtNom}, QTE=${colQty}, HT=${colHT}, TTC=${colTTC}`);

  const rows = [];
  let skippedEmpty = 0;

  ws.eachRow({ includeEmpty: false }, (row, rowNum) => {
    if (rowNum <= HEADER_ROW) return; // skip title + header rows

    const dateRaw = colDate !== null ? row.getCell(colDate).value : null;
    const saleDate = parseDate(dateRaw);
    if (!saleDate) { skippedEmpty++; return; }

    const category = colCat !== null ? String(row.getCell(colCat).value ?? '').trim() : '';

    rows.push({
      sale_date:    saleDate,
      sale_time:    colTime !== null ? String(row.getCell(colTime).value ?? '').trim() || null : null,
      operation_id: colOpe !== null ? String(row.getCell(colOpe).value ?? '').trim() || null : null,
      category,
      article_id:   colArtId !== null ? String(row.getCell(colArtId).value ?? '').trim() || null : null,
      article_name: colArtNom !== null ? String(row.getCell(colArtNom).value ?? '').trim() || null : null,
      section:      colSec !== null ? String(row.getCell(colSec).value ?? '').trim() || null : null,
      quantity:     colQty !== null ? toNum(row.getCell(colQty).value) : null,
      amount_ht:    colHT !== null ? toNum(row.getCell(colHT).value) : null,
      amount_ttc:   colTTC !== null ? toNum(row.getCell(colTTC).value) : null,
      tva_rate:     colTVA !== null ? toNum(row.getCell(colTVA).value) : null,
      payment_mode: colMode !== null ? String(row.getCell(colMode).value ?? '').trim() || null : null,
      is_bar:       isBarCategory(category),
    });
  });

  const barRows = rows.filter(r => r.is_bar);
  const nonBarRows = rows.filter(r => !r.is_bar);
  const categories = [...new Set(rows.map(r => r.category))].sort();

  console.log(`\n📊 Total lignes lues : ${rows.length} (skip vides: ${skippedEmpty})`);
  console.log(`   Bar : ${barRows.length} | Hors-bar : ${nonBarRows.length}`);
  console.log(`   Catégories distinctes : ${categories.length}`);
  console.log(`   Catégories : ${categories.slice(0, 10).join(', ')}${categories.length > 10 ? '...' : ''}`);

  // Résumé par mois
  const byMonth = {};
  for (const r of rows) {
    const m = `${r.sale_date.getFullYear()}-${String(r.sale_date.getMonth()+1).padStart(2,'0')}`;
    if (!byMonth[m]) byMonth[m] = { bar_ht: 0, bar_ttc: 0, total_ht: 0 };
    if (r.is_bar) {
      byMonth[m].bar_ht  += r.amount_ht ?? 0;
      byMonth[m].bar_ttc += r.amount_ttc ?? 0;
    }
    byMonth[m].total_ht += r.amount_ht ?? 0;
  }
  console.log('\n📅 Résumé par mois (bar) :');
  for (const [m, v] of Object.entries(byMonth).sort()) {
    console.log(`   ${m} : CA Bar HT=${v.bar_ht.toFixed(2)}€  TTC=${v.bar_ttc.toFixed(2)}€  (Total HT=${v.total_ht.toFixed(2)}€)`);
  }

  if (dryRun) {
    console.log('\n✅ DRY-RUN terminé — aucun insert');
    return;
  }

  // Insert en base
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Vider la table avant re-import (idempotent)
    const { rowCount: deleted } = await client.query('DELETE FROM nextore_sales');
    if (deleted > 0) console.log(`\n🗑  ${deleted} lignes supprimées (re-import complet)`);

    let inserted = 0;
    for (const r of rows) {
      await client.query(
        `INSERT INTO nextore_sales
         (sale_date, sale_time, operation_id, category, article_id, article_name,
          section, quantity, amount_ht, amount_ttc, tva_rate, payment_mode, is_bar)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [r.sale_date, r.sale_time, r.operation_id, r.category, r.article_id,
         r.article_name, r.section, r.quantity, r.amount_ht, r.amount_ttc,
         r.tva_rate, r.payment_mode, r.is_bar]
      );
      inserted++;
    }

    await client.query('COMMIT');
    console.log(`\n✅ ${inserted} lignes importées dans nextore_sales`);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ─── Exécution directe ────────────────────────────────────────────────────────
const isDryRun = process.argv.includes('--dry-run');
await migrate();
await importNextore({ dryRun: isDryRun });
await pool.end();
