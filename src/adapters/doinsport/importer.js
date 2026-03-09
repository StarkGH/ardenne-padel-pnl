// src/adapters/doinsport/importer.js
// Importe les réservations Doinsport depuis padel.db (SQLite) → PostgreSQL doinsport_bookings
//
// Usage :
//   node src/adapters/doinsport/importer.js [--dry-run] [--from=2025-10-01] [--to=2025-12-31]
//
// Source SQLite : /home/stark2026/projects/padel-service/padel.db

import Database from 'better-sqlite3';
import dotenv from 'dotenv';
import { pool, migrate } from '../../../db.js';

dotenv.config();

const SQLITE_PATH = process.env.PADEL_DB ||
  '/home/stark2026/projects/padel-service/padel.db';

const DRY_RUN  = process.argv.includes('--dry-run');
const FROM_ARG = process.argv.find(a => a.startsWith('--from='))?.split('=')[1] || '2025-01-01';
const TO_ARG   = process.argv.find(a => a.startsWith('--to='))?.split('=')[1]   || '2026-12-31';

// ─── Calcul date locale (Europe/Brussels) ─────────────────────────────────────

const _dtf = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Brussels',
  year: 'numeric', month: '2-digit', day: '2-digit',
});

function toLocalDate(isoStr) {
  if (!isoStr) return null;
  try {
    const d = new Date(isoStr);
    if (isNaN(d.getTime())) return null;
    // en-CA format = YYYY-MM-DD, parsed directly
    return _dtf.format(d); // '2025-10-08'
  } catch { return null; }
}

function durationMin(startISO, endISO) {
  if (!startISO || !endISO) return null;
  try {
    return Math.round((new Date(endISO) - new Date(startISO)) / 60000);
  } catch { return null; }
}

// ─── Upsert PostgreSQL ────────────────────────────────────────────────────────

