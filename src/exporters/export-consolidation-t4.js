// src/exporters/export-consolidation-t4.js
// Dashboard de consolidation T4 2025 — Ardenne Padel / CQFD Consult
//
// Onglets :
//   1. P&L SYNTHÈSE   — compte de résultat condensé par mois
//   2. CA SOURCES      — CA caisse vs Belfius (validation)
//   3. CHARGES BAR     — Detrembleur + autres achats + RH NOWJOBS + marge
//   4. CHARGES BELFIUS — toutes transactions DEBIT T4, catégorisées
//   5. RAPPROCHEMENT   — Belfius CREDIT croisé par source
//
// Usage : node src/exporters/export-consolidation-t4.js

import path from 'path';
import dotenv from 'dotenv';
import ExcelJS from 'exceljs';
import { pool } from '../../db.js';

dotenv.config();

const DATA_DIR  = process.env.DATA_DIR ||
  '/mnt/c/Users/stark/OneDrive - Antoine Zingaro (CQFD Consult)/Boulot New/Ardenne Padel/_Finance/PNL/Shared';
const OUT_PATH  = path.join(DATA_DIR, 'BDO T4 - 2025/Analyse/CONSOLIDATION_T4_2025.xlsx');

const MONTHS    = ['2025-10', '2025-11', '2025-12'];
const MONTH_LBL = { '2025-10': 'OCT 2025', '2025-11': 'NOV 2025', '2025-12': 'DÉC 2025' };
const T4_START  = '2025-10-01';
const T4_END    = '2025-12-31';

// ─── Catégorisation Belfius DEBIT ─────────────────────────────────────────────

function categorizeCounterparty(name) {
  if (!name) return 'AUTRES';
  const n = name.toUpperCase();
  if (n.includes('JM PADEL'))                           return 'INFRASTRUCTURE';
  if (n.includes('KLS'))                                return 'TRAVAUX';
  if (n.includes('BDO'))                                return 'COMPTABILITE';
  if (n.includes('HEBEI') || n.includes('SAIDEWEI'))    return 'MATERIEL TERRAIN';
  if (n.includes('SHENZHEN') || n.includes('ZHONGYIRUI')) return 'MATERIEL TERRAIN';
  if (n.includes('EUROPABANK'))                         return 'COMMISSIONS PAIEMENT';
  if (n.includes('ENGIE'))                              return 'ENERGIE';
  if (n.includes('PROXIMUS') || n.includes('VOXBONE') || n.includes('TELENET')) return 'TELECOM';
  if (n.includes('NOWJOBS') || n.includes('NOW JOBS')) return 'RH BAR [dédié]';
  if (n.includes('DETREMBLEUR'))                        return 'FOURNISSEUR BAR [dédié]';
  if (n.includes('DOINSPORT'))                          return 'LOGICIEL RESERVATION';
  if (n.includes('NAYAX'))                              return 'DISTRIBUTEURS';
  if (n.includes('LEENBAKER'))                          return 'NEUTRALISER ⚠';
  if (n.includes('XERIUS'))                             return 'CHARGES SOCIALES';
  if (n.includes('AMAZON'))                             return 'ACHATS DIVERS';
  if (n.includes('COLRUYT') || n.includes('COMARCH'))   return 'FOURNISSEUR BAR [dédié]';
  if (n.includes('KTM'))                                return 'VEHICULE ⚠ (vente)';
  if (n.includes('SAMRAY') || n.includes('NEXT PAD'))  return 'REMBOURSEMENT CLIENT';
  if (n.includes('VISA') || n.includes('MASTERCARD'))  return 'CARTE BANCAIRE';
  return 'AUTRES';
}

// ─── Couleurs & styles ────────────────────────────────────────────────────────

const C = {
  bleu_fonce:  '1F3864', bleu_moyen: '2F75B6', bleu_clair: 'BDD7EE',
  vert_fonce:  '375623', vert_clair: 'E2EFDA',
  orange_fond: 'FCE4D6', orange_titre: 'C55A11',
  jaune:       'FFFF00', gris:        'D9D9D9',
  blanc:       'FFFFFF', noir:        '000000',
  rouge:       'C00000',
};

function bg(cell, hex)  { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + hex } }; }
function bold(cell)     { cell.font = { ...(cell.font || {}), bold: true }; }
function fw(cell, hex)  { cell.font = { ...(cell.font || {}), color: { argb: 'FF' + hex } }; }
function numFmt(cell, fmt) { cell.numFmt = fmt; }
function align(cell, h, v = 'middle') { cell.alignment = { horizontal: h, vertical: v, wrapText: false }; }
function border(cell) {
  cell.border = {
    top: { style: 'thin', color: { argb: 'FF' + C.gris } },
    bottom: { style: 'thin', color: { argb: 'FF' + C.gris } },
  };
}

function styleTitle(ws, rowNum) {
  const row = ws.getRow(rowNum);
  for (let c = 1; c <= 6; c++) {
    bg(row.getCell(c), C.bleu_fonce); fw(row.getCell(c), C.blanc); bold(row.getCell(c));
  }
  row.height = 22;
}
function styleSectionHeader(ws, rowNum, color = C.bleu_moyen) {
  const row = ws.getRow(rowNum);
  for (let c = 1; c <= 6; c++) {
    bg(row.getCell(c), color); fw(row.getCell(c), C.blanc); bold(row.getCell(c));
  }
  row.height = 18;
}
function styleTotalRow(ws, rowNum, fgColor = C.bleu_clair) {
  const row = ws.getRow(rowNum);
  for (let c = 1; c <= 6; c++) {
    bg(row.getCell(c), fgColor); bold(row.getCell(c));
  }
}

