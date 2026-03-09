// src/exporters/export-reconciliation-terrain.js
// Réconciliation CA Terrain — Doinsport vs Nextore vs Belfius/Stripe
//
// Onglets :
//   1. SYNTHÈSE MENSUELLE  — 3 sources × 3 mois T4
//   2. PAR JOUR            — comparaison quotidienne (Doinsport vs Nextore)
//   3. ÉCARTS              — lignes avec écart > seuil, classées par montant
//   4. PAR TERRAIN (court) — répartition par terrain Doinsport T4
//   5. PAR PRESTATION      — top timetable_name Doinsport T4
//   6. ORIGINES            — canal de réservation (app, admin, web...)
//   7. DÉTAIL DOINSPORT    — toutes les réservations T4 confirmées
//
// Usage : node src/exporters/export-reconciliation-terrain.js [--from=YYYY-MM-DD] [--to=YYYY-MM-DD]

import path from 'path';
import dotenv from 'dotenv';
import ExcelJS from 'exceljs';
import { pool } from '../../db.js';

dotenv.config();

const FROM = process.argv.find(a => a.startsWith('--from='))?.split('=')[1] || '2025-10-01';
const TO   = process.argv.find(a => a.startsWith('--to='))?.split('=')[1]   || '2025-12-31';

const DATA_DIR = process.env.DATA_DIR ||
  '/mnt/c/Users/stark/OneDrive - Antoine Zingaro (CQFD Consult)/Boulot New/Ardenne Padel/_Finance/PNL/Shared';
const OUT_PATH = path.join(DATA_DIR, 'BDO T4 - 2025/Analyse/RECONCILIATION_TERRAIN_T4_2025.xlsx');

