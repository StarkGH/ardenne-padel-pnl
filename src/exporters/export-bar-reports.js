// export-bar-reports.js — Génération des 4 fichiers Excel Ardenne Padel Bar
// Fichiers produits :
//   1. DETREMBLEUR_recap_v4.xlsx
//   2. MARGE_BAR_T4.xlsx
//   3. ANALYSE_BAR_JOUR_T4.xlsx
//   4. RAPPORT_RENTABILITE_BAR.xlsx

import ExcelJS from 'exceljs';
import { pool, migrate } from '../../db.js';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

const DATA_DIR = process.env.DATA_DIR || '/mnt/c/Users/stark/OneDrive - Antoine Zingaro (CQFD Consult)/Boulot New/Ardenne Padel/_Finance/PNL/Shared';
// Écriture dans ~/projects/ardenne-padel-pnl/output/ (pas de conflits de verrous Windows)
// puis déplacer manuellement ou lancer avec --dest=/path/to/bar
const OUT_DIR_ARG = process.argv.find(a => a.startsWith('--dest='));
const BAR_DIR = OUT_DIR_ARG
  ? OUT_DIR_ARG.replace('--dest=', '')
  : path.join(process.env.HOME || '/home/stark2026', 'projects', 'ardenne-padel-pnl', 'output');

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtDate(d) {
  if (!d) return '';
  const dt = d instanceof Date ? d : new Date(d);
  return `${String(dt.getDate()).padStart(2,'0')}/${String(dt.getMonth()+1).padStart(2,'0')}/${dt.getFullYear()}`;
}

function fmtMonth(ym) {
  // '2025-10' → 'Oct 2025'
  const months = ['Jan','Fév','Mar','Avr','Mai','Juin','Juil','Août','Sep','Oct','Nov','Déc'];
  const [y, m] = ym.split('-');
  return `${months[parseInt(m)-1]} ${y}`;
}

function styleHeader(row, bgColor = 'FF1F4E79', fontColor = 'FFFFFFFF') {
  row.eachCell(cell => {
    cell.font = { bold: true, color: { argb: fontColor } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bgColor } };
    cell.border = {
      top: { style: 'thin' }, bottom: { style: 'thin' },
      left: { style: 'thin' }, right: { style: 'thin' }
    };
    cell.alignment = { horizontal: 'center', wrapText: true };
  });
}

function numFmt(cell, fmt = '#,##0.00') {
  cell.numFmt = fmt;
  cell.alignment = { horizontal: 'right' };
}

// Convertit toute valeur (y compris NaN, 'NaN', null, undefined) en nombre sûr pour Excel
function safeNum(v, fallback = 0) {
  if (v === null || v === undefined) return fallback;
  const n = Number(v);
  return (isNaN(n) || !isFinite(n)) ? fallback : n;
}

// Comme safeNum mais retourne null (= cellule vide) au lieu de 0 pour les valeurs absentes
function safeNumOrNull(v) {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return (isNaN(n) || !isFinite(n)) ? null : n;
}

function addAutoFilter(ws, fromRow, cols) {
  ws.autoFilter = { from: { row: fromRow, column: 1 }, to: { row: fromRow, column: cols } };
}

// ─── 1. DETREMBLEUR_recap_v4.xlsx ────────────────────────────────────────────