// ─── Requêtes SQL ─────────────────────────────────────────────────────────────

async function queryCA(client) {
  // CA depuis registres Nextore (terrain / bar / acces / total)
  const { rows: seg } = await client.query(`
    SELECT TO_CHAR(r.open_date,'YYYY-MM') mois,
           ROUND(SUM(CASE WHEN s.segment='TERRAIN' THEN s.amount END)::numeric,2) terrain,
           ROUND(SUM(CASE WHEN s.segment='BAR'     THEN s.amount END)::numeric,2) bar,
           ROUND(SUM(CASE WHEN s.segment='ACCES'   THEN s.amount END)::numeric,2) acces
    FROM nr_registers r JOIN nr_sales s ON s.register_id=r.id
    WHERE r.open_date BETWEEN $1 AND $2 AND s.segment != 'TOTAL'
    GROUP BY mois ORDER BY mois
  `, [T4_START, T4_END]);

  const { rows: tot } = await client.query(`
    SELECT TO_CHAR(open_date,'YYYY-MM') mois,
           ROUND(SUM(total_ttc)::numeric,2) total_ttc,
           SUM(tickets_count) tickets
    FROM nr_registers
    WHERE open_date BETWEEN $1 AND $2
    GROUP BY mois ORDER BY mois
  `, [T4_START, T4_END]);

  const map = {};
  for (const r of seg) map[r.mois] = { ...r };
  for (const r of tot) map[r.mois] = { ...(map[r.mois] || {}), ...r };
  return map;
}

async function queryBelfiusCredits(client) {
  // CREDIT Belfius par source
  const { rows } = await client.query(`
    SELECT TO_CHAR(transaction_date,'YYYY-MM') mois,
           ROUND(SUM(CASE WHEN counterparty_name ILIKE '%STRIPE%'       THEN amount END)::numeric,2) stripe,
           ROUND(SUM(CASE WHEN counterparty_name ILIKE '%EUROPABANK%'   THEN amount END)::numeric,2) europabank,
           ROUND(SUM(CASE WHEN counterparty_name ILIKE '%NAYAX%'
                        OR description          ILIKE '%NAYAX%'        THEN amount END)::numeric,2) nayax,
           ROUND(SUM(CASE WHEN counterparty_name ILIKE '%DOINSPORT%'    THEN amount END)::numeric,2) doinsport,
           ROUND(SUM(amount)::numeric,2) total_credit
    FROM bank_transactions
    WHERE direction='CREDIT' AND transaction_date BETWEEN $1 AND $2
    GROUP BY mois ORDER BY mois
  `, [T4_START, T4_END]);
  const map = {};
  for (const r of rows) map[r.mois] = r;
  return map;
}

async function queryDetrembleur(client) {
  const { rows } = await client.query(`
    SELECT TO_CHAR(i.invoice_date,'YYYY-MM') mois,
           i.doc_type,
           ROUND(SUM(i.total_a_payer)::numeric,2)                                   ttc,
           ROUND(SUM(COALESCE(i.total_htva_21,0)+COALESCE(i.total_htva_6,0))::numeric,2) htva
    FROM invoices i JOIN suppliers s ON s.id=i.supplier_id AND s.code='DETREMBLEUR'
    WHERE i.invoice_date BETWEEN $1 AND $2
    GROUP BY mois, i.doc_type ORDER BY mois
  `, [T4_START, T4_END]);
  const map = {};
  for (const r of rows) {
    if (!map[r.mois]) map[r.mois] = { factures_ttc: 0, avoirs_ttc: 0, net_ttc: 0, htva: 0 };
    if (r.doc_type === 'AVOIR') {
      map[r.mois].avoirs_ttc += parseFloat(r.ttc) || 0;
    } else {
      map[r.mois].factures_ttc += parseFloat(r.ttc) || 0;
      map[r.mois].htva         += parseFloat(r.htva) || 0;
    }
    map[r.mois].net_ttc = map[r.mois].factures_ttc - map[r.mois].avoirs_ttc;
  }
  return map;
}

async function queryOtherPurchases(client) {
  const { rows } = await client.query(`
    SELECT period_month mois,
           ROUND(SUM(amount_htva)::numeric,2) htva,
           ROUND(SUM(COALESCE(amount_ttc, amount_htva * 1.21))::numeric,2) ttc
    FROM other_purchases
    WHERE period_month BETWEEN '2025-10' AND '2025-12'
    GROUP BY mois ORDER BY mois
  `);
  const map = {};
  for (const r of rows) map[r.mois] = r;
  return map;
}

async function queryNowjobs(client) {
  const { rows } = await client.query(`
    SELECT TO_CHAR(shift_date,'YYYY-MM') mois,
           ROUND(SUM(cost_prorata)::numeric,2) cout_htva
    FROM nowjobs_prestations
    WHERE shift_date BETWEEN $1 AND $2
    GROUP BY mois ORDER BY mois
  `, [T4_START, T4_END]);
  const map = {};
  for (const r of rows) map[r.mois] = r;
  return map;
}

