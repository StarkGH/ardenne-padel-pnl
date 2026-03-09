// import-other-purchases.js — Achats Colruyt/Comarché/Conte de Salm
// Saisie manuelle depuis MEMORY.md et fichiers PDF/JPG analysés manuellement

import { pool, migrate } from '../../db.js';
import dotenv from 'dotenv';

dotenv.config();

// ─── Données connues (mises à jour manuellement) ─────────────────────────────
// Sources : analyse manuelle des reçus Colruyt, Comarché, Conte de Salm + MEMORY.md
const KNOWN_PURCHASES = [
  // ── COLRUYT ──────────────────────────────────────────────────────────────
  {
    period_month: '2025-10',
    supplier: 'COLRUYT',
    category: 'BAR_BOISSONS',
    amount_htva: 242.25,
    description: 'Colruyt OCT 2025 — achats bar (boissons uniquement)',
    source: 'MANUAL',
  },
  // ── COMARCHÉ ─────────────────────────────────────────────────────────────
  {
    period_month: '2025-11',
    supplier: 'COMARCHE',
    category: 'BAR_BOISSONS',
    amount_htva: 115.00,
    description: 'Comarché NOV 2025 (estimé)',
    source: 'MANUAL',
  },
  {
    period_month: '2025-12',
    supplier: 'COMARCHE',
    category: 'BAR_BOISSONS',
    amount_htva: 43.00,
    description: 'Comarché DEC 2025',
    source: 'MANUAL',
  },
  {
    period_month: '2026-01',
    supplier: 'COMARCHE',
    category: 'BAR_BOISSONS',
    amount_htva: 76.00,
    description: 'Comarché JAN 2026',
    source: 'MANUAL',
  },
  // ── CONTE DE SALM ────────────────────────────────────────────────────────
  {
    period_month: '2025-11',
    supplier: 'CONTE_DE_SALM',
    category: 'BAR_SNACKS',
    amount_htva: 100.00,
    description: 'Conte de Salm NOV 2025 — snacks joueurs',
    source: 'MANUAL',
  },
];

async function importOtherPurchases(opts = {}) {
  const dryRun = opts.dryRun ?? false;

  console.log(dryRun ? '🔍 DRY-RUN (pas d\'insert)' : '💾 MODE IMPORT');
  console.log(`\n📊 ${KNOWN_PURCHASES.length} achats à importer :`);

  let totalHtva = 0;
  for (const p of KNOWN_PURCHASES) {
    console.log(`   ${p.period_month} | ${p.supplier} | ${p.amount_htva.toFixed(2)}€ HTVA | ${p.description}`);
    totalHtva += p.amount_htva;
  }
  console.log(`   TOTAL HTVA : ${totalHtva.toFixed(2)}€`);

  if (dryRun) {
    console.log('\n✅ DRY-RUN terminé — aucun insert');
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Vider et re-insérer (table petite, saisie manuelle = référence)
    const { rowCount: deleted } = await client.query("DELETE FROM other_purchases WHERE source = 'MANUAL'");
    if (deleted > 0) console.log(`\n🗑  ${deleted} lignes MANUAL supprimées (re-import)`);

    let inserted = 0;
    for (const p of KNOWN_PURCHASES) {
      await client.query(
        `INSERT INTO other_purchases
         (period_month, supplier, category, amount_htva, description, source)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [p.period_month, p.supplier, p.category, p.amount_htva, p.description, p.source]
      );
      inserted++;
    }

    await client.query('COMMIT');
    console.log(`\n✅ ${inserted} achats importés dans other_purchases`);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

const isDryRun = process.argv.includes('--dry-run');
await migrate();
await importOtherPurchases({ dryRun: isDryRun });
await pool.end();
