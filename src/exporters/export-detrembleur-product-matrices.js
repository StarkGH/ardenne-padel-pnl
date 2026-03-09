import ExcelJS from 'exceljs';
import path from 'path';
import dotenv from 'dotenv';
import { pool, migrate } from '../../db.js';

dotenv.config();

const OUT_DIR_ARG = process.argv.find(a => a.startsWith('--dest='));
const OUT_FILE_ARG = process.argv.find(a => a.startsWith('--out='));
const START_ARG = process.argv.find(a => a.startsWith('--start='));
const END_ARG = process.argv.find(a => a.startsWith('--end='));

const DEFAULT_OUT_DIR = path.join(process.env.HOME || '/home/stark2026', 'projects', 'ardenne-padel-pnl', 'output');
const DEFAULT_OUT_FILE = 'DETREMBLEUR_tableaux_produits.xlsx';

function normalizeSpaces(s) {
  return String(s || '').replace(/\s+/g, ' ').trim();
}

function fmtIsoDate(d) {
  if (!d) return '';
  const dt = d instanceof Date ? d : new Date(d);
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const day = String(dt.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function detectPackagingUnit(description) {
  const desc = normalizeSpaces(description).toLowerCase();

  const fut = desc.match(/f[ûu]t\s*(?:de\s*)?(\d+)\s*l/i);
  if (fut) return `fut ${fut[1]}l`;

  const clx = desc.match(/(\d+)\s*cl\s*[x]\s*(\d+)/i);
  if (clx) return `bouteille ${clx[1]}cl`;

  const xcl = desc.match(/(\d+)\s*[x]\s*(\d+)\s*cl/i);
  if (xcl) return `bouteille ${xcl[2]}cl`;

  const canette = desc.match(/canette\s*(\d+)\s*cl/i);
  if (canette) return `canette ${canette[1]}cl`;

  const bouteille = desc.match(/bouteille\s*(\d+)\s*cl/i);
  if (bouteille) return `bouteille ${bouteille[1]}cl`;

  const cl = desc.match(/(\d+)\s*cl/i);
  if (cl) return `bouteille ${cl[1]}cl`;

  if (/\bchips?\b/i.test(desc) || /\bpaquet\b/i.test(desc)) {
    return 'paquet';
  }

  const litre = desc.match(/(\d+)\s*l(?:itre)?s?\b/i);
  if (litre) return `bouteille ${litre[1]}l`;

  const kg = desc.match(/(\d+)\s*kg\b/i);
  if (kg) return `bonbonne ${kg[1]}kg`;

  return 'unite';
}

function detectProductName(description) {
  let name = normalizeSpaces(description || '')
    .replace(/\s*-\s*$/, '')
    .replace(/\b\d+\+\d+\s+GRATUITES?\b.*$/i, '')
    .replace(/\b\d+\s*CL\s*[xX]\s*\d+\b.*$/i, '')
    .replace(/\b\d+\s*[xX]\s*\d+\s*CL\b.*$/i, '')
    .replace(/\b\d+\s*[xX]\s*\d+\b.*$/i, '')
    .replace(/\b\d+\s*CL\b.*$/i, '')
    .replace(/\b\d+\s*L(?:ITRE)?S?\b.*$/i, '')
    .replace(/\b\d+\s*KG\b.*$/i, '')
    .replace(/\b\d+(?:[.,]\d+)?\s*[%°]\b.*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!name) return 'INCONNU';
  return name.toUpperCase();
}

function styleHeader(row) {
  row.eachCell(cell => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E79' } };
    cell.border = {
      top: { style: 'thin' },
      bottom: { style: 'thin' },
      left: { style: 'thin' },
      right: { style: 'thin' },
    };
    cell.alignment = { horizontal: 'center', wrapText: true };
  });
}

function numFmt(cell, fmt) {
  cell.numFmt = fmt;
  cell.alignment = { horizontal: 'right' };
}

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function buildMatrices(rows) {
  const dates = [...new Set(rows.map(r => fmtIsoDate(r.invoice_date)).filter(Boolean))].sort();
  const products = new Map();

  for (const r of rows) {
    const date = fmtIsoDate(r.invoice_date);
    if (!date) continue;

    const product = detectProductName(r.description);
    const unit = detectPackagingUnit(r.description);
    const key = `${product}__${unit}`;

    if (!products.has(key)) {
      products.set(key, {
        product,
        unit,
        byDate: {},
      });
    }

    const curr = products.get(key);
    const qty = toNum(r.quantity_total);
    const total = toNum(r.line_total_htva);

    if (!curr.byDate[date]) {
      curr.byDate[date] = { qty: 0, total: 0 };
    }

    curr.byDate[date].qty += qty;
    curr.byDate[date].total += total;
  }

  const sortedRows = [...products.values()].sort((a, b) => {
    if (a.product !== b.product) return a.product.localeCompare(b.product, 'fr');
    return a.unit.localeCompare(b.unit, 'fr');
  });

  return { dates, rows: sortedRows };
}

function buildSheetRows(dates, matrixRows, typeLabel, valueGetter) {
  return matrixRows.map((r, idx) => ({
    seq: idx + 1,
    type: typeLabel,
    product: r.product,
    unit: r.unit,
    values: dates.map(d => valueGetter(r.byDate[d])),
  }));
}

function addMatrixSheet(wb, name, dates, sheetRows, numberFormat) {
  const ws = wb.addWorksheet(name);
  ws.columns = [
    { key: 'seq', width: 8 },
    { key: 'type', width: 24 },
    { key: 'product', width: 34 },
    { key: 'unit', width: 20 },
    ...dates.map(d => ({ key: d, width: 14 })),
  ];

  const header = ['Seq', "Type d'export", 'Produit', 'Conditionnement', ...dates];
  const hdr = ws.addRow(header);
  styleHeader(hdr);

  for (const r of sheetRows) {
    const rowValues = [r.seq, r.type, r.product, r.unit, ...r.values];
    const row = ws.addRow(rowValues);
    numFmt(row.getCell(1), '0');
    for (let c = 5; c <= 4 + dates.length; c++) {
      numFmt(row.getCell(c), numberFormat);
    }
  }

  ws.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: 4 + dates.length },
  };
}