async function queryBelfiusDebits(client) {
  const { rows } = await client.query(`
    SELECT transaction_date, amount, signed_amount,
           counterparty_name, counterparty_iban,
           LEFT(description,50) description,
           LEFT(narrative,60)   narrative,
           source_file
    FROM bank_transactions
    WHERE direction='DEBIT' AND transaction_date BETWEEN $1 AND $2
    ORDER BY transaction_date, amount DESC
  `, [T4_START, T4_END]);
  return rows.map(r => ({ ...r, categorie: categorizeCounterparty(r.counterparty_name) }));
}

async function queryDebitsByCategory(client) {
  const rows = await queryBelfiusDebits(client);
  const map  = {}; // { mois: { categorie: total } }
  for (const r of rows) {
    const mois = new Date(r.transaction_date).toISOString().slice(0, 7);
    if (!map[mois]) map[mois] = {};
    const cat = r.categorie;
    map[mois][cat] = (map[mois][cat] || 0) + parseFloat(r.amount);
  }
  return map;
}

// ─── Tab 1 : P&L SYNTHÈSE ─────────────────────────────────────────────────────

async function exportPnlSynthese(wb, { ca, debits, detrembleur, otherPurchases, nowjobs }) {
  const ws = wb.addWorksheet('P&L SYNTHÈSE');
  ws.columns = [
    { key: 'label',  width: 38 },
    { key: 'oct',    width: 16 },
    { key: 'nov',    width: 16 },
    { key: 'dec',    width: 16 },
    { key: 'total',  width: 16 },
    { key: 'notes',  width: 28 },
  ];

  const FMT = '#,##0.00';
  const PCT = '0.0%';

  function addRow(label, vals, opts = {}) {
    const r = ws.addRow([
      label,
      vals['2025-10'] ?? null,
      vals['2025-11'] ?? null,
      vals['2025-12'] ?? null,
      vals.total ?? null,
      opts.note ?? null,
    ]);
    const fmt = opts.pct ? PCT : FMT;
    for (let c = 2; c <= 5; c++) {
      const cell = r.getCell(c);
      if (cell.value !== null) numFmt(cell, fmt);
      align(cell, 'right');
      if (opts.bold) bold(cell);
      if (opts.bg) bg(cell, opts.bg);
      if (opts.color) fw(cell, opts.color);
      border(cell);
    }
    if (opts.bold)   bold(r.getCell(1));
    if (opts.bg)     bg(r.getCell(1), opts.bg);
    if (opts.color)  fw(r.getCell(1), opts.color);
    if (opts.italic) r.getCell(1).font = { ...(r.getCell(1).font || {}), italic: true };
    return r;
  }

  function sumMonths(map, field) {
    const v = {};
    let t = 0;
    for (const m of MONTHS) {
      v[m] = parseFloat(map[m]?.[field] || 0);
      t += v[m];
    }
    v.total = Math.round(t * 100) / 100;
    return v;
  }

  function rawMonths(map, field) {
    const v = {};
    let t = 0;
    for (const m of MONTHS) {
      v[m] = parseFloat(map[m]?.[field] || 0);
      t += v[m];
    }
    v.total = Math.round(t * 100) / 100;
    return v;
  }

  // ── Titre
  ws.addRow(['CONSOLIDATION T4 2025 — ARDENNE PADEL / CQFD CONSULT']);
  styleTitle(ws, 1); ws.getRow(1).height = 26;
  ws.getRow(1).getCell(1).font = { bold: true, size: 14, color: { argb: 'FFFFFFFF' } };

  ws.addRow(['', 'OCT 2025', 'NOV 2025', 'DÉC 2025', 'TOTAL T4', 'Notes']);
  const hdr = ws.getRow(2);
  for (let c = 1; c <= 6; c++) {
    bg(hdr.getCell(c), C.bleu_moyen); fw(hdr.getCell(c), C.blanc); bold(hdr.getCell(c));
    align(hdr.getCell(c), c === 1 ? 'left' : 'center');
  }
  hdr.height = 18;

  ws.addRow([]);

  // ── REVENUS
  styleSectionHeader(ws, ws.rowCount + 1, C.vert_fonce);
  ws.addRow(['REVENUS']);
  ws.getRow(ws.rowCount).getCell(1).font = { bold: true, size: 12, color: { argb: 'FFFFFFFF' } };

  const terrain = sumMonths(ca, 'terrain');
  const bar     = sumMonths(ca, 'bar');
  const acces   = sumMonths(ca, 'acces');
  const ttc     = rawMonths(ca, 'total_ttc');
  const tickets = rawMonths(ca, 'tickets');

  addRow('CA Terrain TTC (caisse Nextore)',     terrain,  { bg: 'E2EFDA' });
  addRow('CA Bar TTC (caisse Nextore)',         bar,      { bg: 'E2EFDA' });
  addRow('CA Accessoires TTC',                 acces,    { bg: 'E2EFDA', note: 'Tubes balles, etc.' });

  const totCA = {};
  for (const m of [...MONTHS, 'total']) totCA[m] = (terrain[m]||0) + (bar[m]||0) + (acces[m]||0);
  addRow('TOTAL CA CAISSE TTC', totCA, { bold: true, bg: C.vert_clair });

  addRow('Tickets (clients servis)', tickets, { note: 'Nextore — nb tickets enregistrés' });
  ws.addRow([]);

  // ── VALIDATION CA (Belfius)
  styleSectionHeader(ws, ws.rowCount + 1, '4472C4');
  ws.addRow(['VALIDATION CA — BELFIUS CRÉDIT']);

  const { rows: bCred } = await pool.query(`
    SELECT TO_CHAR(transaction_date,'YYYY-MM') mois,
           ROUND(SUM(CASE WHEN counterparty_name ILIKE '%STRIPE%'     THEN amount END)::numeric,2) stripe,
           ROUND(SUM(CASE WHEN counterparty_name ILIKE '%EUROPABANK%' THEN amount END)::numeric,2) europabank,
           ROUND(SUM(amount)::numeric,2) total_credit
    FROM bank_transactions
    WHERE direction='CREDIT' AND transaction_date BETWEEN $1 AND $2
    GROUP BY mois ORDER BY mois
  `, [T4_START, T4_END]);
  const bcMap = {};
  for (const r of bCred) bcMap[r.mois] = r;

  addRow('Stripe → Belfius (CA terrain réceptionné)', rawMonths(bcMap, 'stripe'),     { note: 'Réf. réconciliation terrain' });
  addRow('Europabank → Belfius (CA bar réceptionné)', rawMonths(bcMap, 'europabank'), { note: 'Réf. réconciliation bar' });
  addRow('TOTAL CRÉDIT Belfius T4',                   rawMonths(bcMap, 'total_credit'), { bold: true, bg: C.bleu_clair });
  ws.addRow([]);

  // ── CHARGES BAR
  styleSectionHeader(ws, ws.rowCount + 1, C.orange_titre);
  ws.addRow(['CHARGES BAR DIRECTES']);

  const detr      = sumMonths(detrembleur, 'net_ttc');
  const detrHtva  = sumMonths(detrembleur, 'htva');
  const autresAch = sumMonths(otherPurchases, 'htva');
  const rh        = sumMonths(nowjobs, 'cout_htva');

  addRow('Achats Detrembleur TTC (net avoirs)',    detr,      { bg: C.orange_fond });
  addRow('Autres achats bar HTVA (Colruyt, etc.)', autresAch, { bg: C.orange_fond, note: 'Colruyt + Comarché + Conte de Salm' });
  addRow('RH NOWJOBS HTVA (bar)',                  rh,        { bg: C.orange_fond });

  const totChargesBar = {};
  for (const m of [...MONTHS, 'total'])
    totChargesBar[m] = (detr[m]||0) + (autresAch[m]||0) + (rh[m]||0);
  addRow('TOTAL CHARGES BAR', totChargesBar, { bold: true, bg: C.orange_fond });

  // Marge bar
  const margeBar = {};
  for (const m of [...MONTHS, 'total'])
    margeBar[m] = Math.round(((bar[m]||0) - (totChargesBar[m]||0)) * 100) / 100;
  addRow('MARGE BAR BRUTE (€)', margeBar, {
    bold: true,
    bg:    margeBar.total >= 0 ? C.vert_clair : 'FCE4D6',
    color: margeBar.total >= 0 ? C.vert_fonce : C.orange_titre,
    note: '= CA Bar - Charges bar (sans charges fixes)'
  });

  const margePct = {};
  for (const m of [...MONTHS, 'total'])
    margePct[m] = bar[m] > 0 ? margeBar[m] / bar[m] : null;
  addRow('MARGE BAR %', margePct, { pct: true, note: '% sur CA Bar TTC' });
  ws.addRow([]);

  // ── CHARGES BELFIUS (agrégées par catégorie)
  styleSectionHeader(ws, ws.rowCount + 1, '7030A0');
  ws.addRow(['CHARGES BELFIUS T4 (DÉBIT — agrégé par catégorie)']);

  // Agréger par catégorie et par mois
  const topCats = [
    'INFRASTRUCTURE', 'TRAVAUX', 'MATERIEL TERRAIN', 'COMPTABILITE',
    'ENERGIE', 'LOGICIEL RESERVATION', 'COMMISSIONS PAIEMENT',
    'CHARGES SOCIALES', 'RH BAR [dédié]', 'FOURNISSEUR BAR [dédié]',
    'ACHATS DIVERS', 'AUTRES',
  ];

  const debitRows = await queryBelfiusDebits(pool);
  const catMap = {};
  for (const r of debitRows) {
    const mois = new Date(r.transaction_date).toISOString().slice(0, 7);
    const cat  = r.categorie;
    if (!catMap[cat]) catMap[cat] = {};
    catMap[cat][mois] = (catMap[cat][mois] || 0) + parseFloat(r.amount);
  }
  // Arrondir
  for (const cat of Object.keys(catMap))
    for (const m of Object.keys(catMap[cat]))
      catMap[cat][m] = Math.round(catMap[cat][m] * 100) / 100;

  let totalDebit = { '2025-10': 0, '2025-11': 0, '2025-12': 0, total: 0 };

  for (const cat of topCats) {
    const vals = catMap[cat];
    if (!vals) continue;
    let t = 0;
    const row = {};
    for (const m of MONTHS) { row[m] = vals[m] || 0; t += row[m]; }
    row.total = Math.round(t * 100) / 100;

    const isDedicated = cat.includes('[dédié]');
    const isWarn      = cat.includes('⚠');
    const note        = isDedicated ? '⬆ compté dans charges bar' : (isWarn ? '⚠ Vérifier' : '');
    addRow(cat, row, {
      bg:    isDedicated ? C.gris : (isWarn ? 'FFF2CC' : null),
      italic: isDedicated,
      note,
    });

    if (!isDedicated) {
      for (const m of MONTHS) totalDebit[m] += row[m];
      totalDebit.total += row.total;
    }
  }

  // Arrondir totaux
  for (const m of [...MONTHS, 'total']) totalDebit[m] = Math.round(totalDebit[m] * 100) / 100;
  addRow('TOTAL CHARGES BELFIUS (hors dédié)', totalDebit, { bold: true, bg: 'DDD9C4' });
  ws.addRow([]);

  // ── RÉSULTAT
  styleSectionHeader(ws, ws.rowCount + 1, C.bleu_fonce);
  ws.addRow(['RÉSULTAT (avant investissements & amortissements)']);

  const resultat = {};
  for (const m of [...MONTHS, 'total'])
    resultat[m] = Math.round(((totCA[m]||0) - (totChargesBar[m]||0) - (totalDebit[m]||0)) * 100) / 100;
  addRow('RÉSULTAT NET T4', resultat, {
    bold: true, bg: C.bleu_clair,
    note: '= CA - Charges bar - OPEX Belfius (hors invest.)'
  });

  ws.addRow([]);
  ws.addRow(['⚠ Hors scope : ~15 264€ charges T3 dans T4, crédits investissements, amortissements']);
  ws.getRow(ws.rowCount).getCell(1).font = { italic: true, color: { argb: 'FFFF0000' }, size: 10 };

  console.log('  ✅ Tab 1: P&L SYNTHÈSE');
}