// ─── Couleurs ─────────────────────────────────────────────────────────────────
const C = {
  bleu_fonce: '1F3864', bleu_moyen: '2F75B6', bleu_clair: 'BDD7EE',
  vert_fonce: '375623', vert_clair: 'E2EFDA',
  orange:     'FCE4D6', rouge: 'C00000',
  jaune:      'FFF2CC', gris: 'D9D9D9', blanc: 'FFFFFF',
};
function bg(c, hex) { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF'+hex } }; }
function fw(c, hex) { c.font = { ...(c.font||{}), color: { argb: 'FF'+hex } }; }
function bold(c)    { c.font = { ...(c.font||{}), bold: true }; }
function numFmt(c, f) { c.numFmt = f; }
function right(c)   { c.alignment = { horizontal: 'right', vertical: 'middle' }; }

function styleHeader(ws, rowNum, bgHex = C.bleu_moyen) {
  const row = ws.getRow(rowNum);
  for (let c = 1; c <= ws.columns.length; c++) {
    bg(row.getCell(c), bgHex); fw(row.getCell(c), C.blanc); bold(row.getCell(c));
  }
  row.height = 18;
}
function styleTitle(ws, rowNum) {
  const row = ws.getRow(rowNum);
  for (let c = 1; c <= ws.columns.length; c++) {
    bg(row.getCell(c), C.bleu_fonce); fw(row.getCell(c), C.blanc); bold(row.getCell(c));
  }
  row.height = 22;
}

// ─── Requêtes ─────────────────────────────────────────────────────────────────

async function queryDoinsportMonthly() {
  const { rows } = await pool.query(`
    SELECT TO_CHAR(start_date,'YYYY-MM') mois,
           COUNT(*) FILTER (WHERE NOT canceled)                           confirmed,
           COUNT(*) FILTER (WHERE canceled)                               canceled_cnt,
           ROUND(SUM(price_eur)   FILTER (WHERE NOT canceled)::numeric,2) ca_brut,
           ROUND(SUM(price_eur)   FILTER (WHERE NOT canceled AND price_eur > 0)::numeric,2) ca_paye,
           COUNT(*) FILTER (WHERE NOT canceled AND price_eur = 0)         free_bookings,
           ROUND(AVG(price_eur)   FILTER (WHERE NOT canceled AND price_eur > 0)::numeric,2) avg_price,
           SUM(participants_count) FILTER (WHERE NOT canceled)            total_participants
    FROM doinsport_bookings
    WHERE start_date BETWEEN $1 AND $2
    GROUP BY mois ORDER BY mois
  `, [FROM, TO]);
  return rows;
}

async function queryNextoreMonthly() {
  const { rows } = await pool.query(`
    SELECT TO_CHAR(r.open_date,'YYYY-MM') mois,
           ROUND(SUM(s.amount) FILTER (WHERE s.segment='TERRAIN')::numeric,2) ca_terrain,
           SUM(s.count)        FILTER (WHERE s.segment='TERRAIN')             nb_sessions
    FROM nr_registers r JOIN nr_sales s ON s.register_id=r.id
    WHERE r.open_date BETWEEN $1 AND $2 AND s.segment != 'TOTAL'
    GROUP BY mois ORDER BY mois
  `, [FROM, TO]);
  return rows;
}

async function queryStripeMonthly() {
  const { rows } = await pool.query(`
    SELECT TO_CHAR(transaction_date,'YYYY-MM') mois,
           ROUND(SUM(amount)::numeric,2) stripe_recu
    FROM bank_transactions
    WHERE direction='CREDIT' AND counterparty_name ILIKE '%STRIPE%'
      AND transaction_date BETWEEN $1 AND $2
    GROUP BY mois ORDER BY mois
  `, [FROM, TO]);
  return rows;
}

async function queryByDay() {
  // Doinsport par jour
  const { rows: doin } = await pool.query(`
    SELECT start_date,
           COUNT(*) FILTER (WHERE NOT canceled) confirmed,
           COUNT(*) FILTER (WHERE canceled)     canceled_cnt,
           ROUND(SUM(price_eur) FILTER (WHERE NOT canceled)::numeric,2) ca_doin,
           SUM(participants_count) FILTER (WHERE NOT canceled)          participants
    FROM doinsport_bookings
    WHERE start_date BETWEEN $1 AND $2
    GROUP BY start_date ORDER BY start_date
  `, [FROM, TO]);

  // Nextore par registre (open_date)
  const { rows: nxt } = await pool.query(`
    SELECT r.open_date,
           ROUND(SUM(s.amount) FILTER (WHERE s.segment='TERRAIN')::numeric,2) ca_nxt,
           SUM(s.count) FILTER (WHERE s.segment='TERRAIN') nb_nxt
    FROM nr_registers r JOIN nr_sales s ON s.register_id=r.id
    WHERE r.open_date BETWEEN $1 AND $2 AND s.segment!='TOTAL'
    GROUP BY r.open_date ORDER BY r.open_date
  `, [FROM, TO]);

  // Stripe par jour (Belfius)
  const { rows: stripe } = await pool.query(`
    SELECT transaction_date::DATE dt,
           ROUND(SUM(amount)::numeric,2) stripe
    FROM bank_transactions
    WHERE direction='CREDIT' AND counterparty_name ILIKE '%STRIPE%'
      AND transaction_date BETWEEN $1 AND $2
    GROUP BY dt ORDER BY dt
  `, [FROM, TO]);

  // Merge par date
  const map = {};
  for (const r of doin) {
    const k = r.start_date.toISOString().slice(0,10);
    map[k] = { date: k, confirmed: r.confirmed, canceled: r.canceled_cnt, ca_doin: parseFloat(r.ca_doin||0), participants: r.participants };
  }
  for (const r of nxt) {
    const k = r.open_date.toISOString().slice(0,10);
    if (!map[k]) map[k] = { date: k, confirmed: 0, canceled: 0, ca_doin: 0, participants: 0 };
    map[k].ca_nxt = parseFloat(r.ca_nxt||0);
    map[k].nb_nxt = parseInt(r.nb_nxt||0);
  }
  for (const r of stripe) {
    const k = r.dt.toISOString().slice(0,10);
    if (!map[k]) map[k] = { date: k, confirmed: 0, canceled: 0, ca_doin: 0, participants: 0 };
    map[k].ca_stripe = parseFloat(r.stripe||0);
  }

  return Object.values(map).sort((a,b) => a.date.localeCompare(b.date));
}

async function queryByCourt() {
  const { rows } = await pool.query(`
    SELECT court_key,
           COUNT(*) FILTER (WHERE NOT canceled) confirmed,
           COUNT(*) FILTER (WHERE canceled)     canceled_cnt,
           ROUND(SUM(price_eur) FILTER (WHERE NOT canceled)::numeric,2) ca,
           ROUND(AVG(price_eur) FILTER (WHERE NOT canceled AND price_eur>0)::numeric,2) avg_price,
           ROUND(AVG(duration_min) FILTER (WHERE NOT canceled)::numeric,1) avg_duration
    FROM doinsport_bookings
    WHERE start_date BETWEEN $1 AND $2
    GROUP BY court_key ORDER BY ca DESC
  `, [FROM, TO]);
  return rows;
}

async function queryByTimetable() {
  const { rows } = await pool.query(`
    SELECT timetable_name,
           COUNT(*) FILTER (WHERE NOT canceled) confirmed,
           ROUND(SUM(price_eur) FILTER (WHERE NOT canceled)::numeric,2) ca,
           ROUND(AVG(duration_min) FILTER (WHERE NOT canceled)::numeric,0) avg_min
    FROM doinsport_bookings
    WHERE start_date BETWEEN $1 AND $2
    GROUP BY timetable_name ORDER BY ca DESC
  `, [FROM, TO]);
  return rows;
}

async function queryByOrigin() {
  const { rows } = await pool.query(`
    SELECT COALESCE(NULLIF(origin,''),'(vide)') origin,
           COUNT(*) FILTER (WHERE NOT canceled) confirmed,
           COUNT(*) FILTER (WHERE canceled)     canceled_cnt,
           ROUND(SUM(price_eur) FILTER (WHERE NOT canceled)::numeric,2) ca
    FROM doinsport_bookings
    WHERE start_date BETWEEN $1 AND $2
    GROUP BY origin ORDER BY ca DESC
  `, [FROM, TO]);
  return rows;
}

async function queryDetail() {
  const { rows } = await pool.query(`
    SELECT start_date, start_at, end_at, court_key, duration_min,
           name, reservant, participants_count,
           price_eur, payments_cents::numeric/100 payments_eur,
           rest_to_pay_cents::numeric/100 rest_eur,
           canceled, activity_name, timetable_name, origin, access_code
    FROM doinsport_bookings
    WHERE start_date BETWEEN $1 AND $2 AND NOT canceled
    ORDER BY start_date, start_at
  `, [FROM, TO]);
  return rows;
}

// ─── Onglet 1 : SYNTHÈSE MENSUELLE ───────────────────────────────────────────

async function exportSynthese(wb, { doin, nxt, stripe }) {
  const ws = wb.addWorksheet('SYNTHÈSE MENSUELLE');
  ws.columns = [
    { key: 'source', width: 32 }, { key: 'oct', width: 15 },
    { key: 'nov',    width: 15 }, { key: 'dec', width: 15 },
    { key: 'total',  width: 15 }, { key: 'note', width: 28 },
  ];

  ws.addRow([`RÉCONCILIATION TERRAIN T4 2025  (${FROM} → ${TO})`]);
  styleTitle(ws, 1);
  ws.addRow(['Source / Métrique', 'OCT 2025', 'NOV 2025', 'DÉC 2025', 'TOTAL T4', 'Note']);
  styleHeader(ws, 2);

  const MONTHS = ['2025-10', '2025-11', '2025-12'];
  const dMap = {}; for (const r of doin) dMap[r.mois] = r;
  const nMap = {}; for (const r of nxt)  nMap[r.mois] = r;
  const sMap = {}; for (const r of stripe) sMap[r.mois] = r;

  function row(label, vals, bgCol, note='', isBold=false) {
    let total = 0;
    const rowVals = [label];
    for (const m of MONTHS) {
      const v = parseFloat(vals[m] ?? 0);
      rowVals.push(isNaN(v) ? 0 : v);
      total += isNaN(v) ? 0 : v;
    }
    rowVals.push(Math.round(total*100)/100);
    rowVals.push(note);
    const r = ws.addRow(rowVals);
    for (let c = 2; c <= 5; c++) { numFmt(r.getCell(c), '#,##0.00'); right(r.getCell(c)); }
    if (bgCol)  for (let c = 1; c <= 5; c++) bg(r.getCell(c), bgCol);
    if (isBold) for (let c = 1; c <= 5; c++) bold(r.getCell(c));
    return r;
  }
  function intRow(label, vals, bgCol, note='') {
    let total = 0;
    const rowVals = [label];
    for (const m of MONTHS) { const v = parseInt(vals[m]??0); rowVals.push(v); total+=v; }
    rowVals.push(total); rowVals.push(note);
    const r = ws.addRow(rowVals);
    for (let c = 2; c <= 5; c++) { numFmt(r.getCell(c), '#,##0'); right(r.getCell(c)); }
    if (bgCol) for (let c=1;c<=5;c++) bg(r.getCell(c), bgCol);
    return r;
  }
  function sep(title, bgHex) {
    ws.addRow([]);
    ws.addRow([title]); styleHeader(ws, ws.rowCount, bgHex);
  }

  // ── Doinsport
  sep('DOINSPORT (réservations)', C.bleu_moyen);
  intRow('Réservations confirmées',  Object.fromEntries(MONTHS.map(m=>[m,dMap[m]?.confirmed??0])), C.bleu_clair);
  intRow('Réservations annulées',    Object.fromEntries(MONTHS.map(m=>[m,dMap[m]?.canceled_cnt??0])), null);
  intRow('Participants (confirmés)', Object.fromEntries(MONTHS.map(m=>[m,dMap[m]?.total_participants??0])), null);
  row('CA brut confirmé (€)',        Object.fromEntries(MONTHS.map(m=>[m,dMap[m]?.ca_brut??0])), C.vert_clair, 'Prix Doinsport (centimes/100)', true);
  row('CA payant (€, hors 0€)',      Object.fromEntries(MONTHS.map(m=>[m,dMap[m]?.ca_paye??0])), null, 'Hors promo 0€');
  intRow('Réservations gratuites',   Object.fromEntries(MONTHS.map(m=>[m,dMap[m]?.free_bookings??0])), C.jaune, 'Offres de lancement, tests');
  row('Prix moyen (€)',              Object.fromEntries(MONTHS.map(m=>[m,dMap[m]?.avg_price??0])), null, 'Sur réservations payantes');

  // ── Nextore
  sep('NEXTORE CAISSE (registres)', C.bleu_moyen);
  row('CA Terrain TTC caisse (€)',   Object.fromEntries(MONTHS.map(m=>[m,nMap[m]?.ca_terrain??0])), C.vert_clair, 'Nextore POS — segment TERRAIN', true);
  intRow('Nb sessions caisse',       Object.fromEntries(MONTHS.map(m=>[m,nMap[m]?.nb_sessions??0])), null, 'Count items terrain dans registres');

  // ── Stripe Belfius
  sep('STRIPE → BELFIUS (virements reçus)', C.bleu_moyen);
  row('Stripe reçu Belfius (€)',     Object.fromEntries(MONTHS.map(m=>[m,sMap[m]?.stripe_recu??0])), C.vert_clair, 'Belfius CREDIT counterparty=STRIPE', true);

  // ── Écarts
  sep('ÉCARTS', '7030A0');
  const ecart1 = Object.fromEntries(MONTHS.map(m => [m,
    (parseFloat(dMap[m]?.ca_brut??0)) - (parseFloat(nMap[m]?.ca_terrain??0))
  ]));
  const ecart2 = Object.fromEntries(MONTHS.map(m => [m,
    (parseFloat(sMap[m]?.stripe_recu??0)) - (parseFloat(dMap[m]?.ca_brut??0))
  ]));
  const r1 = row('Écart Doinsport - Nextore (€)', ecart1, C.jaune, 'Doinsport inclut online non enregistré en caisse');
  const r2 = row('Écart Stripe - Doinsport (€)',  ecart2, C.jaune, 'Stripe = paiements reçus (délai bancaire possible)');
  // Couleur selon signe
  for (const m of MONTHS) {
    const colIdx = MONTHS.indexOf(m) + 2;
    const v1 = parseFloat(ecart1[m]||0);
    const v2 = parseFloat(ecart2[m]||0);
    if (Math.abs(v1) > 100) fw(r1.getCell(colIdx), v1 < 0 ? C.rouge : C.vert_fonce);
    if (Math.abs(v2) > 100) fw(r2.getCell(colIdx), v2 < 0 ? C.rouge : C.vert_fonce);
  }

  // Note finale
  ws.addRow([]);
  ws.addRow(['ℹ️  Note : Doinsport = source réservations (CA contractuel). Nextore = caisse physique. Stripe = virements bancaires.']);
  ws.getRow(ws.rowCount).getCell(1).font = { italic: true, size: 10 };

  console.log('  ✅ Tab 1: SYNTHÈSE MENSUELLE');
}

// ─── Onglet 2 : PAR JOUR ─────────────────────────────────────────────────────

async function exportParJour(wb, days) {
  const ws = wb.addWorksheet('PAR JOUR');
  ws.columns = [
    { key: 'date',       width: 12 }, { key: 'resv',  width: 10 },
    { key: 'annul',      width: 10 }, { key: 'part',  width: 10 },
    { key: 'ca_doin',    width: 14 }, { key: 'ca_nxt', width: 14 },
    { key: 'ca_stripe',  width: 14 }, { key: 'ecart', width: 14 },
    { key: 'flag',       width: 14 },
  ];

  ws.addRow(['COMPARAISON QUOTIDIENNE — TERRAIN T4 2025']);
  styleTitle(ws, 1);
  ws.addRow(['Date', 'Réservés', 'Annulés', 'Participants', 'CA Doinsport', 'CA Nextore', 'Stripe Belfius', 'Écart (Doin-Nxt)', 'Statut']);
  styleHeader(ws, 2);

  let curMonth = '';
  for (const d of days) {
    const month = d.date.substring(0, 7);
    if (month !== curMonth) {
      curMonth = month;
      // Sous-total mois
      if (d.date !== days[0].date) ws.addRow([]);
      const mRow = ws.addRow([{ '2025-10': 'OCT 2025', '2025-11': 'NOV 2025', '2025-12': 'DÉC 2025' }[month] || month]);
      for (let c = 1; c <= 9; c++) bg(mRow.getCell(c), C.bleu_clair);
      bold(mRow.getCell(1));
    }

    const ca_doin   = d.ca_doin   || 0;
    const ca_nxt    = d.ca_nxt    || 0;
    const ca_stripe = d.ca_stripe || 0;
    const ecart     = Math.round((ca_doin - ca_nxt) * 100) / 100;
    const absEcart  = Math.abs(ecart);
    const flag      = absEcart > 500 ? '⚠ Écart > 500€' : absEcart > 100 ? 'Écart > 100€' : '';

    const row = ws.addRow([
      d.date,
      d.confirmed   || 0,
      d.canceled    || 0,
      d.participants || 0,
      ca_doin,
      ca_nxt    || null,
      ca_stripe || null,
      ecart,
      flag,
    ]);

    for (const c of [5,6,7,8]) { numFmt(row.getCell(c), '#,##0.00'); right(row.getCell(c)); }
    if (absEcart > 500) { bg(row.getCell(8), 'FCE4D6'); fw(row.getCell(8), C.rouge); }
    else if (absEcart > 100) bg(row.getCell(8), C.jaune);
    if (flag.startsWith('⚠')) fw(row.getCell(9), C.rouge);
  }

  console.log('  ✅ Tab 2: PAR JOUR');
}

// ─── Onglet 3 : ÉCARTS ───────────────────────────────────────────────────────

async function exportEcarts(wb, days) {
  const ws = wb.addWorksheet('ÉCARTS');
  ws.columns = [
    { key: 'date', width: 12 }, { key: 'ca_doin', width: 14 },
    { key: 'ca_nxt', width: 14 }, { key: 'ecart', width: 14 },
    { key: 'pct', width: 10 }, { key: 'cause', width: 36 },
  ];

  ws.addRow(['JOURS AVEC ÉCART SIGNIFICATIF (|Doinsport - Nextore| > 50€)']);
  styleTitle(ws, 1);
  ws.addRow(['Date', 'CA Doinsport', 'CA Nextore', 'Écart', '% écart', 'Cause probable']);
  styleHeader(ws, 2);

  const ecartDays = days
    .filter(d => Math.abs((d.ca_doin||0) - (d.ca_nxt||0)) > 50)
    .sort((a,b) => Math.abs((b.ca_doin||0)-(b.ca_nxt||0)) - Math.abs((a.ca_doin||0)-(a.ca_nxt||0)));

  for (const d of ecartDays) {
    const caDoin = d.ca_doin || 0;
    const caNxt  = d.ca_nxt  || 0;
    const ecart  = Math.round((caDoin - caNxt) * 100) / 100;
    const pct    = caDoin > 0 ? ecart / caDoin : null;
    const cause  = caNxt === 0 ? 'Pas de registre Nextore ce jour'
                 : caDoin === 0 ? 'Pas de réservation Doinsport'
                 : ecart > 0 ? 'Online (Stripe) non passé en caisse Nextore'
                 : 'Caisse > Doinsport (paiement direct/espèces?)';

    const row = ws.addRow([d.date, caDoin, caNxt, ecart, pct, cause]);
    for (const c of [2,3,4]) { numFmt(row.getCell(c), '#,##0.00'); right(row.getCell(c)); }
    if (pct !== null) { numFmt(row.getCell(5), '0.0%'); right(row.getCell(5)); }
    if (ecart > 0)  bg(row.getCell(4), C.jaune);
    else            { bg(row.getCell(4), C.orange); fw(row.getCell(4), C.rouge); }
  }

  // Stats
  ws.addRow([]);
  const totalEcart = ecartDays.reduce((s,d) => s + Math.abs((d.ca_doin||0)-(d.ca_nxt||0)), 0);
  const sumRow = ws.addRow([`${ecartDays.length} jours avec écart > 50€`, '', '', `Total abs: ${Math.round(totalEcart*100)/100}€`]);
  bold(sumRow.getCell(1)); bold(sumRow.getCell(4));

  console.log('  ✅ Tab 3: ÉCARTS');
}

// ─── Onglet 4 : PAR TERRAIN ──────────────────────────────────────────────────

async function exportParTerrain(wb, courts) {
  const ws = wb.addWorksheet('PAR TERRAIN');
  ws.columns = [
    { key: 'court',    width: 16 }, { key: 'confirmed', width: 12 },
    { key: 'canceled', width: 12 }, { key: 'ca', width: 14 },
    { key: 'avg_price',width: 14 }, { key: 'avg_dur', width: 14 },
    { key: 'pct',      width: 10 },
  ];

  ws.addRow(['RÉPARTITION PAR TERRAIN — DOINSPORT T4 2025']);
  styleTitle(ws, 1);
  ws.addRow(['Terrain', 'Confirmées', 'Annulées', 'CA (€)', 'Prix moyen', 'Durée moy (min)', '% CA']);
  styleHeader(ws, 2);

  const totalCA = courts.reduce((s,r) => s + parseFloat(r.ca||0), 0);
  for (const r of courts) {
    const ca  = parseFloat(r.ca||0);
    const pct = totalCA > 0 ? ca/totalCA : 0;
    const row = ws.addRow([r.court_key||'Inconnu', r.confirmed, r.canceled_cnt,
      ca, parseFloat(r.avg_price||0), parseFloat(r.avg_duration||0), pct]);
    numFmt(row.getCell(4), '#,##0.00'); right(row.getCell(4));
    numFmt(row.getCell(5), '#,##0.00'); right(row.getCell(5));
    numFmt(row.getCell(6), '#,##0.0');  right(row.getCell(6));
    numFmt(row.getCell(7), '0.0%');     right(row.getCell(7));
    for (let c = 1; c <= 7; c++) bg(row.getCell(c), C.vert_clair);
  }

  const totRow = ws.addRow(['TOTAL', courts.reduce((s,r)=>s+parseInt(r.confirmed||0),0),
    courts.reduce((s,r)=>s+parseInt(r.canceled_cnt||0),0), totalCA, '', '', 1]);
  numFmt(totRow.getCell(4), '#,##0.00'); numFmt(totRow.getCell(7), '0.0%');
  for (let c = 1; c <= 7; c++) { bold(totRow.getCell(c)); bg(totRow.getCell(c), C.bleu_clair); }

  console.log('  ✅ Tab 4: PAR TERRAIN');
}

// ─── Onglet 5 : PAR PRESTATION ───────────────────────────────────────────────

async function exportParPrestation(wb, timetables) {
  const ws = wb.addWorksheet('PAR PRESTATION');
  ws.columns = [
    { key: 'name',      width: 40 }, { key: 'confirmed', width: 12 },
    { key: 'ca',        width: 14 }, { key: 'avg_min',   width: 14 },
    { key: 'pct',       width: 10 },
  ];

  ws.addRow(['TOP PRESTATIONS — DOINSPORT T4 2025']);
  styleTitle(ws, 1);
  ws.addRow(['Prestation (timetable_name)', 'Confirmées', 'CA (€)', 'Durée moy (min)', '% CA']);
  styleHeader(ws, 2);

  const totalCA = timetables.reduce((s,r) => s + parseFloat(r.ca||0), 0);
  for (const r of timetables) {
    const ca  = parseFloat(r.ca||0);
    const pct = totalCA > 0 ? ca/totalCA : 0;
    const row = ws.addRow([r.timetable_name||'(vide)', r.confirmed, ca, r.avg_min||0, pct]);
    numFmt(row.getCell(3), '#,##0.00'); right(row.getCell(3));
    numFmt(row.getCell(4), '#,##0');    right(row.getCell(4));
    numFmt(row.getCell(5), '0.0%');     right(row.getCell(5));
  }

  console.log('  ✅ Tab 5: PAR PRESTATION');
}

// ─── Onglet 6 : ORIGINES ─────────────────────────────────────────────────────

async function exportOrigines(wb, origins) {
  const ws = wb.addWorksheet('ORIGINES');
  ws.columns = [
    { key: 'origin',    width: 28 }, { key: 'confirmed',   width: 12 },
    { key: 'canceled',  width: 12 }, { key: 'ca', width: 14 }, { key: 'pct', width: 10 },
  ];

  ws.addRow(['CANAL DE RÉSERVATION — DOINSPORT T4 2025']);
  styleTitle(ws, 1);
  ws.addRow(['Origine', 'Confirmées', 'Annulées', 'CA (€)', '% CA']);
  styleHeader(ws, 2);

  const totalCA = origins.reduce((s,r) => s + parseFloat(r.ca||0), 0);
  const ORIGIN_LABELS = {
    'white_label_app':  'App mobile Ardenne Padel',
    'administration':   'Administration / Back-office',
    'online':           'Web Doinsport',
    'white_label_web':  'Site web white-label',
  };

  for (const r of origins) {
    const ca  = parseFloat(r.ca||0);
    const pct = totalCA > 0 ? ca/totalCA : 0;
    const label = ORIGIN_LABELS[r.origin] || r.origin;
    const row = ws.addRow([label, r.confirmed, r.canceled_cnt, ca, pct]);
    numFmt(row.getCell(4), '#,##0.00'); right(row.getCell(4));
    numFmt(row.getCell(5), '0.0%');     right(row.getCell(5));
    for (let c=1;c<=5;c++) bg(row.getCell(c), C.bleu_clair);
  }

  console.log('  ✅ Tab 6: ORIGINES');
}

// ─── Onglet 7 : DÉTAIL DOINSPORT ─────────────────────────────────────────────

async function exportDetail(wb, rows) {
  const ws = wb.addWorksheet('DÉTAIL DOINSPORT');
  ws.columns = [
    { key: 'date',     width: 12 }, { key: 'debut',    width: 8 },
    { key: 'fin',      width: 8  }, { key: 'court',    width: 10 },
    { key: 'duree',    width: 8  }, { key: 'nom',      width: 28 },
    { key: 'reservant',width: 22 }, { key: 'part',     width: 8  },
    { key: 'prix',     width: 10 }, { key: 'paye',     width: 10 },
    { key: 'reste',    width: 10 }, { key: 'prestation',width: 32 },
    { key: 'origine',  width: 20 }, { key: 'code',     width: 8  },
  ];

  ws.addRow(['DÉTAIL RÉSERVATIONS CONFIRMÉES — DOINSPORT T4 2025']);
  styleTitle(ws, 1);
  ws.addRow(['Date', 'Début', 'Fin', 'Court', 'Durée (min)', 'Nom rés.', 'Réservant',
    'Participants', 'Prix (€)', 'Payé (€)', 'Reste (€)', 'Prestation', 'Origine', 'Code']);
  styleHeader(ws, 2);

  let curMonth = '';
  for (const r of rows) {
    const dateStr = r.start_date.toISOString().slice(0,10);
    const month   = dateStr.slice(0,7);
    if (month !== curMonth) {
      curMonth = month;
      const mRow = ws.addRow([{ '2025-10': 'OCT 2025', '2025-11': 'NOV 2025', '2025-12': 'DÉC 2025' }[month] || month]);
      for (let c=1;c<=14;c++) bg(mRow.getCell(c), C.bleu_clair);
      bold(mRow.getCell(1));
    }

    const fmt = dt => dt ? new Date(dt).toLocaleTimeString('fr-BE',{hour:'2-digit',minute:'2-digit',timeZone:'Europe/Brussels'}) : '';
    const row = ws.addRow([
      dateStr, fmt(r.start_at), fmt(r.end_at), r.court_key, r.duration_min,
      r.name, r.reservant, r.participants_count,
      parseFloat(r.price_eur||0), parseFloat(r.payments_eur||0), parseFloat(r.rest_eur||0),
      r.timetable_name, r.origin, r.access_code,
    ]);
    numFmt(row.getCell(9),  '#,##0.00'); right(row.getCell(9));
    numFmt(row.getCell(10), '#,##0.00'); right(row.getCell(10));
    numFmt(row.getCell(11), '#,##0.00'); right(row.getCell(11));
    if (parseFloat(r.rest_eur||0) > 0) fw(row.getCell(11), C.rouge);
  }

  console.log('  ✅ Tab 7: DÉTAIL DOINSPORT');
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log(' Ardenne Padel PNL — Réconciliation Terrain T4 2025');
  console.log(`  Période : ${FROM} → ${TO}`);
  console.log(`  Output  : ${OUT_PATH}`);
  console.log('═══════════════════════════════════════════════════════════\n');

  console.log('>>> Chargement données...');
  const [doin, nxt, stripe, days, courts, timetables, origins, detail] = await Promise.all([
    queryDoinsportMonthly(),
    queryNextoreMonthly(),
    queryStripeMonthly(),
    queryByDay(),
    queryByCourt(),
    queryByTimetable(),
    queryByOrigin(),
    queryDetail(),
  ]);
  console.log(`  Doinsport: ${doin.reduce((s,r)=>s+parseInt(r.confirmed||0),0)} résv. confirmées T4`);
  console.log(`  Nextore: ${nxt.length} registres / ${days.filter(d=>d.ca_nxt>0).length} jours avec CA`);
  console.log(`  Stripe: ${stripe.length} virements\n`);

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Claude Code — Ardenne Padel PNL';
  wb.created = new Date();

  await exportSynthese(wb,     { doin, nxt, stripe });
  await exportParJour(wb,      days);
  await exportEcarts(wb,       days);
  await exportParTerrain(wb,   courts);
  await exportParPrestation(wb, timetables);
  await exportOrigines(wb,     origins);
  await exportDetail(wb,       detail);

  await wb.xlsx.writeFile(OUT_PATH);
  console.log(`\n✅  Fichier généré : ${OUT_PATH}\n`);

  await pool.end();
}

main().catch(err => {
  console.error('❌  Erreur fatale :', err.message);
  process.exit(1);
});