async function exportDetrembleur(client) {
  const outPath = path.join(BAR_DIR, 'DETREMBLEUR_recap_v4.xlsx');
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Ardenne Padel PNL';

  // ── Onglet 1 : Synthèse factures ──────────────────────────────────────────
  {
    const ws = wb.addWorksheet('Synthèse factures');
    ws.columns = [
      { key: 'num', width: 15 },
      { key: 'date', width: 14 },
      { key: 'total', width: 14 },
      { key: 'htva21', width: 14 },
      { key: 'htva6', width: 14 },
      { key: 'tva21', width: 12 },
      { key: 'tva6', width: 10 },
      { key: 'vid_l', width: 12 },
      { key: 'vid_r', width: 12 },
      { key: 'nb_lignes', width: 10 },
    ];
    const hdr = ws.addRow(['Facture', 'Date', 'Total à payer', 'HTVA 21%', 'HTVA 6%', 'TVA 21%', 'TVA 6%', 'Vid.livrées', 'Vid.reprises', 'Nb lignes']);
    styleHeader(hdr);

    const { rows } = await client.query(`
      SELECT i.invoice_number, i.invoice_date, i.total_a_payer,
             i.total_htva_21, i.total_tva_21, i.total_htva_6, i.total_tva_6,
             i.vidanges_livrees, i.vidanges_reprises,
             COUNT(il.id) AS nb_lignes
      FROM invoices i
      JOIN suppliers s ON s.id = i.supplier_id AND s.code = 'DETREMBLEUR'
      LEFT JOIN invoice_lines il ON il.invoice_id = i.id
      GROUP BY i.id
      ORDER BY i.invoice_date
    `);

    for (const r of rows) {
      const row = ws.addRow([
        r.invoice_number, fmtDate(r.invoice_date),
        safeNum(r.total_a_payer),
        safeNum(r.total_htva_21), safeNum(r.total_htva_6),
        safeNum(r.total_tva_21),  safeNum(r.total_tva_6),
        safeNum(r.vidanges_livrees), safeNum(r.vidanges_reprises),
        safeNum(r.nb_lignes),
      ]);
      for (let c = 3; c <= 9; c++) numFmt(row.getCell(c));
    }

    // Totaux
    const totRow = ws.addRow([
      'TOTAL', '',
      { formula: `SUM(C2:C${rows.length+1})` },
      { formula: `SUM(D2:D${rows.length+1})` },
      { formula: `SUM(E2:E${rows.length+1})` },
      { formula: `SUM(F2:F${rows.length+1})` },
      { formula: `SUM(G2:G${rows.length+1})` },
      { formula: `SUM(H2:H${rows.length+1})` },
      { formula: `SUM(I2:I${rows.length+1})` },
      { formula: `SUM(J2:J${rows.length+1})` },
    ]);
    totRow.eachCell(cell => { cell.font = { bold: true }; });
    for (let c = 3; c <= 9; c++) numFmt(totRow.getCell(c));
  }

  // ── Onglet 2 : Détail produits ────────────────────────────────────────────
  {
    const ws = wb.addWorksheet('Détail produits');
    ws.columns = [
      { key: 'fac', width: 14 }, { key: 'date', width: 12 },
      { key: 'code', width: 12 }, { key: 'desc', width: 50 },
      { key: 'qty_c', width: 10 }, { key: 'qty_t', width: 10 },
      { key: 'pu', width: 12 }, { key: 'excise', width: 12 },
      { key: 'rem', width: 10 }, { key: 'pnet', width: 12 },
      { key: 'total', width: 12 }, { key: 'vid_u', width: 10 },
      { key: 'vid_t', width: 10 }, { key: 'tva', width: 8 },
      { key: 'type', width: 14 },
      { key: 'mnt_tva', width: 12 }, { key: 'tvac', width: 12 },
    ];
    const hdr = ws.addRow([
      'Facture','Date','Code','Description','Qté Colis','Qté Total',
      'Prix Unit','Accises','Rem%','Prix Net','Total HTVA',
      'Vid/U','Vid Tot','TVA%','Type',
      'Montant TVA','Total TVAC',
    ]);
    styleHeader(hdr);

    const { rows } = await client.query(`
      SELECT i.invoice_number, i.invoice_date,
             il.product_code, il.description, il.quantity_colis, il.quantity_total,
             il.unit_price, il.excise_ecoboni, il.discount_pct, il.net_unit_price,
             il.line_total_htva, il.vid_unit, il.vid_total, il.tva_rate, il.line_type
      FROM invoice_lines il
      JOIN invoices i ON i.id = il.invoice_id
      JOIN suppliers s ON s.id = i.supplier_id AND s.code = 'DETREMBLEUR'
      ORDER BY i.invoice_date, il.line_order
    `);

    // Récupérer les totaux par facture pour le contrôle
    const { rows: invTotals } = await client.query(`
      SELECT invoice_number, total_a_payer, vidanges_livrees, vidanges_reprises
      FROM invoices i
      JOIN suppliers s ON s.id = i.supplier_id AND s.code = 'DETREMBLEUR'
    `);
    const invMap = Object.fromEntries(invTotals.map(r => [r.invoice_number, r]));

    let sumHtva = 0, sumTva = 0, sumVidNet = 0;

    for (const r of rows) {
      const htva   = safeNum(r.line_total_htva);
      const rate   = r.tva_rate === '21%' ? 0.21 : r.tva_rate === '6%' ? 0.06 : 0;
      // Arrondi à 2 décimales (standard comptable belge)
      const mntTva = htva !== 0 ? Math.round(htva * rate * 100) / 100 : null;
      const tvac   = htva !== 0 ? Math.round((htva + (mntTva ?? 0)) * 100) / 100 : null;

      if (r.line_type === 'PRODUCT' || r.line_type === 'GRATUIT') {
        sumHtva += htva;
        sumTva  += mntTva ?? 0;  // arrondi 2 dec par ligne → petit écart résiduel normal
      }

      const row = ws.addRow([
        r.invoice_number, fmtDate(r.invoice_date),
        r.product_code ?? '', r.description ?? '',
        safeNumOrNull(r.quantity_colis), safeNumOrNull(r.quantity_total),
        safeNumOrNull(r.unit_price), safeNumOrNull(r.excise_ecoboni),
        safeNumOrNull(r.discount_pct), safeNumOrNull(r.net_unit_price),
        safeNumOrNull(r.line_total_htva),
        safeNumOrNull(r.vid_unit), safeNumOrNull(r.vid_total),
        r.tva_rate ?? '', r.line_type ?? '',
        mntTva, tvac,
      ]);
      for (const c of [7, 8, 10, 11, 12, 13]) numFmt(row.getCell(c), '#,##0.000');
      for (const c of [16, 17]) numFmt(row.getCell(c), '#,##0.00');
      if (row.getCell(9).value !== null) numFmt(row.getCell(9), '0.0');
    }

    // ── Ligne de total et contrôle ────────────────────────────────────────
    // Σ vidanges nettes de toutes les factures
    for (const inv of invTotals) {
      sumVidNet += safeNum(inv.vidanges_livrees) + safeNum(inv.vidanges_reprises);
    }
    const sumTvac     = sumHtva + sumTva;
    const totalCalc   = sumTvac + sumVidNet;
    const totalPdf    = invTotals.reduce((a, r) => a + safeNum(r.total_a_payer), 0);
    const ecart       = Math.round((totalCalc - totalPdf) * 100) / 100;

    ws.addRow([]);  // ligne vide
    const totRow = ws.addRow([
      'TOTAL', '', '', '',
      '', '',
      '', '', '', '', sumHtva,
      '', sumVidNet, '', '',
      sumTva, sumTvac,
    ]);
    totRow.eachCell(cell => { cell.font = { bold: true }; });
    numFmt(totRow.getCell(11), '#,##0.00');
    numFmt(totRow.getCell(13), '#,##0.00');
    numFmt(totRow.getCell(16), '#,##0.00');
    numFmt(totRow.getCell(17), '#,##0.00');

    // Ligne contrôle : TVAC + vid nettes vs total_a_payer PDF
    const ctrlRow = ws.addRow([
      'CONTRÔLE', '', '', '',
      '', '', '', '', '', '',
      `TVAC+Vid=${totalCalc.toFixed(2)}`,
      '', '', '',
      `PDF=${totalPdf.toFixed(2)}`,
      '', Math.abs(ecart) <= 0.10 ? `✅ OK (écart=${ecart})` : `⚠️ ÉCART=${ecart}`,
    ]);
    const ok = Math.abs(ecart) <= 0.10;
    ctrlRow.eachCell(cell => {
      cell.font = { bold: true, color: { argb: ok ? 'FF008000' : 'FFCC0000' } };
    });

    addAutoFilter(ws, 1, 17);
  }

  // ── Onglet 3 : Récap par produit ─────────────────────────────────────────
  {
    const ws = wb.addWorksheet('Récap par produit');
    ws.columns = [
      { key: 'code', width: 14 }, { key: 'desc', width: 50 },
      { key: 'tva', width: 8 },   { key: 'qty_total', width: 12 },
      { key: 'total_htva', width: 14 }, { key: 'last_pu', width: 14 },
    ];
    const hdr = ws.addRow(['Code','Description','TVA%','Qté Total','Total HTVA','Dernier Prix Net']);
    styleHeader(hdr);

    const { rows } = await client.query(`
      SELECT il.product_code, MAX(il.description) AS description, il.tva_rate,
             COALESCE(SUM(NULLIF(il.quantity_total, 'NaN'::numeric)), 0) AS qty_total,
             COALESCE(SUM(CASE WHEN il.line_type = 'PRODUCT' THEN NULLIF(il.line_total_htva, 'NaN'::numeric) ELSE 0 END), 0) AS total_htva,
             (SELECT il2.net_unit_price FROM invoice_lines il2
              JOIN invoices i2 ON i2.id = il2.invoice_id
              JOIN suppliers s2 ON s2.id = i2.supplier_id AND s2.code = 'DETREMBLEUR'
              WHERE il2.product_code = il.product_code
                AND il2.net_unit_price IS NOT NULL
                AND il2.net_unit_price::text != 'NaN'
              ORDER BY i2.invoice_date DESC LIMIT 1) AS last_pu
      FROM invoice_lines il
      JOIN invoices i ON i.id = il.invoice_id
      JOIN suppliers s ON s.id = i.supplier_id AND s.code = 'DETREMBLEUR'
      WHERE il.line_type = 'PRODUCT'
      GROUP BY il.product_code, il.tva_rate
      ORDER BY COALESCE(SUM(NULLIF(il.line_total_htva, 'NaN'::numeric)), 0) DESC
    `);

    for (const r of rows) {
      const row = ws.addRow([
        r.product_code ?? '', r.description ?? '', r.tva_rate ?? '',
        safeNum(r.qty_total), safeNum(r.total_htva),
        safeNum(r.last_pu),
      ]);
      for (const c of [5, 6]) numFmt(row.getCell(c));
    }
    addAutoFilter(ws, 1, 6);
  }

  // ── Onglet 4 : Frais connexes (vidanges) ─────────────────────────────────
  {
    const ws = wb.addWorksheet('Frais connexes');
    ws.columns = [
      { key: 'fac', width: 14 }, { key: 'date', width: 12 },
      { key: 'vid_l', width: 14 }, { key: 'vid_r', width: 14 },
      { key: 'vid_net', width: 14 }, { key: 'total', width: 14 },
    ];
    const hdr = ws.addRow(['Facture','Date','Vid.livrées€','Vid.reprises€','Vid.nettes€','Total payer']);
    styleHeader(hdr);

    const { rows } = await client.query(`
      SELECT i.invoice_number, i.invoice_date,
             i.vidanges_livrees, i.vidanges_reprises, i.total_a_payer
      FROM invoices i
      JOIN suppliers s ON s.id = i.supplier_id AND s.code = 'DETREMBLEUR'
      ORDER BY i.invoice_date
    `);

    for (const r of rows) {
      const vidL = safeNum(r.vidanges_livrees);
      const vidR = safeNum(r.vidanges_reprises);
      const row = ws.addRow([
        r.invoice_number, fmtDate(r.invoice_date),
        vidL, vidR, vidL + vidR, safeNum(r.total_a_payer),
      ]);
      for (let c = 3; c <= 6; c++) numFmt(row.getCell(c));
    }
  }

  await wb.xlsx.writeFile(outPath);
  console.log(`✅ DETREMBLEUR_recap_v4.xlsx → ${outPath}`);
  return outPath;
}