// ─── Tab 2 : CA SOURCES ───────────────────────────────────────────────────────

async function exportCaSources(wb, ca) {
  const ws = wb.addWorksheet('CA SOURCES');
  ws.columns = [
    { key: 'source', width: 36 }, { key: 'oct', width: 14 },
    { key: 'nov',    width: 14 }, { key: 'dec', width: 14 },
    { key: 'total',  width: 14 }, { key: 'note', width: 30 },
  ];

  ws.addRow(['CA PAR SOURCE — T4 2025']);
  styleTitle(ws, 1);

  ws.addRow(['Source', 'OCT 2025', 'NOV 2025', 'DÉC 2025', 'TOTAL T4', 'Note']);
  const hdr = ws.getRow(2);
  for (let c = 1; c <= 6; c++) { bg(hdr.getCell(c), C.bleu_moyen); fw(hdr.getCell(c), C.blanc); bold(hdr.getCell(c)); }

  function row(label, data, bgCol, note = '') {
    const r = ws.addRow([label,
      data['2025-10'] || 0, data['2025-11'] || 0, data['2025-12'] || 0,
      data.total || 0, note,
    ]);
    for (let c = 2; c <= 5; c++) { numFmt(r.getCell(c), '#,##0.00'); align(r.getCell(c), 'right'); }
    if (bgCol) for (let c = 1; c <= 5; c++) bg(r.getCell(c), bgCol);
    return r;
  }

  // Nextore registres
  ws.addRow(['CAISSE NEXTORE (registres)']);
  styleSectionHeader(ws, ws.rowCount, '375623');

  const terrain = {}; const bar = {}; const acces = {}; const ttc = {};
  let tTerrain = 0, tBar = 0, tAcces = 0, tTtc = 0;
  for (const m of MONTHS) {
    terrain[m] = parseFloat(ca[m]?.terrain || 0); tTerrain += terrain[m];
    bar[m]     = parseFloat(ca[m]?.bar     || 0); tBar     += bar[m];
    acces[m]   = parseFloat(ca[m]?.acces   || 0); tAcces   += acces[m];
    ttc[m]     = parseFloat(ca[m]?.total_ttc || 0); tTtc   += ttc[m];
  }
  terrain.total = Math.round(tTerrain * 100) / 100;
  bar.total     = Math.round(tBar     * 100) / 100;
  acces.total   = Math.round(tAcces   * 100) / 100;
  ttc.total     = Math.round(tTtc     * 100) / 100;

  row('CA Terrain TTC',       terrain, 'E2EFDA', 'Location terrains padel');
  row('CA Bar TTC',           bar,     'E2EFDA', 'Boissons, snacks');
  row('CA Accessoires TTC',   acces,   'E2EFDA', 'Tubes balles, raquettes');
  const totRow = row('TOTAL CA CAISSE TTC', ttc, C.vert_clair);
  for (let c = 1; c <= 5; c++) bold(totRow.getCell(c));

  // Belfius crédit
  ws.addRow([]);
  ws.addRow(['BELFIUS — CRÉDIT (reçu)']);
  styleSectionHeader(ws, ws.rowCount, '2F75B6');

  const { rows: bcRows } = await pool.query(`
    SELECT TO_CHAR(transaction_date,'YYYY-MM') mois,
           ROUND(SUM(CASE WHEN counterparty_name ILIKE '%STRIPE%'      THEN amount END)::numeric,2) stripe,
           ROUND(SUM(CASE WHEN counterparty_name ILIKE '%EUROPABANK%'  THEN amount END)::numeric,2) europabank,
           ROUND(SUM(CASE WHEN counterparty_name ILIKE '%NAYAX%'
                        OR description ILIKE '%NAYAX%'                 THEN amount END)::numeric,2) nayax,
           ROUND(SUM(CASE WHEN counterparty_name ILIKE '%DOINSPORT%'
                        AND counterparty_name NOT ILIKE '%STRIPE%'     THEN amount END)::numeric,2) doinsport_other,
           ROUND(SUM(amount)::numeric,2) total
    FROM bank_transactions WHERE direction='CREDIT' AND transaction_date BETWEEN $1 AND $2
    GROUP BY mois ORDER BY mois
  `, [T4_START, T4_END]);

  const bc = {};
  for (const r of bcRows) bc[r.mois] = r;

  for (const field of ['stripe', 'europabank', 'nayax', 'doinsport_other', 'total']) {
    const vals = {}; let t = 0;
    for (const m of MONTHS) { vals[m] = parseFloat(bc[m]?.[field] || 0); t += vals[m]; }
    vals.total = Math.round(t * 100) / 100;
    const label = {
      stripe:          'Stripe (terrains Doinsport)',
      europabank:      'Europabank (bar CB)',
      nayax:           'Nayax (distributeurs)',
      doinsport_other: 'Doinsport (abonnement etc.)',
      total:           'TOTAL CRÉDIT BELFIUS T4',
    }[field];
    const r = row(label, vals, field === 'total' ? C.bleu_clair : null,
      field === 'stripe' ? 'Réf. croisée CA Terrain' :
      field === 'europabank' ? 'Réf. croisée CA Bar' : '');
    if (field === 'total') for (let c = 1; c <= 5; c++) bold(r.getCell(c));
  }

  // Écarts terrain (Stripe Belfius vs CA Nextore)
  ws.addRow([]);
  ws.addRow(['RAPPROCHEMENT TERRAIN']);
  styleSectionHeader(ws, ws.rowCount, '7030A0');

  const ecart = {};
  for (const m of MONTHS) {
    const stripe = parseFloat(bc[m]?.stripe || 0);
    const ter    = terrain[m] || 0;
    ecart[m] = Math.round((stripe - ter) * 100) / 100;
  }
  ecart.total = Math.round((MONTHS.reduce((s, m) => s + ecart[m], 0)) * 100) / 100;

  row('CA Terrain TTC (Nextore)', terrain, null, 'Source: registres caisse');
  row('Stripe reçu Belfius',      { '2025-10': parseFloat(bc['2025-10']?.stripe||0),
                                    '2025-11': parseFloat(bc['2025-11']?.stripe||0),
                                    '2025-12': parseFloat(bc['2025-12']?.stripe||0),
                                    total: Math.round(MONTHS.reduce((s,m)=>s+parseFloat(bc[m]?.stripe||0),0)*100)/100 },
    null, 'Source: Belfius CREDIT');
  const eRow = row('ÉCART (Stripe - Terrain)', ecart, 'FFF2CC',
    'Timing: ventes non encore reçues ou décalage');
  for (let c = 2; c <= 5; c++) fw(eRow.getCell(c), ecart.total < -500 ? C.rouge : '375623');

  console.log('  ✅ Tab 2: CA SOURCES');
}

