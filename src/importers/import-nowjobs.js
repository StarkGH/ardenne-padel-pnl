// import-nowjobs.js — Import prestations NOWJOBS depuis Excel
// Source : BAR/Prestation Bar de octobre à fin février.xlsx

import ExcelJS from 'exceljs';
import { pool, migrate } from '../../db.js';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

const DATA_DIR = process.env.DATA_DIR || '/mnt/c/Users/stark/OneDrive - Antoine Zingaro (CQFD Consult)/Boulot New/Ardenne Padel/_Finance/PNL/Shared';

function parseDate(val) {
  if (!val) return null;
  if (val instanceof Date) return val;
  const s = String(val).trim();
  // DD/MM/YYYY
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return new Date(parseInt(m[3]), parseInt(m[2]) - 1, parseInt(m[1]));
  // YYYY-MM-DD
  const m2 = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m2) return new Date(parseInt(m2[1]), parseInt(m2[2]) - 1, parseInt(m2[3]));
  return null;
}

function toNum(val) {
  if (val === null || val === undefined || val === '') return null;
  const n = parseFloat(String(val).replace(',', '.'));
  return isNaN(n) ? null : n;
}

function breakToMinutes(val) {
  // HH:MM string ou Date (Excel stocke les heures comme date 1899-12-30) → minutes
  if (!val) return null;
  if (val instanceof Date) {
    return val.getUTCHours() * 60 + val.getUTCMinutes();
  }
  const s = String(val).trim();
  const m = s.match(/^(\d+):(\d{2})$/);
  if (m) return parseInt(m[1]) * 60 + parseInt(m[2]);
  const n = toNum(val);
  return n !== null ? Math.round(n * 60) : null;
}

function formatTime(val) {
  // Convertit une valeur Excel temps (Date 1899-12-30 HH:MM) → "HH:MM"
  if (!val) return null;
  if (val instanceof Date) {
    const h = String(val.getUTCHours()).padStart(2, '0');
    const m = String(val.getUTCMinutes()).padStart(2, '0');
    return `${h}:${m}`;
  }
  const s = String(val).trim();
  // Si déjà au format HH:MM
  if (s.match(/^\d{1,2}:\d{2}$/)) return s;
  return s.substring(0, 20) || null;
}