// ─── 2. ANALYSE_BAR_JOUR_T4.xlsx ─────────────────────────────────────────────

async function exportAnalyseJour(client) {
  const outPath = path.join(BAR_DIR, 'ANALYSE_BAR_JOUR_T4.xlsx');
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Ardenne Padel PNL';

  // Récupère CA Nextore par jour (bar uniquement)
  const { rows: caRows } = await client.query(`
    SELECT sale_date,
           SUM(amount_ttc) AS ca_ttc,
           SUM(amount_ht)  AS ca_ht
    FROM nextore_sales
    WHERE is_bar = TRUE
      AND sale_date BETWEEN '2025-10-01' AND '2025-12-31'
    GROUP BY sale_date
    ORDER BY sale_date
  `);

  // Récupère coût NOWJOBS par jour
  const { rows: rhRows } = await client.query(`
    SELECT shift_date,
           string_agg(DISTINCT employee_name, ', ') AS employes,
           SUM(duration_h) AS total_heures,
           SUM(cost_prorata) AS cout_prorata
    FROM nowjobs_prestations
    WHERE shift_date BETWEEN '2025-10-01' AND '2025-12-31'
    GROUP BY shift_date
    ORDER BY shift_date
  `);

  // Fusionner par date
  const rhByDate = {};
  for (const r of rhRows) rhByDate[r.shift_date.toISOString().slice(0,10)] = r;

  // Récupère achats Detrembleur par jour (livraisons)
  const { rows: detRows } = await client.query(`
    SELECT i.invoice_date AS date,
           SUM(CASE WHEN il.tva_rate = '21%' THEN il.line_total_htva ELSE 0 END) AS htva21,
           SUM(CASE WHEN il.tva_rate = '6%'  THEN il.line_total_htva ELSE 0 END) AS htva6,
           SUM(il.line_total_htva) AS htva_total
    FROM invoices i
    JOIN suppliers s ON s.id = i.supplier_id AND s.code = 'DETREMBLEUR'
    JOIN invoice_lines il ON il.invoice_id = i.id AND il.line_type = 'PRODUCT'
    WHERE i.invoice_date BETWEEN '2025-10-01' AND '2025-12-31'
    GROUP BY i.invoice_date
    ORDER BY i.invoice_date
  `);
  const detByDate = {};
  for (const r of detRows) detByDate[r.date.toISOString().slice(0,10)] = r;

  // ── Onglet 1 : Analyse Jour par Jour ─────────────────────────────────────
  {
    const ws = wb.addWorksheet('Analyse Jour par Jour');
    const JOURS = ['Dim','Lun','Mar','Mer','Jeu','Ven','Sam'];
    ws.columns = [
      { key: 'date', width: 13 }, { key: 'jour', width: 6 },
      { key: 'ca_ttc', width: 13 }, { key: 'ca_ht', width: 13 },
      { key: 'rh', width: 13 }, { key: 'marge_brute', width: 14 },
      { key: 'marge_pct', width: 11 }, { key: 'det_livr', width: 15 },
    ];
    const hdr = ws.addRow([
      'Date','Jour','CA TTC (Nextore)','CA HT (Nextore)',
      'RH NOWJOBS','Marge brute HT','Marge brute %','Livr.Detreml. HTVA'
    ]);
    styleHeader(hdr, 'FF2E75B6');

    const allDates = new Set([
      ...caRows.map(r => r.sale_date.toISOString().slice(0,10)),
      ...rhRows.map(r => r.shift_date.toISOString().slice(0,10)),
    ]);

    let totalCaTTC = 0, totalCaHT = 0, totalRH = 0, totalMarge = 0;

    for (const dateStr of [...allDates].sort()) {
      const dt = new Date(dateStr + 'T00:00:00');
      const ca = caRows.find(r => r.sale_date.toISOString().slice(0,10) === dateStr);
      const rh = rhByDate[dateStr];
      const det = detByDate[dateStr];

      const caTTC = parseFloat(ca?.ca_ttc ?? 0);
      const caHT  = parseFloat(ca?.ca_ht  ?? 0);
      const rhCost = parseFloat(rh?.cout_prorata ?? 0);
      // Marge brute : CA HT - PA estimé (59.5% du CA HT → PA = 40.5%)
      // On utilise PA_RATIO = 0.405 comme approximation si pas de livraison ce jour
      const margeBrute = caHT > 0 ? caHT * 0.595 : 0;
      const detHtva = parseFloat(det?.htva_total ?? 0);

      const row = ws.addRow([
        fmtDate(dt), JOURS[dt.getDay()],
        caTTC, caHT, rhCost, margeBrute,
        caHT > 0 ? margeBrute / caHT : 0, detHtva,
      ]);
      numFmt(row.getCell(3)); numFmt(row.getCell(4)); numFmt(row.getCell(5));
      numFmt(row.getCell(6)); numFmt(row.getCell(8));
      row.getCell(7).numFmt = '0.0%';
      row.getCell(7).alignment = { horizontal: 'right' };

      totalCaTTC += caTTC; totalCaHT += caHT; totalRH += rhCost; totalMarge += margeBrute;
    }

    // Ligne totaux
    const n = allDates.size + 1;
    const tot = ws.addRow([
      'TOTAL T4','',
      totalCaTTC, totalCaHT, totalRH, totalMarge,
      totalCaHT > 0 ? totalMarge / totalCaHT : 0,
    ]);
    tot.eachCell(c => c.font = { bold: true });
    for (const c of [3,4,5,6]) numFmt(tot.getCell(c));
    tot.getCell(7).numFmt = '0.0%';
    addAutoFilter(ws, 1, 8);
  }

  // ── Onglet 2 : Détail RH par jour ────────────────────────────────────────
  {
    const ws = wb.addWorksheet('Détail RH par jour');
    ws.columns = [
      { key: 'date', width: 13 }, { key: 'jour', width: 6 },
      { key: 'employes', width: 35 }, { key: 'heures', width: 12 },
      { key: 'cout', width: 14 }, { key: 'taux', width: 12 },
    ];
    const hdr = ws.addRow(['Date','Jour','Employé(s)','Total heures','Coût prorata','Taux €/h']);
    styleHeader(hdr, 'FF7030A0');

    const JOURS = ['Dim','Lun','Mar','Mer','Jeu','Ven','Sam'];
    for (const r of rhRows) {
      const dt = r.shift_date;
      const row = ws.addRow([
        fmtDate(dt), JOURS[dt.getDay()],
        r.employes, parseFloat(r.total_heures ?? 0),
        parseFloat(r.cout_prorata ?? 0),
        parseFloat(r.total_heures ?? 1) > 0
          ? parseFloat(r.cout_prorata ?? 0) / parseFloat(r.total_heures ?? 1)
          : 0,
      ]);
      numFmt(row.getCell(4), '#,##0.0');
      numFmt(row.getCell(5)); numFmt(row.getCell(6));
    }
    addAutoFilter(ws, 1, 6);
  }

  await wb.xlsx.writeFile(outPath);
  console.log(`✅ ANALYSE_BAR_JOUR_T4.xlsx → ${outPath}`);
  return outPath;
}