// ─── Tab 3 : CHARGES BAR ──────────────────────────────────────────────────────

async function exportChargesBar(wb, { detrembleur, otherPurchases, nowjobs }) {
  const ws = wb.addWorksheet('CHARGES BAR');
  ws.columns = [
    { key: 'label', width: 34 }, { key: 'oct', width: 14 },
    { key: 'nov',   width: 14 }, { key: 'dec', width: 14 },
    { key: 'total', width: 14 }, { key: 'note', width: 30 },
  ];

  ws.addRow(['CHARGES BAR DÉTAIL — T4 2025']);
  styleTitle(ws, 1);
  ws.addRow(['Poste', 'OCT 2025', 'NOV 2025', 'DÉC 2025', 'TOTAL T4', 'Note']);
  const hdr = ws.getRow(2);
  for (let c = 1; c <= 6; c++) { bg(hdr.getCell(c), C.bleu_moyen); fw(hdr.getCell(c), C.blanc); bold(hdr.getCell(c)); }

  function row(label, vals, bgCol, note = '', isBold = false) {
    const t = Math.round(MONTHS.reduce((s, m) => s + (parseFloat(vals[m]) || 0), 0) * 100) / 100;
    const r = ws.addRow([label,
      parseFloat(vals['2025-10']) || 0, parseFloat(vals['2025-11']) || 0,
      parseFloat(vals['2025-12']) || 0, t, note,
    ]);
    for (let c = 2; c <= 5; c++) { numFmt(r.getCell(c), '#,##0.00'); align(r.getCell(c), 'right'); }
    if (bgCol)  for (let c = 1; c <= 5; c++) bg(r.getCell(c), bgCol);
    if (isBold) for (let c = 1; c <= 5; c++) bold(r.getCell(c));
    return r;
  }

  // Detrembleur
  ws.addRow(['DETREMBLEUR (boissons, fûts)']);
  styleSectionHeader(ws, ws.rowCount, C.bleu_moyen);

  const { rows: dRows } = await pool.query(`
    SELECT TO_CHAR(i.invoice_date,'YYYY-MM') mois, i.doc_type,
           i.invoice_number, ROUND(i.total_a_payer::numeric,2) ttc,
           ROUND((COALESCE(i.total_htva_21,0)+COALESCE(i.total_htva_6,0))::numeric,2) htva
    FROM invoices i JOIN suppliers s ON s.id=i.supplier_id AND s.code='DETREMBLEUR'
    WHERE i.invoice_date BETWEEN $1 AND $2 ORDER BY i.invoice_date
  `, [T4_START, T4_END]);

  for (const r of dRows) {
    const isAvoir = r.doc_type === 'AVOIR';
    const rr = ws.addRow([
      `  ${r.doc_type} ${r.invoice_number}`, '', '', '', '',
      `Date: ${new Date(r.mois+'-01').toLocaleDateString('fr-BE',{month:'short',year:'numeric'})}`
    ]);
    // Mettre le montant dans la bonne colonne de mois
    const colIdx = MONTHS.indexOf(r.mois);
    if (colIdx >= 0) {
      const cell = rr.getCell(colIdx + 2);
      cell.value = isAvoir ? -parseFloat(r.ttc) : parseFloat(r.ttc);
      numFmt(cell, '#,##0.00'); align(cell, 'right');
      if (isAvoir) fw(cell, C.rouge);
    }
    if (isAvoir) fw(rr.getCell(1), C.rouge);
    bg(rr.getCell(1), 'F2F2F2');
  }

  row('TOTAL DETREMBLEUR TTC', detrembleur, C.bleu_clair, 'Net avoirs inclus', true);
  ws.addRow([]);

  // Autres achats
  ws.addRow(['AUTRES ACHATS BAR (HTVA)']);
  styleSectionHeader(ws, ws.rowCount, C.bleu_moyen);

  const { rows: opRows } = await pool.query(`
    SELECT supplier, period_month, ROUND(SUM(amount_htva)::numeric,2) htva
    FROM other_purchases WHERE period_month BETWEEN '2025-10' AND '2025-12'
    GROUP BY supplier, period_month ORDER BY supplier, period_month
  `);

  const bySupplier = {};
  for (const r of opRows) {
    if (!bySupplier[r.supplier]) bySupplier[r.supplier] = {};
    bySupplier[r.supplier][r.period_month] = parseFloat(r.htva);
  }
  for (const [sup, vals] of Object.entries(bySupplier)) {
    row(`  ${sup}`, vals, 'F2F2F2');
  }
  row('TOTAL AUTRES ACHATS HTVA', otherPurchases, C.bleu_clair, '', true);
  ws.addRow([]);

  // NOWJOBS
  ws.addRow(['RH NOWJOBS (bar)']);
  styleSectionHeader(ws, ws.rowCount, C.bleu_moyen);

  const { rows: njRows } = await pool.query(`
    SELECT TO_CHAR(shift_date,'YYYY-MM') mois,
           employee_name,
           ROUND(SUM(cost_prorata)::numeric,2) cout
    FROM nowjobs_prestations
    WHERE shift_date BETWEEN $1 AND $2
    GROUP BY mois, employee_name ORDER BY employee_name, mois
  `, [T4_START, T4_END]);

  const byEmp = {};
  for (const r of njRows) {
    if (!byEmp[r.employee_name]) byEmp[r.employee_name] = {};
    byEmp[r.employee_name][r.mois] = (byEmp[r.employee_name][r.mois] || 0) + parseFloat(r.cout);
  }
  for (const [emp, vals] of Object.entries(byEmp)) {
    row(`  ${emp}`, vals, 'F2F2F2');
  }
  row('TOTAL RH NOWJOBS HTVA', nowjobs, C.bleu_clair, '', true);
  ws.addRow([]);

  // Total charges bar
  const totChargesBar = {};
  let totalSum = 0;
  for (const m of MONTHS) {
    totChargesBar[m] = (parseFloat(detrembleur[m]?.net_ttc || 0)) +
                       (parseFloat(otherPurchases[m]?.htva || 0)) +
                       (parseFloat(nowjobs[m]?.cout_htva  || 0));
    totalSum += totChargesBar[m];
  }
  totChargesBar.total = Math.round(totalSum * 100) / 100;
  row('TOTAL CHARGES BAR', totChargesBar, 'DDD9C4', 'Detrembleur TTC + autres HTVA + RH HTVA', true);

  console.log('  ✅ Tab 3: CHARGES BAR');
}

