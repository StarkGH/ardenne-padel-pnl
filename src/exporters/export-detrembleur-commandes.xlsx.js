import ExcelJS from 'exceljs';
import path from 'path';
import dotenv from 'dotenv';
import { pool, migrate } from '../../db.js';

dotenv.config();

const OUT_DIR_ARG = process.argv.find(a => a.startsWith('--dest='));
const OUT_FILE_ARG = process.argv.find(a => a.startsWith('--out='));

const DEFAULT_OUT_DIR = path.join(process.env.HOME || '/home/stark2026', 'projects', 'ardenne-padel-pnl', 'output');
const now = new Date();
const stamp = `${now.getFullYear()}_${String(now.getMonth() + 1).padStart(2, '0')}_${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}_${String(now.getMinutes()).padStart(2, '0')}_${String(now.getSeconds()).padStart(2, '0')}`;
const DEFAULT_OUT_FILE = `DETREMBLEUR_commandes_v2_${stamp}.xlsx`;

function norm(s) {
  return String(s || '').replace(/\s+/g, ' ').trim();
}

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function fmtIsoDate(d) {
  if (!d) return '';
  const dt = d instanceof Date ? d : new Date(d);
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const day = String(dt.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function parseFormat(description) {
  const d = norm(description).toUpperCase();

  if (/\bCHIPS?\b/.test(d)) {
    return { formatAchat: 'boite', quantiteFormat: 20, volume: '40 g', isChips: true };
  }

  const fut = d.match(/F[UÛ]T\s*(\d+)\s*L/);
  if (fut) {
    return { formatAchat: 'fut', quantiteFormat: 1, volume: `${fut[1]} l` };
  }

  const pat1 = d.match(/(\d+)\s*[X]\s*(\d+)\s*CL/); // 24 X 25 CL
  if (pat1) {
    return { formatAchat: 'casier', quantiteFormat: Number(pat1[1]), volume: `${pat1[2]} cl` };
  }

  const pat2 = d.match(/(\d+)\s*CL\s*[X]\s*(\d+)/); // 20CLX24
  if (pat2) {
    return { formatAchat: 'casier', quantiteFormat: Number(pat2[2]), volume: `${pat2[1]} cl` };
  }

  const litre = d.match(/(\d+)\s*L\b/);
  if (litre) {
    return { formatAchat: 'bouteille', quantiteFormat: 1, volume: `${litre[1]} l` };
  }

  if (/\bPAQUET\b|\bCHIPS?\b/.test(d)) {
    return { formatAchat: 'paquet', quantiteFormat: 1, volume: '' };
  }

  return { formatAchat: 'unite', quantiteFormat: 1, volume: '' };
}

function computeQuantite(row, format) {
  const qTotal = toNum(row.quantity_total);
  const qColis = toNum(row.quantity_colis);

  if (format.isChips) {
    if (qColis > 0) return qColis * format.quantiteFormat;
    if (qTotal > 0) return qTotal * format.quantiteFormat;
    return 0;
  }

  if (qTotal > 0) return qTotal;
  if (qColis > 0 && format.quantiteFormat > 1) return qColis * format.quantiteFormat;
  if (qColis > 0) return qColis;
  return 0;
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
    cell.alignment = { horizontal: 'center' };
  });
}

export async function exportDetrembleurCommandes({ outPath } = {}) {
  const client = await pool.connect();
  try {
    const { rows } = await client.query(
      `SELECT
         i.invoice_date,
         i.invoice_number,
         i.total_a_payer,
         il.product_code,
         il.description,
         il.quantity_colis,
         il.quantity_total,
         il.line_total_htva
       FROM invoice_lines il
       JOIN invoices i ON i.id = il.invoice_id
       JOIN suppliers s ON s.id = i.supplier_id
       WHERE s.code = 'DETREMBLEUR'
         AND il.line_type = 'PRODUCT'
         AND COALESCE(il.quantity_total, il.quantity_colis, 0) > 0
       ORDER BY i.invoice_date, i.invoice_number, il.line_order, il.id`
    );

    const wb = new ExcelJS.Workbook();
    wb.creator = 'Ardenne Padel PNL';
    const ws = wb.addWorksheet('Commandes Detrembleur');

    ws.columns = [
      { header: 'Date de commande', key: 'date_cmd', width: 16 },
      { header: 'Num facture', key: 'invoice_number', width: 16 },
      { header: 'Montant total facture TVAC', key: 'invoice_total_tvac', width: 24 },
      { header: 'Ref detrembleur du produit', key: 'ref', width: 24 },
      { header: 'Nom du produit', key: 'nom', width: 44 },
      { header: 'Quantité', key: 'qty', width: 14 },
      { header: 'Prix unitaire', key: 'unit', width: 14 },
      { header: 'Prix total', key: 'total', width: 14 },
      { header: "Format d'achat", key: 'format', width: 16 },
      { header: 'Quantité de format', key: 'format_qty', width: 18 },
      { header: 'Volume', key: 'volume', width: 12 },
    ];

    styleHeader(ws.getRow(1));

    for (const r of rows) {
      const fmt = parseFormat(r.description);
      const qty = computeQuantite(r, fmt);
      const total = toNum(r.line_total_htva);
      let unit = qty > 0 ? total / qty : 0;

      // Chips: prix unitaire attendu par paquet (boite de 20 paquets de 40g).
      if (fmt.isChips && qty > 0) {
        unit = total / qty;
      }

      ws.addRow({
        date_cmd: fmtIsoDate(r.invoice_date),
        invoice_number: norm(r.invoice_number),
        invoice_total_tvac: toNum(r.total_a_payer),
        ref: norm(r.product_code),
        nom: norm(r.description),
        qty,
        unit,
        total,
        format: fmt.formatAchat,
        format_qty: fmt.quantiteFormat,
        volume: fmt.volume,
      });
    }

    for (let i = 2; i <= ws.rowCount; i++) {
      ws.getCell(`C${i}`).numFmt = '#,##0.00';
      ws.getCell(`F${i}`).numFmt = '#,##0.000';
      ws.getCell(`G${i}`).numFmt = '#,##0.00';
      ws.getCell(`H${i}`).numFmt = '#,##0.00';
      ws.getCell(`J${i}`).numFmt = '#,##0';
    }

    ws.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: 11 },
    };

    await wb.xlsx.writeFile(outPath);
    return { outPath, rowCount: rows.length };
  } finally {
    client.release();
  }
}

async function main() {
  await migrate();

  const outDir = OUT_DIR_ARG ? OUT_DIR_ARG.replace('--dest=', '') : DEFAULT_OUT_DIR;
  const outFile = OUT_FILE_ARG ? OUT_FILE_ARG.replace('--out=', '') : DEFAULT_OUT_FILE;
  const outPath = path.resolve(outDir, outFile);

  const res = await exportDetrembleurCommandes({ outPath });
  console.log(`✅ Export Detrembleur commandes: ${res.outPath} (${res.rowCount} lignes)`);
  await pool.end();
}

main().catch(async err => {
  console.error('❌ Erreur export commandes Detrembleur:', err.message);
  await pool.end();
  process.exit(1);
});