async function upsertBooking(client, b) {
  const { rows } = await client.query(
    `INSERT INTO doinsport_bookings
       (id, court_key, playground_name, start_at, end_at, start_date, duration_min,
        price_cents, payments_cents, rest_to_pay_cents, price_eur,
        canceled, canceled_at, name, reservant, participants_count,
        activity_name, timetable_name, origin, access_code)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
     ON CONFLICT (id) DO UPDATE SET
       payments_cents    = EXCLUDED.payments_cents,
       rest_to_pay_cents = EXCLUDED.rest_to_pay_cents,
       canceled          = EXCLUDED.canceled,
       canceled_at       = EXCLUDED.canceled_at,
       participants_count = EXCLUDED.participants_count,
       access_code       = EXCLUDED.access_code,
       imported_at       = NOW()
     RETURNING (xmax = 0) AS inserted`,
    [
      b.id, b.court_key, b.playground_name,
      b.start_at || null, b.end_at || null,
      b.start_date, b.duration_min,
      b.price_cents, b.payments_cents, b.rest_to_pay_cents,
      b.price_eur,
      b.canceled, b.canceled_at || null,
      b.name, b.reservant, b.participants_count,
      b.activity_name, b.timetable_name, b.origin, b.access_code,
    ]
  );
  return rows[0]?.inserted ?? true;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log(' Ardenne Padel PNL — Import réservations Doinsport');
  console.log(` Mode    : ${DRY_RUN ? 'DRY-RUN' : 'IMPORT'}`);
  console.log(` Source  : ${SQLITE_PATH}`);
  console.log(` Période : ${FROM_ARG} → ${TO_ARG}`);
  console.log('═══════════════════════════════════════════════════════════\n');

  // Ouvrir SQLite source (read-only)
  const sqlite = new Database(SQLITE_PATH, { readonly: true });

  const rows = sqlite.prepare(`
    SELECT id, court_key, playground_name, start_at_utc, end_at_utc,
           price_cents, payments_cents, rest_to_pay_cents,
           canceled, canceled_at, name, reservant, participants_count,
           activity_name, timetable_name, origin, access_code, created_at_api
    FROM bookings
    WHERE start_at_utc >= ? AND start_at_utc < ?
    ORDER BY start_at_utc
  `).all(FROM_ARG, TO_ARG + 'T23:59:59Z');

  console.log(`>>> ${rows.length} réservations lues depuis SQLite\n`);

  if (DRY_RUN) {
    const byMonth = {};
    for (const r of rows) {
      const m = (r.start_at_utc || '').substring(0, 7);
      if (!byMonth[m]) byMonth[m] = { total: 0, confirmed: 0, canceled: 0, ca: 0 };
      byMonth[m].total++;
      if (r.canceled) byMonth[m].canceled++;
      else            byMonth[m].confirmed++;
      if (!r.canceled) byMonth[m].ca += r.price_cents;
    }
    console.log('  [DRY-RUN] Résumé par mois :');
    for (const [m, s] of Object.entries(byMonth).sort()) {
      console.log(`  ${m} : ${s.confirmed} confirmées + ${s.canceled} annulées = ${(s.ca/100).toFixed(2)}€ CA`);
    }
    console.log('\n  ✅ Dry-run OK — aucune écriture en base');
    sqlite.close();
    return;
  }

  // Migrations
  console.log('>>> Migrations...');
  await migrate();
  console.log('');

  // Logger dans import_logs
  const { rows: logRows } = await pool.query(
    `INSERT INTO import_logs (supplier_code, files_scanned, status)
     VALUES ('DOINSPORT_BOOKINGS', $1, 'running') RETURNING id`,
    [rows.length]
  );
  const logId = logRows[0].id;

  let inserted = 0, updated = 0, errors = 0;
  const client = await pool.connect();

  try {
    // Batch par transactions de 100
    const BATCH = 100;
    for (let i = 0; i < rows.length; i += BATCH) {
      const batch = rows.slice(i, i + BATCH);
      await client.query('BEGIN');
      try {
        for (const r of batch) {
          const b = {
            id:                r.id,
            court_key:         r.court_key,
            playground_name:   r.playground_name,
            start_at:          r.start_at_utc,
            end_at:            r.end_at_utc,
            start_date:        toLocalDate(r.start_at_utc),
            duration_min:      durationMin(r.start_at_utc, r.end_at_utc),
            price_cents:       r.price_cents   || 0,
            payments_cents:    r.payments_cents || 0,
            rest_to_pay_cents: r.rest_to_pay_cents || 0,
            price_eur:         (r.price_cents || 0) / 100,
            canceled:          r.canceled === 1,
            canceled_at:       r.canceled_at || null,
            name:              r.name,
            reservant:         r.reservant,
            participants_count: r.participants_count || 0,
            activity_name:     r.activity_name,
            timetable_name:    r.timetable_name,
            origin:            r.origin,
            access_code:       r.access_code,
          };
          const isInserted = await upsertBooking(client, b);
          if (isInserted) inserted++;
          else            updated++;
        }
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        console.error(`❌ Batch ${i}→${i+BATCH}: ${err.message}`);
        errors += batch.length;
      }

      const done = Math.min(i + BATCH, rows.length);
      process.stdout.write(`\r  → ${done}/${rows.length} (${inserted} ins, ${updated} upd, ${errors} err)`);
    }
    console.log('');
  } finally {
    client.release();
  }

  // Résumé
  console.log('\n───────────────────────────────────────────────────────────');
  console.log(` ➕ Insérées : ${inserted}`);
  console.log(` 🔄 Mises à jour : ${updated}`);
  console.log(` ❌ Erreurs  : ${errors}`);
  console.log('───────────────────────────────────────────────────────────\n');

  await pool.query(
    `UPDATE import_logs SET finished_at=NOW(), files_imported=$1, files_error=$2, status=$3 WHERE id=$4`,
    [inserted + updated, errors, errors > 0 ? 'error' : 'success', logId]
  );

  sqlite.close();
  await pool.end();
}

main().catch(err => {
  console.error('❌  Erreur fatale :', err.message);
  process.exit(1);
});