// ─── Tab 4 : CHARGES BELFIUS ──────────────────────────────────────────────────

async function exportChargesBelfius(wb) {
  const ws = wb.addWorksheet('CHARGES BELFIUS');
  ws.columns = [
    { key: 'date',   width: 12 }, { key: 'montant', width: 14 },
    { key: 'cpname', width: 30 }, { key: 'desc',    width: 42 },
    { key: 'cat',    width: 26 }, { key: 'note',    width: 22 },
  ];

  ws.addRow(['TRANSACTIONS BELFIUS DÉBIT — T4 2025']);
  styleTitle(ws, 1);
  ws.addRow(['Date', 'Montant (€)', 'Contrepartie', 'Description', 'Catégorie', 'Note']);
  const hdr = ws.getRow(2);
  for (let c = 1; c <= 6; c++) { bg(hdr.getCell(c), C.bleu_moyen); fw(hdr.getCell(c), C.blanc); bold(hdr.getCell(c)); }

  const rows = await queryBelfiusDebits(pool);
  let curMonth = '';

  for (const r of rows) {
    const mois = new Date(r.transaction_date).toISOString().slice(0, 7);
    // Sous-titre de mois
    if (mois !== curMonth) {
      curMonth = mois;
      const sepRow = ws.addRow([MONTH_LBL[mois] || mois, '', '', '', '', '']);
      for (let c = 1; c <= 6; c++) { bg(sepRow.getCell(c), C.bleu_clair); bold(sepRow.getCell(c)); }
    }

    const isDedicated = r.categorie.includes('[dédié]');
    const isWarn      = r.categorie.includes('⚠');
    const d = new Date(r.transaction_date);
    const dateStr = `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`;

    const row = ws.addRow([
      dateStr,
      parseFloat(r.amount),
      r.counterparty_name || '',
      r.description || '',
      r.categorie,
      isDedicated ? '⬆ table dédiée' : (isWarn ? '⚠ Vérifier' : ''),
    ]);

    numFmt(row.getCell(2), '#,##0.00'); align(row.getCell(2), 'right');
    if (isDedicated) { fw(row.getCell(5), '808080'); row.getCell(5).font = { ...(row.getCell(5).font||{}), italic: true }; }
    if (isWarn)      bg(row.getCell(5), 'FFF2CC');
  }

  // Totaux par catégorie en fin
  ws.addRow([]);
  const sumRow = ws.addRow(['TOTAL DÉBIT T4', rows.reduce((s, r) => s + parseFloat(r.amount), 0), '', '', '', '']);
  numFmt(sumRow.getCell(2), '#,##0.00'); bold(sumRow.getCell(1)); bold(sumRow.getCell(2));
  bg(sumRow.getCell(1), C.bleu_clair); bg(sumRow.getCell(2), C.bleu_clair);

  console.log('  ✅ Tab 4: CHARGES BELFIUS');
}

