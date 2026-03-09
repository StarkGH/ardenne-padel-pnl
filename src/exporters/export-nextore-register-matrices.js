import ExcelJS from 'exceljs';
import path from 'path';
import dotenv from 'dotenv';
import { pool, migrate } from '../../db.js';

dotenv.config();

const OUT_DIR_ARG = process.argv.find(a => a.startsWith('--dest='));
const OUT_FILE_ARG = process.argv.find(a => a.startsWith('--out='));
const START_ARG = process.argv.find(a => a.startsWith('--start='));
const END_ARG = process.argv.find(a => a.startsWith('--end='));
const SEGMENT_ARG = process.argv.find(a => a.startsWith('--segment='));

const DEFAULT_OUT_DIR = path.join(process.env.HOME || '/home/stark2026', 'projects', 'ardenne-padel-pnl', 'output');
const DEFAULT_OUT_FILE = 'NEXTORE_tableaux_registres.xlsx';

function fmtIsoDate(d) {
  if (!d) return '';
  const dt = d instanceof Date ? d : new Date(d);
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const day = String(dt.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function todayIso() {
  return fmtIsoDate(new Date());
}

function normalizeLabel(s) {
  return String(s || '').replace(/\s+/g, ' ').trim().toUpperCase();
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
  const dates = [...new Set(rows.map(r => fmtIsoDate(r.open_date)).filter(Boolean))].sort();
  const products = new Map();

  for (const r of rows) {
    const date = fmtIsoDate(r.open_date);
    if (!date) continue;

    const label = normalizeLabel(r.item);
    if (!label) continue;

    if (!products.has(label)) {
      products.set(label, { label, byDate: {} });
    }

    const curr = products.get(label);
    if (!curr.byDate[date]) {
      curr.byDate[date] = { qty: 0, total: 0 };
    }

    curr.byDate[date].qty += toNum(r.qty);
    curr.byDate[date].total += toNum(r.total);
  }

  const matrixRows = [...products.values()].sort((a, b) => a.label.localeCompare(b.label, 'fr'));
  return { dates, rows: matrixRows };
}

function buildSheetRows(dates, matrixRows, typeLabel, valueGetter) {
  return matrixRows.map((r, idx) => ({
    seq: idx + 1,
    type: typeLabel,
    label: r.label,
    values: dates.map(d => valueGetter(r.byDate[d])),
  }));
}

function addSheet(wb, name, dates, sheetRows, numberFormat) {
  const ws = wb.addWorksheet(name);
  ws.columns = [
    { key: 'seq', width: 8 },
    { key: 'type', width: 22 },
    { key: 'label', width: 42 },
    ...dates.map(d => ({ key: d, width: 14 })),
  ];

  const hdr = ws.addRow(['Seq', "Type d'export", 'Libellé produit', ...dates]);
  styleHeader(hdr);

  for (const r of sheetRows) {
    const row = ws.addRow([r.seq, r.type, r.label, ...r.values]);
    numFmt(row.getCell(1), '0');
    for (let c = 4; c <= 3 + dates.length; c++) {
      numFmt(row.getCell(c), numberFormat);
    }
  }

  ws.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: 3 + dates.length },
  };
}

export async function exportNextoreRegisterMatrices({ client, outPath, startDate, endDate, segment = 'BAR' } = {}) {
  const ownClient = !client;
  const dbClient = client || (await pool.connect());

  try {
    const { rows } = await dbClient.query(
      `SELECT r.open_date, s.item, SUM(COALESCE(s.count,0))::numeric AS qty, SUM(COALESCE(s.amount,0))::numeric AS total
       FROM nr_sales s
       JOIN nr_registers r ON r.id = s.register_id
       WHERE r.open_date BETWEEN $1 AND $2
         AND s.segment = $3
         AND s.item IS NOT NULL
         AND s.item <> ''
         AND s.item <> 'TOTAL'
       GROUP BY r.open_date, s.item
       ORDER BY r.open_date, s.item`,
      [startDate, endDate, segment]
    );

    const { dates, rows: matrixRows } = buildMatrices(rows);

    const wb = new ExcelJS.Workbook();
    wb.creator = 'Ardenne Padel PNL';

    const qtyRows = buildSheetRows(dates, matrixRows, 'Quantités', day => toNum(day?.qty));
    const unitRows = buildSheetRows(dates, matrixRows, 'Prix unitaires', day => {
      const qty = toNum(day?.qty);
      const total = toNum(day?.total);
      return qty > 0 ? total / qty : 0;
    });
    const totalRows = buildSheetRows(dates, matrixRows, 'Prix totaux', day => toNum(day?.total));

    addSheet(wb, 'Quantites', dates, qtyRows, '#,##0.000');
    addSheet(wb, 'Prix unitaires', dates, unitRows, '#,##0.0000');
    addSheet(wb, 'Prix totaux', dates, totalRows, '#,##0.00');

    const resumeRows = [
      ...qtyRows.map((r, i) => ({ ...r, seq: i + 1 })),
      ...unitRows.map((r, i) => ({ ...r, seq: i + 1 })),
      ...totalRows.map((r, i) => ({ ...r, seq: i + 1 })),
    ];
    addSheet(wb, 'Resume', dates, resumeRows, '#,##0.0000');

    await wb.xlsx.writeFile(outPath);
    return { outPath, productCount: matrixRows.length, dateCount: dates.length, rowCount: rows.length };
  } finally {
    if (ownClient) dbClient.release();
  }
}

async function main() {
  await migrate();

  const outDir = OUT_DIR_ARG ? OUT_DIR_ARG.replace('--dest=', '') : DEFAULT_OUT_DIR;
  const outFile = OUT_FILE_ARG ? OUT_FILE_ARG.replace('--out=', '') : DEFAULT_OUT_FILE;
  const outPath = path.join(outDir, outFile);

  const startDate = START_ARG ? START_ARG.replace('--start=', '') : '2025-10-01';
  const endDate = END_ARG ? END_ARG.replace('--end=', '') : todayIso();
  const segment = SEGMENT_ARG ? SEGMENT_ARG.replace('--segment=', '').toUpperCase() : 'BAR';

  try {
    const res = await exportNextoreRegisterMatrices({ outPath, startDate, endDate, segment });
    console.log(`✅ Export créé: ${res.outPath}`);
    console.log(`   Segment: ${segment} | Produits: ${res.productCount} | Dates: ${res.dateCount}`);
    console.log(`   Agrégats source (date+item): ${res.rowCount}`);
  } finally {
    await pool.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(err => {
    console.error('❌ Erreur export Nextore:', err.message);
    process.exit(1);
  });
}