// ─── 3. MARGE_BAR_T4.xlsx ────────────────────────────────────────────────────

async function exportMargeBar(client) {
  const outPath = path.join(BAR_DIR, 'MARGE_BAR_T4.xlsx');
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Ardenne Padel PNL';

  // ── Onglet 1 : Paramètres PA ──────────────────────────────────────────────
  // Prix d'achat nets unitaires (dernier prix Detrembleur par produit)
  {
    const ws = wb.addWorksheet('Paramètres PA');
    ws.columns = [
      { key: 'code', width: 14 }, { key: 'desc', width: 50 },
      { key: 'tva', width: 8 }, { key: 'pa_net', width: 14 },
      { key: 'fac', width: 14 }, { key: 'date', width: 12 },
    ];
    const hdr = ws.addRow(['Code Produit','Description','TVA%','PA net HTVA','Source facture','Date']);
    styleHeader(hdr, 'FF375623');

    const { rows } = await client.query(`
      SELECT DISTINCT ON (il.product_code)
             il.product_code, il.description, il.tva_rate, il.net_unit_price,
             i.invoice_number, i.invoice_date
      FROM invoice_lines il
      JOIN invoices i ON i.id = il.invoice_id
      JOIN suppliers s ON s.id = i.supplier_id AND s.code = 'DETREMBLEUR'
      WHERE il.line_type = 'PRODUCT' AND il.net_unit_price IS NOT NULL AND il.net_unit_price > 0
      ORDER BY il.product_code, i.invoice_date DESC
    `);

    for (const r of rows) {
      const row = ws.addRow([
        r.product_code ?? '', r.description ?? '', r.tva_rate ?? '',
        safeNum(r.net_unit_price), r.invoice_number, fmtDate(r.invoice_date),
      ]);
      numFmt(row.getCell(4), '#,##0.0000');
    }
    addAutoFilter(ws, 1, 6);
  }

  // ── Onglet 2 : Marge Bar T4 ───────────────────────────────────────────────
  {
    const ws = wb.addWorksheet('Marge Bar T4');
    ws.columns = [
      { key: 'cat', width: 35 }, { key: 'ca_ht', width: 14 },
      { key: 'ca_ttc', width: 14 }, { key: 'pa_htva', width: 14 },
      { key: 'marge_htva', width: 14 }, { key: 'marge_pct', width: 12 },
    ];
    const hdr = ws.addRow(['Catégorie Nextore','CA HT','CA TTC','PA HTVA (Detrembleur)','Marge brute HTVA','Marge %']);
    styleHeader(hdr, 'FF375623');

    // CA par catégorie (T4)
    const { rows: caRows } = await client.query(`
      SELECT category,
             SUM(amount_ht) AS ca_ht, SUM(amount_ttc) AS ca_ttc
      FROM nextore_sales
      WHERE is_bar = TRUE AND sale_date BETWEEN '2025-10-01' AND '2025-12-31'
      GROUP BY category
      ORDER BY SUM(amount_ht) DESC
    `);

    // PA Detrembleur T4 total
    const { rows: paRows } = await client.query(`
      SELECT SUM(CASE WHEN il.line_type='PRODUCT' THEN il.line_total_htva ELSE 0 END) AS pa_total
      FROM invoices i
      JOIN suppliers s ON s.id = i.supplier_id AND s.code = 'DETREMBLEUR'
      JOIN invoice_lines il ON il.invoice_id = i.id
      WHERE i.invoice_date BETWEEN '2025-10-01' AND '2025-12-31'
    `);

    const paTotal = parseFloat(paRows[0]?.pa_total ?? 0);
    const caTotal = caRows.reduce((s, r) => s + parseFloat(r.ca_ht), 0);

    // Répartit PA proportionnellement au CA par catégorie
    for (const r of caRows) {
      const caHT  = parseFloat(r.ca_ht);
      const caTTC = parseFloat(r.ca_ttc);
      const paEstim = caTotal > 0 ? (caHT / caTotal) * paTotal : 0;
      const marge = caHT - paEstim;
      const row = ws.addRow([
        r.category, caHT, caTTC, paEstim, marge,
        caHT > 0 ? marge / caHT : 0,
      ]);
      numFmt(row.getCell(2)); numFmt(row.getCell(3)); numFmt(row.getCell(4));
      numFmt(row.getCell(5)); row.getCell(6).numFmt = '0.0%';
      row.getCell(6).alignment = { horizontal: 'right' };
    }

    // Totaux
    const n = caRows.length + 1;
    const tot = ws.addRow([
      'TOTAL T4',
      { formula: `SUM(B2:B${n})` }, { formula: `SUM(C2:C${n})` },
      paTotal,
      { formula: `SUM(E2:E${n})` },
      { formula: `IFERROR(E${n+1}/B${n+1},0)` },
    ]);
    tot.eachCell(c => c.font = { bold: true });
    for (const c of [2,3,4,5]) numFmt(tot.getCell(c));
    tot.getCell(6).numFmt = '0.0%';
  }

  // ── Onglet 3 : Classement Marge ──────────────────────────────────────────
  {
    const ws = wb.addWorksheet('Classement Marge');
    ws.columns = [
      { key: 'code', width: 14 }, { key: 'desc', width: 50 },
      { key: 'tva', width: 8 }, { key: 'qty', width: 12 },
      { key: 'ca_htva', width: 14 }, { key: 'pa_htva', width: 14 },
      { key: 'marge', width: 14 }, { key: 'marge_pct', width: 12 },
    ];
    const hdr = ws.addRow(['Code','Description','TVA%','Qté','CA HTVA (calc)','PA HTVA','Marge€','Marge%']);
    styleHeader(hdr, 'FF843C0C');

    const { rows } = await client.query(`
      SELECT il.product_code, MAX(il.description) AS description, il.tva_rate,
             COALESCE(SUM(NULLIF(il.quantity_total, 'NaN'::numeric)), 0) AS qty_total,
             COALESCE(SUM(NULLIF(il.line_total_htva, 'NaN'::numeric)), 0) AS pa_htva
      FROM invoice_lines il
      JOIN invoices i ON i.id = il.invoice_id
      JOIN suppliers s ON s.id = i.supplier_id AND s.code = 'DETREMBLEUR'
      WHERE il.line_type = 'PRODUCT'
        AND i.invoice_date BETWEEN '2025-10-01' AND '2025-12-31'
      GROUP BY il.product_code, il.tva_rate
      ORDER BY COALESCE(SUM(NULLIF(il.line_total_htva, 'NaN'::numeric)), 0) DESC
    `);

    for (const r of rows) {
      const paHtva = safeNum(r.pa_htva);
      // Sans prix de vente par produit on ne peut pas calculer la marge exacte
      // On indique PA uniquement — la marge globale est dans l'onglet Marge Bar T4
      const row = ws.addRow([
        r.product_code ?? '', r.description ?? '', r.tva_rate ?? '',
        safeNum(r.qty_total), null, paHtva, null, null,
      ]);
      numFmt(row.getCell(6));
    }
    addAutoFilter(ws, 1, 8);
  }

  await wb.xlsx.writeFile(outPath);
  console.log(`✅ MARGE_BAR_T4.xlsx → ${outPath}`);
  return outPath;
}