// ─── Tab 5 : TOP PRODUITS ─────────────────────────────────────────────────────

async function exportTopProduits(wb) {
  const ws = wb.addWorksheet('TOP PRODUITS');
  ws.columns = [
    { key: 'item',  width: 34 }, { key: 'seg',  width: 12 },
    { key: 'nb',    width: 10 }, { key: 'ca',   width: 14 },
    { key: 'pctca', width: 10 },
  ];

  ws.addRow(['TOP PRODUITS NEXTORE — T4 2025']);
  styleTitle(ws, 1);

  const { rows: terrain } = await pool.query(`
    SELECT item, SUM(count) nb, ROUND(SUM(amount)::numeric,2) ca
    FROM nr_sales WHERE segment='TERRAIN'
      AND register_id IN (SELECT id FROM nr_registers WHERE open_date BETWEEN $1 AND $2)
    GROUP BY item ORDER BY ca DESC LIMIT 20
  `, [T4_START, T4_END]);

  const { rows: bar } = await pool.query(`
    SELECT item, SUM(count) nb, ROUND(SUM(amount)::numeric,2) ca
    FROM nr_sales WHERE segment='BAR'
      AND register_id IN (SELECT id FROM nr_registers WHERE open_date BETWEEN $1 AND $2)
    GROUP BY item ORDER BY ca DESC LIMIT 20
  `, [T4_START, T4_END]);

  const totalTerrain = terrain.reduce((s, r) => s + parseFloat(r.ca), 0);
  const totalBar     = bar.reduce((s, r) => s + parseFloat(r.ca), 0);

  function addSection(title, rows, total, color) {
    ws.addRow([]);
    ws.addRow([title, 'Segment', 'Nb vendu', 'CA TTC (€)', '% CA']);
    const h = ws.getRow(ws.rowCount);
    for (let c = 1; c <= 5; c++) { bg(h.getCell(c), color); fw(h.getCell(c), C.blanc); bold(h.getCell(c)); }
    for (const r of rows) {
      const row = ws.addRow([r.item, r.item.includes('Padel') ? 'TERRAIN' : 'BAR',
        parseInt(r.nb), parseFloat(r.ca),
        parseFloat(r.ca) / total]);
      numFmt(row.getCell(4), '#,##0.00');
      numFmt(row.getCell(5), '0.0%');
      align(row.getCell(3), 'right'); align(row.getCell(4), 'right'); align(row.getCell(5), 'right');
    }
    const tot = ws.addRow(['TOTAL', '', rows.reduce((s,r)=>s+parseInt(r.nb),0), total, 1]);
    numFmt(tot.getCell(4), '#,##0.00'); numFmt(tot.getCell(5), '0.0%');
    for (let c = 1; c <= 5; c++) { bg(tot.getCell(c), C.bleu_clair); bold(tot.getCell(c)); }
  }

  addSection('TOP 20 TERRAIN (CA TTC)', terrain, totalTerrain, C.vert_fonce);
  addSection('TOP 20 BAR (CA TTC)',     bar,     totalBar,     C.bleu_moyen);

  console.log('  ✅ Tab 5: TOP PRODUITS');
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log(' Ardenne Padel PNL — Consolidation T4 2025');
  console.log(`  Output : ${OUT_PATH}`);
  console.log('═══════════════════════════════════════════════════════════\n');

  const client = await pool.connect();
  let ca, detrembleur, otherPurchases, nowjobs;

  try {
    ca             = await queryCA(client);
    detrembleur    = await queryDetrembleur(client);
    otherPurchases = await queryOtherPurchases(client);
    nowjobs        = await queryNowjobs(client);
  } finally {
    client.release();
  }

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Claude Code — Ardenne Padel PNL';
  wb.created  = new Date();

  await exportPnlSynthese(wb,   { ca, debits: null, detrembleur, otherPurchases, nowjobs });
  await exportCaSources(wb, ca);
  await exportChargesBar(wb,   { detrembleur, otherPurchases, nowjobs });
  await exportChargesBelfius(wb);
  await exportTopProduits(wb);

  await wb.xlsx.writeFile(OUT_PATH);
  console.log(`\n✅  Fichier généré : ${OUT_PATH}\n`);

  await pool.end();
}

main().catch(err => {
  console.error('❌  Erreur fatale :', err.message, err.stack);
  process.exit(1);
});