export async function exportDetrembleurProductMatrices({ client, outPath, startDate, endDate } = {}) {
  const ownClient = !client;
  const dbClient = client || (await pool.connect());

  try {
    const params = [];
    const filters = ["s.code = 'DETREMBLEUR'", "il.line_type = 'PRODUCT'"];

    if (startDate) {
      params.push(startDate);
      filters.push(`i.invoice_date >= $${params.length}`);
    }
    if (endDate) {
      params.push(endDate);
      filters.push(`i.invoice_date <= $${params.length}`);
    }

    const { rows } = await dbClient.query(
      `SELECT i.invoice_date, il.description, il.quantity_total, il.line_total_htva
       FROM invoice_lines il
       JOIN invoices i ON i.id = il.invoice_id
       JOIN suppliers s ON s.id = i.supplier_id
       WHERE ${filters.join(' AND ')}
       ORDER BY i.invoice_date, il.line_order`,
      params
    );

    const { dates, rows: matrixRows } = buildMatrices(rows);

    const wb = new ExcelJS.Workbook();
    wb.creator = 'Ardenne Padel PNL';

    const qtyRows = buildSheetRows(
      dates,
      matrixRows,
      'Quantité commandées',
      day => toNum(day?.qty)
    );
    const totalRows = buildSheetRows(
      dates,
      matrixRows,
      'Prix total HTVA',
      day => toNum(day?.total)
    );
    const avgRows = buildSheetRows(
      dates,
      matrixRows,
      'Prix moyen HTVA',
      day => {
        const qty = toNum(day?.qty);
        const total = toNum(day?.total);
        return qty > 0 ? total / qty : 0;
      }
    );

    addMatrixSheet(wb, 'Quantites commandees', dates, qtyRows, '#,##0.000');
    addMatrixSheet(wb, 'Prix total HTVA', dates, totalRows, '#,##0.00');
    addMatrixSheet(wb, 'Prix moyen HTVA', dates, avgRows, '#,##0.0000');

    const resumeRows = [
      ...qtyRows.map((r, i) => ({ ...r, seq: i + 1 })),
      ...totalRows.map((r, i) => ({ ...r, seq: i + 1 })),
      ...avgRows.map((r, i) => ({ ...r, seq: i + 1 })),
    ];
    addMatrixSheet(wb, 'Resume', dates, resumeRows, '#,##0.0000');

    await wb.xlsx.writeFile(outPath);
    return { outPath, rowCount: matrixRows.length, dateCount: dates.length };
  } finally {
    if (ownClient) dbClient.release();
  }
}

async function main() {
  await migrate();

  const outDir = OUT_DIR_ARG ? OUT_DIR_ARG.replace('--dest=', '') : DEFAULT_OUT_DIR;
  const outFile = OUT_FILE_ARG ? OUT_FILE_ARG.replace('--out=', '') : DEFAULT_OUT_FILE;
  const outPath = path.join(outDir, outFile);

  const startDate = START_ARG ? START_ARG.replace('--start=', '') : null;
  const endDate = END_ARG ? END_ARG.replace('--end=', '') : null;

  try {
    const res = await exportDetrembleurProductMatrices({ outPath, startDate, endDate });
    console.log(`✅ Export créé: ${res.outPath}`);
    console.log(`   Produits: ${res.rowCount} | Dates: ${res.dateCount}`);
  } finally {
    await pool.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(err => {
    console.error('❌ Erreur export Detrembleur:', err.message);
    process.exit(1);
  });
}