// ─── 4. RAPPORT_RENTABILITE_BAR.xlsx ─────────────────────────────────────────

async function exportRapportRentabilite(client) {
  const outPath = path.join(BAR_DIR, 'RAPPORT_RENTABILITE_BAR.xlsx');
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Ardenne Padel PNL';

  // Périodes disponibles
  const PERIODS = [
    { key: '2025-10', label: 'Oct 2025', start: '2025-10-01', end: '2025-10-31' },
    { key: '2025-11', label: 'Nov 2025', start: '2025-11-01', end: '2025-11-30' },
    { key: '2025-12', label: 'Déc 2025', start: '2025-12-01', end: '2025-12-31' },
    { key: '2026-01', label: 'Jan 2026', start: '2026-01-01', end: '2026-01-31' },
    { key: '2026-02', label: 'Fév 2026', start: '2026-02-01', end: '2026-02-28' },
  ];

  // ── Onglet 1 : Synthèse mensuelle ─────────────────────────────────────────
  {
    const ws = wb.addWorksheet('①Synthèse mensuelle');
    ws.columns = [
      { key: 'periode', width: 14 },
      { key: 'ca_ht', width: 14 }, { key: 'ca_ttc', width: 14 },
      { key: 'pa_det', width: 14 }, { key: 'pa_autres', width: 14 }, { key: 'pa_total', width: 14 },
      { key: 'marge_brute', width: 14 }, { key: 'marge_pct', width: 12 },
      { key: 'rh', width: 14 },
      { key: 'marge_nette', width: 14 }, { key: 'marge_nette_pct', width: 14 },
    ];

    const hdr1 = ws.addRow(['','CA Bar','','Achats (HTVA)','','','Marge brute','','RH NOWJOBS','Marge nette','']);
    hdr1.getCell(2).value = 'CA Bar'; hdr1.getCell(4).value = 'Achats (HTVA)';
    hdr1.getCell(7).value = 'Marge brute'; hdr1.getCell(10).value = 'Marge nette';
    styleHeader(hdr1, 'FF1F4E79');

    const hdr = ws.addRow([
      'Période',
      'CA HT','CA TTC',
      'Detrembleur','Autres (Colruyt…)','Total PA',
      'Marge€','Marge%',
      'RH€',
      'Marge nette€','Marge nette%',
    ]);
    styleHeader(hdr, 'FF2E75B6');

    let totals = { ca_ht:0, ca_ttc:0, pa_det:0, pa_autres:0, rh:0 };

    for (const p of PERIODS) {
      // CA Nextore bar
      const { rows: ca } = await client.query(
        `SELECT COALESCE(SUM(amount_ht),0) AS ca_ht, COALESCE(SUM(amount_ttc),0) AS ca_ttc
         FROM nextore_sales WHERE is_bar=TRUE AND sale_date BETWEEN $1 AND $2`,
        [p.start, p.end]
      );
      // PA Detrembleur
      const { rows: det } = await client.query(
        `SELECT COALESCE(SUM(CASE WHEN il.line_type='PRODUCT' THEN il.line_total_htva ELSE 0 END),0) AS pa
         FROM invoices i
         JOIN suppliers s ON s.id=i.supplier_id AND s.code='DETREMBLEUR'
         JOIN invoice_lines il ON il.invoice_id=i.id
         WHERE i.invoice_date BETWEEN $1 AND $2`,
        [p.start, p.end]
      );
      // PA Autres (Colruyt + Comarché + Conte de Salm)
      const { rows: autres } = await client.query(
        `SELECT COALESCE(SUM(amount_htva),0) AS pa FROM other_purchases WHERE period_month=$1`,
        [p.key]
      );
      // RH NOWJOBS
      const { rows: rh } = await client.query(
        `SELECT COALESCE(SUM(cost_prorata),0) AS rh FROM nowjobs_prestations WHERE shift_date BETWEEN $1 AND $2`,
        [p.start, p.end]
      );

      const caHT    = parseFloat(ca[0].ca_ht);
      const caTTC   = parseFloat(ca[0].ca_ttc);
      const paDet   = parseFloat(det[0].pa);
      const paAut   = parseFloat(autres[0].pa);
      const paTotal = paDet + paAut;
      const rhCost  = parseFloat(rh[0].rh);
      const margeBrute = caHT - paTotal;
      const margeNette = margeBrute - rhCost;

      const row = ws.addRow([
        p.label,
        caHT, caTTC, paDet, paAut, paTotal,
        margeBrute, caHT > 0 ? margeBrute/caHT : 0,
        rhCost,
        margeNette, caHT > 0 ? margeNette/caHT : 0,
      ]);
      for (const c of [2,3,4,5,6,7,9,10]) numFmt(row.getCell(c));
      for (const c of [8,11]) { row.getCell(c).numFmt = '0.0%'; row.getCell(c).alignment = {horizontal:'right'}; }

      totals.ca_ht   += caHT;  totals.ca_ttc  += caTTC;
      totals.pa_det  += paDet; totals.pa_autres+= paAut; totals.rh += rhCost;
    }

    // Total
    const n = PERIODS.length + 2; // +2 pour les 2 lignes d'en-tête
    const paT = totals.pa_det + totals.pa_autres;
    const mbT = totals.ca_ht - paT;
    const mnT = mbT - totals.rh;
    const tot = ws.addRow([
      'TOTAL', totals.ca_ht, totals.ca_ttc, totals.pa_det, totals.pa_autres, paT,
      mbT, totals.ca_ht > 0 ? mbT/totals.ca_ht : 0,
      totals.rh, mnT, totals.ca_ht > 0 ? mnT/totals.ca_ht : 0,
    ]);
    tot.eachCell(c => c.font = { bold: true });
    for (const c of [2,3,4,5,6,7,9,10]) numFmt(tot.getCell(c));
    for (const c of [8,11]) { tot.getCell(c).numFmt = '0.0%'; tot.getCell(c).alignment = {horizontal:'right'}; }
  }

  // ── Onglet 2 : CA par Catégorie ──────────────────────────────────────────
  {
    const ws = wb.addWorksheet('②CA par Catégorie');
    ws.columns = [
      { key: 'cat', width: 40 }, { key: 'oct', width: 13 }, { key: 'nov', width: 13 },
      { key: 'dec', width: 13 }, { key: 'jan', width: 13 }, { key: 'fev', width: 13 },
      { key: 'total', width: 14 },
    ];
    const hdr = ws.addRow(['Catégorie','Oct 2025','Nov 2025','Déc 2025','Jan 2026','Fév 2026','TOTAL']);
    styleHeader(hdr, 'FF2E75B6');

    const { rows } = await client.query(`
      SELECT category,
             SUM(CASE WHEN sale_date BETWEEN '2025-10-01' AND '2025-10-31' THEN amount_ht ELSE 0 END) AS oct,
             SUM(CASE WHEN sale_date BETWEEN '2025-11-01' AND '2025-11-30' THEN amount_ht ELSE 0 END) AS nov,
             SUM(CASE WHEN sale_date BETWEEN '2025-12-01' AND '2025-12-31' THEN amount_ht ELSE 0 END) AS dec_,
             SUM(CASE WHEN sale_date BETWEEN '2026-01-01' AND '2026-01-31' THEN amount_ht ELSE 0 END) AS jan,
             SUM(CASE WHEN sale_date BETWEEN '2026-02-01' AND '2026-02-28' THEN amount_ht ELSE 0 END) AS fev,
             SUM(amount_ht) AS total
      FROM nextore_sales
      WHERE is_bar = TRUE
      GROUP BY category
      ORDER BY SUM(amount_ht) DESC
    `);

    for (const r of rows) {
      const row = ws.addRow([
        r.category,
        parseFloat(r.oct ?? 0), parseFloat(r.nov ?? 0), parseFloat(r.dec_ ?? 0),
        parseFloat(r.jan ?? 0), parseFloat(r.fev ?? 0), parseFloat(r.total ?? 0),
      ]);
      for (let c = 2; c <= 7; c++) numFmt(row.getCell(c));
    }

    // Totaux
    const n = rows.length + 1;
    const tot = ws.addRow(['TOTAL',
      { formula: `SUM(B2:B${n})` }, { formula: `SUM(C2:C${n})` },
      { formula: `SUM(D2:D${n})` }, { formula: `SUM(E2:E${n})` },
      { formula: `SUM(F2:F${n})` }, { formula: `SUM(G2:G${n})` },
    ]);
    tot.eachCell(c => c.font = { bold: true });
    for (let c = 2; c <= 7; c++) numFmt(tot.getCell(c));
    addAutoFilter(ws, 1, 7);
  }

  // ── Onglet 3 : Analyse Conso T4 ──────────────────────────────────────────
  {
    const ws = wb.addWorksheet('③Analyse Conso T4');
    ws.columns = [
      { key: 'sup', width: 20 }, { key: 'oct', width: 13 }, { key: 'nov', width: 13 },
      { key: 'dec', width: 13 }, { key: 'total', width: 14 },
    ];
    const hdr = ws.addRow(['Fournisseur / Source','Oct 2025','Nov 2025','Déc 2025','Total T4 HTVA']);
    styleHeader(hdr, 'FF7030A0');

    // Detrembleur par mois
    const { rows: det } = await client.query(`
      SELECT EXTRACT(YEAR FROM i.invoice_date)::int AS yr,
             EXTRACT(MONTH FROM i.invoice_date)::int AS mo,
             SUM(CASE WHEN il.line_type='PRODUCT' THEN il.line_total_htva ELSE 0 END) AS pa
      FROM invoices i
      JOIN suppliers s ON s.id=i.supplier_id AND s.code='DETREMBLEUR'
      JOIN invoice_lines il ON il.invoice_id=i.id
      WHERE i.invoice_date BETWEEN '2025-10-01' AND '2025-12-31'
      GROUP BY yr, mo ORDER BY yr, mo
    `);
    const detByM = {};
    for (const r of det) detByM[`${r.yr}-${String(r.mo).padStart(2,'0')}`] = parseFloat(r.pa);

    // Autres achats (Colruyt, Comarché)
    const { rows: autres } = await client.query(`
      SELECT period_month, supplier, SUM(amount_htva) AS pa
      FROM other_purchases
      WHERE period_month IN ('2025-10','2025-11','2025-12')
      GROUP BY period_month, supplier ORDER BY supplier, period_month
    `);

    const dataRows = [
      ['DETREMBLEUR', detByM['2025-10']??0, detByM['2025-11']??0, detByM['2025-12']??0],
    ];
    const suppliersByMonth = {};
    for (const r of autres) {
      if (!suppliersByMonth[r.supplier]) suppliersByMonth[r.supplier] = {'2025-10':0,'2025-11':0,'2025-12':0};
      suppliersByMonth[r.supplier][r.period_month] = parseFloat(r.pa);
    }
    for (const [sup, vals] of Object.entries(suppliersByMonth)) {
      dataRows.push([sup, vals['2025-10']??0, vals['2025-11']??0, vals['2025-12']??0]);
    }

    for (const dr of dataRows) {
      const total = (dr[1]??0) + (dr[2]??0) + (dr[3]??0);
      const row = ws.addRow([dr[0], dr[1]??0, dr[2]??0, dr[3]??0, total]);
      for (let c = 2; c <= 5; c++) numFmt(row.getCell(c));
    }
    const n = dataRows.length + 1;
    const tot = ws.addRow(['TOTAL',
      { formula: `SUM(B2:B${n})` }, { formula: `SUM(C2:C${n})` },
      { formula: `SUM(D2:D${n})` }, { formula: `SUM(E2:E${n})` },
    ]);
    tot.eachCell(c => c.font = { bold: true });
    for (let c = 2; c <= 5; c++) numFmt(tot.getCell(c));
  }

  // ── Onglet 4 : Détail Achats ──────────────────────────────────────────────
  {
    const ws = wb.addWorksheet('④Détail Achats');
    ws.columns = [
      { key: 'fac', width: 14 }, { key: 'date', width: 12 },
      { key: 'sup', width: 18 }, { key: 'desc', width: 50 },
      { key: 'htva21', width: 14 }, { key: 'htva6', width: 14 },
      { key: 'total', width: 14 },
    ];
    const hdr = ws.addRow(['Facture','Date','Fournisseur','Description / Produit','HTVA 21%','HTVA 6%','Total HTVA']);
    styleHeader(hdr, 'FF843C0C');

    // Detrembleur
    const { rows: det } = await client.query(`
      SELECT i.invoice_number, i.invoice_date, 'DETREMBLEUR' AS sup,
             il.description,
             CASE WHEN il.tva_rate='21%' THEN il.line_total_htva ELSE 0 END AS htva21,
             CASE WHEN il.tva_rate='6%'  THEN il.line_total_htva ELSE 0 END AS htva6,
             il.line_total_htva AS total
      FROM invoices i
      JOIN suppliers s ON s.id=i.supplier_id AND s.code='DETREMBLEUR'
      JOIN invoice_lines il ON il.invoice_id=i.id
      WHERE il.line_type = 'PRODUCT'
        AND i.invoice_date BETWEEN '2025-10-01' AND '2025-12-31'
      ORDER BY i.invoice_date, il.line_order
    `);

    for (const r of det) {
      const row = ws.addRow([
        r.invoice_number, fmtDate(r.invoice_date), r.sup, r.description,
        parseFloat(r.htva21??0), parseFloat(r.htva6??0), parseFloat(r.total??0),
      ]);
      for (let c = 5; c <= 7; c++) numFmt(row.getCell(c));
    }

    // Autres achats
    const { rows: autres } = await client.query(
      `SELECT NULL AS fac, NULL AS date_, supplier, description, amount_htva
       FROM other_purchases WHERE period_month IN ('2025-10','2025-11','2025-12')
       ORDER BY period_month, supplier`
    );
    for (const r of autres) {
      const row = ws.addRow(['', '', r.supplier, r.description, '', '', parseFloat(r.amount_htva)]);
      numFmt(row.getCell(7));
    }
    addAutoFilter(ws, 1, 7);
  }

  // ── Onglet 5 : RH NOWJOBS ────────────────────────────────────────────────
  {
    const ws = wb.addWorksheet('⑤RH NOWJOBS');
    ws.columns = [
      { key: 'date', width: 13 }, { key: 'jour', width: 8 },
      { key: 'nom', width: 25 }, { key: 'debut', width: 10 },
      { key: 'fin', width: 10 }, { key: 'heures', width: 10 },
      { key: 'prorata', width: 13 }, { key: 'taux', width: 12 },
      { key: 'statut', width: 12 },
    ];
    const hdr = ws.addRow(['Date','Jour','Employé','Début','Fin','Heures','Coût prorata','€/h','Statut']);
    styleHeader(hdr, 'FF7030A0');

    const { rows } = await client.query(`
      SELECT shift_date, day_name, employee_name, start_time, end_time,
             duration_h, cost_prorata, hourly_rate, statut
      FROM nowjobs_prestations
      ORDER BY shift_date, employee_name
    `);

    const JOURS = ['Dim','Lun','Mar','Mer','Jeu','Ven','Sam'];
    for (const r of rows) {
      const dt = r.shift_date;
      const row = ws.addRow([
        fmtDate(dt), r.day_name ?? JOURS[dt.getDay()], r.employee_name,
        r.start_time, r.end_time,
        parseFloat(r.duration_h ?? 0), parseFloat(r.cost_prorata ?? 0),
        parseFloat(r.hourly_rate ?? 0), r.statut,
      ]);
      numFmt(row.getCell(6), '#,##0.0');
      numFmt(row.getCell(7)); numFmt(row.getCell(8));
    }

    // Totaux
    const n = rows.length + 1;
    const tot = ws.addRow([
      'TOTAL','','','','',
      { formula: `SUM(F2:F${n})` },
      { formula: `SUM(G2:G${n})` },
      '',''
    ]);
    tot.eachCell(c => c.font = { bold: true });
    numFmt(tot.getCell(6), '#,##0.0');
    numFmt(tot.getCell(7));
    addAutoFilter(ws, 1, 9);
  }

  await wb.xlsx.writeFile(outPath);
  console.log(`✅ RAPPORT_RENTABILITE_BAR.xlsx → ${outPath}`);
  return outPath;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  await migrate();
  const client = await pool.connect();
  try {
    console.log('\n🏗  Génération des fichiers Excel Ardenne Padel Bar...\n');

    const targets = process.argv.slice(2).filter(a => !a.startsWith('--'));
    const all = targets.length === 0;

    if (all || targets.includes('detrembleur')) {
      await exportDetrembleur(client);
    }
    if (all || targets.includes('analyse')) {
      await exportAnalyseJour(client);
    }
    if (all || targets.includes('marge')) {
      await exportMargeBar(client);
    }
    if (all || targets.includes('rapport')) {
      await exportRapportRentabilite(client);
    }

    console.log('\n🎉 Tous les fichiers Excel générés avec succès !');
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(err => {
  console.error('❌ Erreur :', err.message);
  process.exit(1);
});
