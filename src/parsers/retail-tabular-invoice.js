import fs from 'fs';
import path from 'path';
import ExcelJS from 'exceljs';

function normText(s) {
  return String(s ?? '').replace(/\s+/g, ' ').trim();
}

function stripAccents(s) {
  return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function normKey(s) {
  return stripAccents(normText(s)).toLowerCase();
}

function toNum(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = String(v).trim();
  if (!s) return null;
  const cleaned = s
    .replace(/\s/g, '')
    .replace(/[€$]/g, '')
    .replace(/\./g, '')
    .replace(',', '.');
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function parseDate(v) {
  if (!v) return null;
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v;
  if (typeof v === 'number') {
    // Excel serial date
    const d = new Date(Math.round((v - 25569) * 86400 * 1000));
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const s = String(v).trim();
  const m1 = s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/);
  if (m1) return new Date(Number(m1[3]), Number(m1[2]) - 1, Number(m1[1]));
  const m2 = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m2) return new Date(Number(m2[1]), Number(m2[2]) - 1, Number(m2[3]));
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function toIsoDate(d) {
  if (!d) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function splitCsvLine(line, sep) {
  const out = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (!inQuotes && ch === sep) {
      out.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out;
}

function bestSeparator(line) {
  const s = String(line || '');
  const semicolons = (s.match(/;/g) || []).length;
  const commas = (s.match(/,/g) || []).length;
  return semicolons >= commas ? ';' : ',';
}

function parseCsv(content) {
  const rawLines = String(content || '').replace(/\r\n/g, '\n').split('\n');
  const lines = rawLines.filter(l => l.trim() !== '');
  if (lines.length === 0) return [];
  const sep = bestSeparator(lines[0]);
  return lines.map(l => splitCsvLine(l, sep).map(c => normText(c)));
}

async function parseXlsx(filePath) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);
  const ws = wb.worksheets[0];
  if (!ws) return [];
  const out = [];
  ws.eachRow({ includeEmpty: false }, (row) => {
    const cells = [];
    row.eachCell({ includeEmpty: true }, (cell, idx) => {
      cells[idx - 1] = normText(cell.text ?? cell.value ?? '');
    });
    out.push(cells);
  });
  return out;
}

function guessHeaderRow(table) {
  const aliases = [
    'code', 'ref', 'produit', 'libelle', 'designation',
    'quantite', 'qty', 'prix', 'htva', 'tva', 'total',
  ];
  let best = { idx: 0, score: -1 };
  const max = Math.min(table.length, 20);
  for (let i = 0; i < max; i += 1) {
    const row = table[i] || [];
    const keys = row.map(normKey);
    const score = aliases.reduce((s, a) => s + (keys.some(k => k.includes(a)) ? 1 : 0), 0);
    if (score > best.score) best = { idx: i, score };
  }
  return best.score <= 0 ? 0 : best.idx;
}

function buildHeaderIndex(headerRow) {
  const idx = {};
  const set = (name, i) => { if (idx[name] === undefined) idx[name] = i; };

  headerRow.forEach((h, i) => {
    const k = normKey(h);
    if (!k) return;

    if (k.includes('code article') || k === 'code' || k === 'ref' || k.includes('reference')) set('product_code', i);
    if (k.includes('designation') || k.includes('description') || k.includes('libelle') || k.includes('produit') || k.includes('article')) set('description', i);
    if (k.includes('qte colis') || k.includes('quantite colis')) set('quantity_colis', i);
    if (k.includes('qte') || k.includes('quantite') || k === 'qty' || k.includes('quantite totale')) set('quantity_total', i);
    if (k.includes('prix unitaire ht') || k.includes('pu ht') || k.includes('prix ht')) set('net_unit_price', i);
    if (k.includes('prix unitaire')) set('unit_price', i);
    if (k.includes('montant ht') || k.includes('total ht') || k.includes('line total ht')) set('line_total_htva', i);
    if (k.includes('tva')) set('tva_rate', i);
    if (k.includes('date facture') || k === 'date' || k.includes('invoice date')) set('invoice_date', i);
    if (k.includes('num facture') || k.includes('numero facture') || k.includes('invoice number')) set('invoice_number', i);
    if (k.includes('total a payer') || k.includes('total ttc') || k.includes('total tvac')) set('invoice_total_tvac', i);
  });
  return idx;
}

function getCell(row, idxMap, key) {
  const i = idxMap[key];
  if (i === undefined) return null;
  return row[i] ?? null;
}

function parseInvoiceNumberFromFilename(filePath) {
  const base = path.basename(filePath, path.extname(filePath));
  const m = base.match(/(\d{4,})/);
  return m ? m[1] : base.slice(0, 60);
}

export class RetailTabularInvoiceParser {
  constructor(opts = {}) {
    this.supplierCode = String(opts.supplierCode || '').toUpperCase() || 'UNKNOWN';
  }

  async parse(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    let table = [];

    if (ext === '.csv') {
      table = parseCsv(fs.readFileSync(filePath, 'utf8'));
    } else if (ext === '.xlsx' || ext === '.xls') {
      table = await parseXlsx(filePath);
    } else {
      throw new Error(`Format non supporté pour parser tabulaire: ${ext} (attendu: .csv/.xlsx/.xls)`);
    }

    if (!Array.isArray(table) || table.length === 0) {
      throw new Error('Fichier vide ou non lisible');
    }

    const headerRowIdx = guessHeaderRow(table);
    const headers = table[headerRowIdx] || [];
    const idx = buildHeaderIndex(headers);
    const dataRows = table.slice(headerRowIdx + 1);

    const lines = [];
    let detectedInvoiceNumber = null;
    let detectedInvoiceDate = null;
    let detectedInvoiceTotalTvac = null;

    for (const row of dataRows) {
      const description = normText(getCell(row, idx, 'description'));
      const productCode = normText(getCell(row, idx, 'product_code'));
      const qTotal = toNum(getCell(row, idx, 'quantity_total'));
      const qColis = toNum(getCell(row, idx, 'quantity_colis'));
      const netUnit = toNum(getCell(row, idx, 'net_unit_price'));
      const unitPrice = toNum(getCell(row, idx, 'unit_price'));
      const lineTotal = toNum(getCell(row, idx, 'line_total_htva'));
      const tvaRaw = normText(getCell(row, idx, 'tva_rate'));

      if (!detectedInvoiceNumber) {
        const invNum = normText(getCell(row, idx, 'invoice_number'));
        if (invNum) detectedInvoiceNumber = invNum;
      }
      if (!detectedInvoiceDate) {
        const d = parseDate(getCell(row, idx, 'invoice_date'));
        if (d) detectedInvoiceDate = d;
      }
      if (detectedInvoiceTotalTvac === null) {
        const totalTvac = toNum(getCell(row, idx, 'invoice_total_tvac'));
        if (totalTvac !== null) detectedInvoiceTotalTvac = totalTvac;
      }

      const hasLineSignal =
        description ||
        productCode ||
        qTotal !== null ||
        qColis !== null ||
        netUnit !== null ||
        lineTotal !== null;
      if (!hasLineSignal) continue;

      if (!description && lineTotal === null && qTotal === null && qColis === null) continue;

      const qty = qTotal ?? qColis ?? 0;
      const net = netUnit ?? unitPrice ?? ((lineTotal !== null && qty) ? (lineTotal / qty) : null);
      const tvaRate = tvaRaw
        ? (tvaRaw.includes('%') ? tvaRaw : `${toNum(tvaRaw) ?? tvaRaw}%`)
        : null;

      lines.push({
        product_code: productCode || null,
        description: description || productCode || 'ARTICLE SANS LIBELLE',
        quantity_colis: qColis,
        quantity_total: qTotal ?? qColis,
        unit_price: unitPrice,
        excise_ecoboni: null,
        discount_pct: null,
        net_unit_price: net,
        line_total_htva: lineTotal ?? ((net !== null && qty) ? net * qty : null),
        vid_unit: null,
        vid_total: null,
        tva_rate: tvaRate,
        line_type: 'PRODUCT',
      });
    }

    if (lines.length === 0) {
      throw new Error('Aucune ligne produit détectée (vérifie les entêtes colonnes)');
    }

    const totalHt = lines.reduce((s, l) => s + (toNum(l.line_total_htva) || 0), 0);
    const inferredTvac = lines.reduce((s, l) => {
      const ht = toNum(l.line_total_htva) || 0;
      const rate = toNum(String(l.tva_rate || '').replace('%', '')) || 0;
      return s + ht * (1 + rate / 100);
    }, 0);

    const header = {
      invoice_number: detectedInvoiceNumber || parseInvoiceNumberFromFilename(filePath),
      invoice_date: toIsoDate(detectedInvoiceDate) || toIsoDate(new Date()),
      bordereau_number: null,
      due_date: null,
      reference: null,
      client_number: null,
      doc_type: 'FACTURE',
    };

    const summary = {
      total_a_payer: detectedInvoiceTotalTvac ?? inferredTvac,
      total_htva_21: null,
      total_tva_21: null,
      total_htva_6: null,
      total_tva_6: null,
      vidanges_livrees: null,
      vidanges_reprises: null,
      total_htva_inferred: totalHt,
    };

    const warnings = [];
    if (!detectedInvoiceNumber) warnings.push('Numéro facture absent dans fichier: fallback nom fichier');
    if (!detectedInvoiceDate) warnings.push('Date facture absente: fallback date du jour');
    if (detectedInvoiceTotalTvac === null) warnings.push('Total TVAC absent: total recalculé depuis lignes');

    return {
      header,
      lines,
      summary,
      validation: {
        valid: true,
        warnings,
      },
    };
  }
}