async function importNowjobs(opts = {}) {
  const dryRun = opts.dryRun ?? false;
  const filePath = path.join(DATA_DIR, 'BAR', 'Prestation Bar de octobre à fin février.xlsx');

  console.log(`📂 Lecture : ${filePath}`);
  console.log(dryRun ? '🔍 DRY-RUN (pas d\'insert)' : '💾 MODE IMPORT');

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);

  const ws = wb.worksheets[0];
  if (!ws) throw new Error('Aucun onglet trouvé');

  // Lire en-tête
  const headerRow = ws.getRow(1);
  const headers = [];
  headerRow.eachCell({ includeEmpty: true }, (cell, colNum) => {
    headers[colNum] = String(cell.value ?? '').trim();
  });

  function col(name) {
    const exact = headers.indexOf(name);
    if (exact !== -1) return exact;
    // Correspondance partielle
    const partial = headers.findIndex(h => h && h.toLowerCase().includes(name.toLowerCase()));
    return partial;
  }

  // Mapping colonnes
  const cWeek     = col('Semaine ISO');
  const cDate     = col('Date');
  const cJour     = col('Jour');
  const cNom      = col('Nom');
  const cPrenom   = col('Prénom');
  const cDebut    = col('Heure Début');
  const cFin      = col('Heure Fin');
  const cBreak    = col('Break');
  const cNumPrest = col('N° Prestation du jour');
  const cDurH     = col('Durée Prestation (h décimal)');
  const cTotH     = col('Total Heures Journée (h décimal)');
  const cTotEmp   = col('Total Employés');
  const cTotCost  = col('Total Coûts Salariaux');
  const cProrata  = col('Coût Prestation au prorata');
  const cHeure    = col('Coût à l\'heure');
  const cStatut   = col('Statut');

  console.log(`📋 Colonnes : Date=${cDate}, Nom=${cNom}, Prénom=${cPrenom}, Prorata=${cProrata}, Statut=${cStatut}`);

  const rows = [];
  let skipped = 0;

  ws.eachRow({ includeEmpty: false }, (row, rowNum) => {
    if (rowNum === 1) return;

    const dateRaw = cDate !== -1 ? row.getCell(cDate).value : null;
    const shiftDate = parseDate(dateRaw);
    if (!shiftDate) { skipped++; return; }

    const statut = cStatut !== -1 ? String(row.getCell(cStatut).value ?? '').trim() : '';
    const nom    = cNom !== -1    ? String(row.getCell(cNom).value ?? '').trim()    : '';
    const prenom = cPrenom !== -1 ? String(row.getCell(cPrenom).value ?? '').trim() : '';

    const employeeName = [nom, prenom].filter(Boolean).join(' ');

    rows.push({
      shift_date:     shiftDate,
      iso_week:       cWeek !== -1     ? String(row.getCell(cWeek).value ?? '').trim() || null : null,
      day_name:       cJour !== -1     ? String(row.getCell(cJour).value ?? '').trim() || null : null,
      employee_name:  employeeName || null,
      start_time:     cDebut !== -1    ? formatTime(row.getCell(cDebut).value) : null,
      end_time:       cFin !== -1      ? formatTime(row.getCell(cFin).value) : null,
      break_minutes:  cBreak !== -1    ? breakToMinutes(row.getCell(cBreak).value) : null,
      prestation_num: cNumPrest !== -1 ? toNum(row.getCell(cNumPrest).value) : null,
      duration_h:     cDurH !== -1     ? toNum(row.getCell(cDurH).value) : null,
      daily_hours:    cTotH !== -1     ? toNum(row.getCell(cTotH).value) : null,
      total_employees:cTotEmp !== -1   ? toNum(row.getCell(cTotEmp).value) : null,
      daily_cost:     cTotCost !== -1  ? toNum(row.getCell(cTotCost).value) : null,
      cost_prorata:   cProrata !== -1  ? toNum(row.getCell(cProrata).value) : null,
      hourly_rate:    cHeure !== -1    ? toNum(row.getCell(cHeure).value) : null,
      statut,
    });
  });

  // Résumé par mois
  const byMonth = {};
  for (const r of rows) {
    const m = `${r.shift_date.getFullYear()}-${String(r.shift_date.getMonth()+1).padStart(2,'0')}`;
    if (!byMonth[m]) byMonth[m] = { cost: 0, count: 0, employees: new Set() };
    byMonth[m].cost += r.cost_prorata ?? 0;
    byMonth[m].count++;
    if (r.employee_name) byMonth[m].employees.add(r.employee_name);
  }

  console.log(`\n📊 Total prestations : ${rows.length} (skip vides: ${skipped})`);
  console.log('\n📅 Résumé par mois (Coût prorata €) :');
  let totalCost = 0;
  for (const [m, v] of Object.entries(byMonth).sort()) {
    console.log(`   ${m} : ${v.cost.toFixed(2)}€ | ${v.count} lignes | ${v.employees.size} employé(s)`);
    totalCost += v.cost;
  }
  console.log(`   TOTAL : ${totalCost.toFixed(2)}€`);

  if (dryRun) {
    console.log('\n✅ DRY-RUN terminé — aucun insert');
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rowCount: deleted } = await client.query('DELETE FROM nowjobs_prestations');
    if (deleted > 0) console.log(`\n🗑  ${deleted} lignes supprimées (re-import complet)`);

    let inserted = 0;
    for (const r of rows) {
      await client.query(
        `INSERT INTO nowjobs_prestations
         (shift_date, iso_week, day_name, employee_name, start_time, end_time,
          break_minutes, prestation_num, duration_h, daily_hours, total_employees,
          daily_cost, cost_prorata, hourly_rate, statut)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
        [r.shift_date, r.iso_week, r.day_name, r.employee_name, r.start_time,
         r.end_time, r.break_minutes, r.prestation_num, r.duration_h, r.daily_hours,
         r.total_employees, r.daily_cost, r.cost_prorata, r.hourly_rate, r.statut]
      );
      inserted++;
    }

    await client.query('COMMIT');
    console.log(`\n✅ ${inserted} prestations importées dans nowjobs_prestations`);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

const isDryRun = process.argv.includes('--dry-run');
await migrate();
await importNowjobs({ dryRun: isDryRun });
await pool.end();
