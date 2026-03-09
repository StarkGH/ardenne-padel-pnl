import fs from 'fs';
import { pool } from '../../db.js';
import path from 'path';

function normText(s) {
  return String(s || '').replace(/\s+/g, ' ').trim();
}

function normUpper(s) {
  return normText(s).toUpperCase();
}

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function round2(v) {
  return Math.round(toNum(v) * 100) / 100;
}

function fmtIsoDate(d) {
  if (!d) return '';
  if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}/.test(d)) {
    return d.slice(0, 10);
  }
  const dt = d instanceof Date ? d : new Date(d);
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const day = String(dt.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function getNowjobsSourceFile() {
  const base = process.env.DATA_DIR ||
    '/mnt/c/Users/stark/OneDrive - Antoine Zingaro (CQFD Consult)/Boulot New/Ardenne Padel/_Finance/PNL/Shared';
  return path.join(base, 'BAR', 'Prestation Bar de octobre à fin février.xlsx');
}

function listFilesRecursive(rootDir) {
  const out = [];
  const walk = (dir) => {
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile()) out.push(p);
    }
  };
  walk(rootDir);
  return out;
}

function normalizeUpperAscii(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase();
}

function parseNowjobsPeriodFromName(name) {
  const u = normalizeUpperAscii(name);
  const m = u.match(/NOWJOBS\s*-\s*([A-Z]+)\s*(\d{2,4})\b/);
  if (!m) return null;
  const monthMap = {
    JAN: '01', JANV: '01', JANVIER: '01',
    FEV: '02', FEVRIER: '02',
    MAR: '03', MARS: '03',
    AVR: '04', AVRIL: '04',
    MAI: '05',
    JUIN: '06',
    JUIL: '07', JUILLET: '07',
    AOU: '08', AOUT: '08',
    SEP: '09', SEPT: '09', SEPTEMBRE: '09',
    OCT: '10', OCTOBRE: '10',
    NOV: '11', NOVEMBRE: '11',
    DEC: '12', DECEMBRE: '12',
  };
  const mm = monthMap[m[1]] || null;
  if (!mm) return null;
  const yRaw = m[2];
  const yyyy = yRaw.length === 2 ? `20${yRaw}` : yRaw;
  return `${yyyy}-${mm}`;
}

function parseNowjobsAmountFromName(name) {
  const s = String(name || '');
  const matches = [...s.matchAll(/([0-9]+(?:[.,][0-9]{1,2})?)\s*€/gi)];
  if (matches.length > 0) {
    return toNum(matches[matches.length - 1][1]);
  }
  return null;
}

function hashStringToInt(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h += (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24);
  }
  return Math.abs(h >>> 0);
}

function getNowjobsPdfEntries() {
  const base = process.env.DATA_DIR ||
    '/mnt/c/Users/stark/OneDrive - Antoine Zingaro (CQFD Consult)/Boulot New/Ardenne Padel/_Finance/PNL/Shared';
  const all = listFilesRecursive(base)
    .filter(f => /\.pdf$/i.test(f))
    .filter(f => /NOWJOBS/i.test(path.basename(f)));

  // Deduplicate by basename; prefer BAR/DB copy when duplicates exist.
  const byName = new Map();
  for (const f of all) {
    const bn = path.basename(f);
    const period = parseNowjobsPeriodFromName(bn);
    if (!period) continue;
    const inBarDb = /[\\/]BAR[\\/]DB[\\/]/i.test(f) ? 1 : 0;
    const mtime = (() => {
      try { return fs.statSync(f).mtimeMs || 0; } catch { return 0; }
    })();
    const score = inBarDb * 1_000_000_000 + mtime;
    const prev = byName.get(bn);
    if (!prev || score > prev.score) {
      byName.set(bn, { file: f, score, period });
    }
  }

  const entries = [];
  for (const [basename, v] of byName.entries()) {
    const amount = parseNowjobsAmountFromName(basename);
    const period = v.period;
    const id = - (200000000 + (hashStringToInt(v.file) % 700000000));
    entries.push({
      id,
      period_month: period,
      invoice_number: basename.replace(/\.pdf$/i, ''),
      invoice_date: `${period}-01`,
      total_a_payer: Number.isFinite(amount) ? amount : null,
      source_file: v.file,
      source_file_name: basename,
    });
  }

  entries.sort((a, b) => {
    if (a.period_month !== b.period_month) return b.period_month.localeCompare(a.period_month);
    return String(a.invoice_number).localeCompare(String(b.invoice_number), 'fr');
  });
  return entries;
}

function chooseBestSubset(days, targetCents) {
  if (!Number.isFinite(targetCents) || targetCents <= 0 || !Array.isArray(days) || days.length === 0) {
    return { indices: [], sumCents: 0 };
  }
  const maxSum = days.reduce((s, d) => s + (d.cents || 0), 0);
  const limit = Math.min(maxSum, targetCents + 1000); // +10 EUR marge
  let sums = new Map([[0, 0n]]);
  for (let i = 0; i < days.length; i += 1) {
    const v = days[i].cents || 0;
    const bit = (1n << BigInt(i));
    const next = new Map(sums);
    for (const [s, mask] of sums.entries()) {
      const ns = s + v;
      if (ns > limit) continue;
      if (!next.has(ns)) next.set(ns, mask | bit);
    }
    sums = next;
  }

  let bestSum = 0;
  let bestDiff = Number.POSITIVE_INFINITY;
  for (const s of sums.keys()) {
    const diff = Math.abs(s - targetCents);
    if (diff < bestDiff || (diff === bestDiff && s > bestSum)) {
      bestDiff = diff;
      bestSum = s;
    }
  }
  const mask = sums.get(bestSum) || 0n;
  const indices = [];
  for (let i = 0; i < days.length; i += 1) {
    if ((mask & (1n << BigInt(i))) !== 0n) indices.push(i);
  }
  return { indices, sumCents: bestSum };
}

async function buildNowjobsAssignments(client) {
  const entries = getNowjobsPdfEntries();
  const { rows } = await client.query(
    `SELECT
       to_char(shift_date, 'YYYY-MM') AS period_month,
       to_char(shift_date, 'YYYY-MM-DD') AS shift_date,
       coalesce(sum(cost_prorata), 0)::numeric(12,2) AS total_htva
     FROM nowjobs_prestations
     GROUP BY to_char(shift_date, 'YYYY-MM'), to_char(shift_date, 'YYYY-MM-DD')
     ORDER BY period_month, shift_date`
  );
  const daysByPeriod = new Map();
  for (const r of rows) {
    const p = String(r.period_month || '');
    if (!daysByPeriod.has(p)) daysByPeriod.set(p, []);
    daysByPeriod.get(p).push({
      shift_date: String(r.shift_date),
      cents: Math.round((Number(r.total_htva) || 0) * 100),
      used: false,
    });
  }

  const entriesByPeriod = new Map();
  for (const e of entries) {
    if (!entriesByPeriod.has(e.period_month)) entriesByPeriod.set(e.period_month, []);
    entriesByPeriod.get(e.period_month).push(e);
  }

  const assignById = new Map();
  for (const [period, periodEntries] of entriesByPeriod.entries()) {
    const days = daysByPeriod.get(period) || [];
    const sorted = [...periodEntries].sort((a, b) => {
      const av = Number(a.total_a_payer || 0);
      const bv = Number(b.total_a_payer || 0);
      return bv - av;
    });
    for (const e of sorted) {
      const target = Math.round((Number(e.total_a_payer) || 0) * 100);
      const available = days
        .map((d, idx) => ({ ...d, idx }))
        .filter(d => !d.used && d.cents > 0);
      if (available.length === 0 || target <= 0) {
        assignById.set(e.id, { dates: [], assigned_total: 0 });
        continue;
      }
      const pick = chooseBestSubset(available, target);
      const pickedDates = [];
      let assigned = 0;
      for (const localIdx of pick.indices) {
        const originalIdx = available[localIdx].idx;
        days[originalIdx].used = true;
        pickedDates.push(days[originalIdx].shift_date);
        assigned += days[originalIdx].cents;
      }
      assignById.set(e.id, {
        dates: pickedDates.sort(),
        assigned_total: Math.round((assigned / 100) * 100) / 100,
      });
    }
  }

  return { entries, assignById };
}

function parseDetrembleurFormat(description) {
  const d = normText(description).toUpperCase();

  if (/\bCHIPS?\b/.test(d)) {
    return { format_achat: 'boite', quantite_format: 20, volume: '40 g', is_chips: true };
  }

  if (/\bPEKET\b/.test(d)) {
    return { format_achat: 'bouteille', quantite_format: 1, volume: '1 l', is_chips: false };
  }

  const fut = d.match(/F[UÛ]T\s*(\d+)\s*L/);
  if (fut) return { format_achat: 'fut', quantite_format: 1, volume: `${fut[1]} l`, is_chips: false };

  const pat1 = d.match(/(\d+)\s*[X]\s*(\d+)\s*CL/);
  if (pat1) return { format_achat: 'casier', quantite_format: Number(pat1[1]), volume: `${pat1[2]} cl`, is_chips: false };

  const pat2 = d.match(/(\d+)\s*CL\s*[X]\s*(\d+)/);
  if (pat2) return { format_achat: 'casier', quantite_format: Number(pat2[2]), volume: `${pat2[1]} cl`, is_chips: false };

  const patL1 = d.match(/(\d+)\s*[X]\s*([\d.,]+)\s*L\b/);   // 6 X 1 L
  if (patL1) return { format_achat: 'casier', quantite_format: Number(patL1[1]), volume: `${patL1[2].replace(',', '.')} l`, is_chips: false };

  const patL2 = d.match(/([\d.,]+)\s*L\s*[X]\s*(\d+)/);      // 1 L X 6
  if (patL2) return { format_achat: 'casier', quantite_format: Number(patL2[2]), volume: `${patL2[1].replace(',', '.')} l`, is_chips: false };

  const litre = d.match(/(\d+)\s*L\b/);
  if (litre) return { format_achat: 'bouteille', quantite_format: 1, volume: `${litre[1]} l`, is_chips: false };

  if (/\bPAQUET\b/.test(d)) return { format_achat: 'paquet', quantite_format: 1, volume: '', is_chips: false };
  return { format_achat: 'unite', quantite_format: 1, volume: '', is_chips: false };
}

function parseVolumeToLiters(volumeText) {
  const v = normText(volumeText).toLowerCase();
  if (!v) return null;
  const cl = v.match(/([\d.,]+)\s*cl\b/);
  if (cl) return toNum(cl[1].replace(',', '.')) / 100;
  const l = v.match(/([\d.,]+)\s*l\b/);
  if (l) return toNum(l[1].replace(',', '.'));
  return null;
}

function getPackageVolumeLitersFromLabel(label, volumeOverride = null) {
  const overrideL = parseVolumeToLiters(volumeOverride);
  if (overrideL && overrideL > 0) return overrideL;
  const fmt = parseDetrembleurFormat(label);
  const unitVolumeL = parseVolumeToLiters(fmt.volume);
  if (!unitVolumeL || unitVolumeL <= 0) return null;
  // Le prix de référence est stocké au niveau de l'unité vendue (bouteille/verre/etc.),
  // donc pour le coût recette volumétrique on garde le volume unitaire.
  return unitVolumeL;
}

function parseTvaPctAny(v) {
  const m = String(v || '').match(/[\d.,]+/);
  if (!m) return 0;
  const n = Number(String(m[0]).replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

function parseVolumeClFromText(text) {
  const t = normText(text).toUpperCase();
  const cl = t.match(/(\d+(?:[.,]\d+)?)\s*CL\b/);
  if (cl) return toNum(String(cl[1]).replace(',', '.'));
  const l = t.match(/(\d+(?:[.,]\d+)?)\s*L\b/);
  if (l) return toNum(String(l[1]).replace(',', '.')) * 100;
  return null;
}

function toCl(qty, unit) {
  const q = toNum(qty);
  const u = normText(unit).toLowerCase();
  if (!(q > 0)) return null;
  if (u === 'cl') return q;
  if (u === 'l') return q * 100;
  if (u === 'ml') return q / 10;
  return null;
}

function computeDetrembleurQty(row, format) {
  const qTotal = toNum(row.quantity_total);
  const qColis = toNum(row.quantity_colis);
  const desc = normText(row.description).toUpperCase();
  const isLikelyCaseReturnQty = (q) =>
    q < 0
    && format.quantite_format > 1
    && (Math.abs(q) <= 5 || /-\s*$/.test(desc));

  if (format.is_chips) {
    if (qColis !== 0) return qColis * format.quantite_format;
    if (qTotal !== 0) return qTotal * format.quantite_format;
    return 0;
  }

  if (qTotal !== 0) {
    if (isLikelyCaseReturnQty(qTotal)) return qTotal * format.quantite_format;
    return qTotal;
  }
  if (qColis !== 0 && format.quantite_format > 1) return qColis * format.quantite_format;
  if (qColis !== 0) return qColis;
  return 0;
}

export async function listSuppliers(client) {
  const { rows } = await client.query(
    `SELECT id, code, name
     FROM suppliers
     ORDER BY code`
  );
  return rows;
}

export async function syncNextoreProducts(client) {
  const { rows } = await client.query(
    `WITH raw_src AS (
       SELECT
         UPPER(TRIM(s.item)) AS code,
         TRIM(s.item) AS label,
         'nr_sales'::text AS source
       FROM nr_sales s
       WHERE s.item IS NOT NULL
         AND TRIM(s.item) <> ''
         AND TRIM(s.item) NOT IN ('TOTAL', 'Avoir emis')
       UNION ALL
       SELECT
         UPPER(TRIM(ns.article_name)) AS code,
         TRIM(ns.article_name) AS label,
         'nextore_sales'::text AS source
       FROM nextore_sales ns
       WHERE ns.article_name IS NOT NULL
         AND TRIM(ns.article_name) <> ''
     ),
     src AS (
       SELECT DISTINCT ON (code)
         code, label, source
       FROM raw_src
       WHERE code IS NOT NULL
         AND code <> ''
       ORDER BY code, CASE source WHEN 'nr_sales' THEN 0 ELSE 1 END
     )
     INSERT INTO nextore_products (code, label, source, updated_at)
     SELECT code, label, source, NOW()
     FROM src
     ON CONFLICT (code) DO UPDATE SET
       label = EXCLUDED.label,
       source = EXCLUDED.source,
       updated_at = NOW()
     RETURNING id`
  );
  return rows.length;
}

export async function syncSupplierProducts(client, supplierCode) {
  const { rows: sup } = await client.query(
    `SELECT id, code FROM suppliers WHERE code = $1`,
    [supplierCode]
  );
  if (sup.length === 0) {
    throw new Error(`Fournisseur inconnu: ${supplierCode}`);
  }
  const supplierId = sup[0].id;

  const { rows } = await client.query(
    `WITH src_base AS (
       SELECT
         COALESCE(NULLIF(TRIM(il.product_code), ''), '') AS supplier_product_code,
         TRIM(il.description) AS label,
         LOWER(TRIM(il.description)) AS label_norm,
         il.tva_rate,
         il.net_unit_price AS last_unit_price,
         'invoice_lines'::text AS source,
         i.invoice_date
       FROM invoice_lines il
       JOIN invoices i ON i.id = il.invoice_id
       JOIN suppliers s ON s.id = i.supplier_id
       WHERE s.code = $1
         AND il.line_type = 'PRODUCT'
         AND il.description IS NOT NULL
         AND TRIM(il.description) <> ''
     ),
     src_coded AS (
       SELECT DISTINCT ON (supplier_product_code)
         supplier_product_code, label, label_norm, tva_rate, last_unit_price, source, invoice_date
       FROM src_base
       WHERE supplier_product_code <> ''
       ORDER BY supplier_product_code, invoice_date DESC
     ),
     src_uncoded AS (
       SELECT DISTINCT ON (label_norm)
         supplier_product_code, label, label_norm, tva_rate, last_unit_price, source, invoice_date
       FROM src_base
       WHERE supplier_product_code = ''
       ORDER BY label_norm, invoice_date DESC
     ),
     updated_coded AS (
       UPDATE supplier_products sp
       SET
         label = sc.label,
         label_norm = sc.label_norm,
         tva_rate = sc.tva_rate,
         last_unit_price = sc.last_unit_price,
         source = sc.source,
         updated_at = NOW()
       FROM src_coded sc
       WHERE sp.supplier_id = $2
         AND sp.supplier_product_code = sc.supplier_product_code
       RETURNING sp.id
     ),
     inserted_coded AS (
       INSERT INTO supplier_products (
         supplier_id, supplier_product_code, label, label_norm,
         tva_rate, last_unit_price, source, updated_at
       )
       SELECT
         $2,
         sc.supplier_product_code,
         sc.label,
         sc.label_norm,
         sc.tva_rate,
         sc.last_unit_price,
         sc.source,
         NOW()
       FROM src_coded sc
       WHERE NOT EXISTS (
         SELECT 1
         FROM supplier_products sp
         WHERE sp.supplier_id = $2
           AND sp.supplier_product_code = sc.supplier_product_code
       )
       RETURNING id
     ),
     upsert_uncoded AS (
       INSERT INTO supplier_products (
         supplier_id, supplier_product_code, label, label_norm,
         tva_rate, last_unit_price, source, updated_at
       )
       SELECT
         $2,
         '',
         su.label,
         su.label_norm,
         su.tva_rate,
         su.last_unit_price,
         su.source,
         NOW()
       FROM src_uncoded su
       ON CONFLICT (supplier_id, supplier_product_code, label_norm) DO UPDATE SET
         label = EXCLUDED.label,
         tva_rate = EXCLUDED.tva_rate,
         last_unit_price = EXCLUDED.last_unit_price,
         source = EXCLUDED.source,
         updated_at = NOW()
       RETURNING id
     )
     SELECT
       (SELECT COUNT(*) FROM updated_coded)
       + (SELECT COUNT(*) FROM inserted_coded)
       + (SELECT COUNT(*) FROM upsert_uncoded) AS touched`,
    [supplierCode, supplierId]
  );
  return Number(rows[0]?.touched || 0);
}

export async function listNextoreCategories(client) {
  const { rows } = await client.query(
    `SELECT DISTINCT TRIM(category) AS category
     FROM nextore_sales
     WHERE category IS NOT NULL
       AND TRIM(category) <> ''
     ORDER BY category`
  );
  return rows.map(r => r.category);
}

export async function listNextoreProducts(client, q = '', category = '', includeMatched = true) {
  const like = `%${normText(q)}%`;
  const categoryFilter = normText(category);
  const includeMatchedFilter = Boolean(includeMatched);
  const { rows } = await client.query(
    `WITH nextore_cat AS (
       SELECT DISTINCT ON (UPPER(TRIM(ns.article_name)))
         UPPER(TRIM(ns.article_name)) AS code_norm,
         TRIM(ns.category) AS category
       FROM nextore_sales ns
       WHERE ns.article_name IS NOT NULL
         AND TRIM(ns.article_name) <> ''
       ORDER BY UPPER(TRIM(ns.article_name)), TRIM(ns.category)
     ),
     mapping_counts AS (
       SELECT pm.nextore_product_id, COUNT(*)::int AS mapping_count
       FROM product_mappings pm
       GROUP BY pm.nextore_product_id
     ),
     nextore_latest_date AS (
       SELECT
         UPPER(TRIM(ns.article_name)) AS code_norm,
         MAX(ns.sale_date) AS latest_sale_date
       FROM nextore_sales ns
       WHERE ns.article_name IS NOT NULL
         AND TRIM(ns.article_name) <> ''
       GROUP BY UPPER(TRIM(ns.article_name))
     ),
     nextore_total_qty AS (
       SELECT
         UPPER(TRIM(ns.article_name)) AS code_norm,
         SUM(COALESCE(ns.quantity, 0))::numeric AS selling_total_qty
       FROM nextore_sales ns
       WHERE ns.article_name IS NOT NULL
         AND TRIM(ns.article_name) <> ''
       GROUP BY UPPER(TRIM(ns.article_name))
     ),
     nextore_price_stats AS (
       SELECT
         UPPER(TRIM(ns.article_name)) AS code_norm,
         ROUND((ns.amount_ht / NULLIF(ns.quantity, 0))::numeric, 2) AS unit_price_htva,
         ROUND((ns.amount_ttc / NULLIF(ns.quantity, 0))::numeric, 2) AS unit_price_tvac,
         SUM(ns.quantity)::numeric AS qty
      FROM nextore_sales ns
      JOIN nextore_latest_date nld
        ON nld.code_norm = UPPER(TRIM(ns.article_name))
       AND ns.sale_date = nld.latest_sale_date
      WHERE ns.article_name IS NOT NULL
        AND TRIM(ns.article_name) <> ''
        AND ns.quantity IS NOT NULL
        AND ns.quantity <> 0
        AND ns.amount_ht IS NOT NULL
         AND ns.amount_ttc IS NOT NULL
       GROUP BY
         UPPER(TRIM(ns.article_name)),
         ROUND((ns.amount_ht / NULLIF(ns.quantity, 0))::numeric, 2),
         ROUND((ns.amount_ttc / NULLIF(ns.quantity, 0))::numeric, 2)
     ),
     nextore_price_agg AS (
       SELECT
         ps.code_norm,
         JSON_AGG(
           JSON_BUILD_OBJECT(
             'unit_price_htva', ps.unit_price_htva,
             'unit_price_tvac', ps.unit_price_tvac,
             'qty', ps.qty
           )
           ORDER BY ps.qty DESC, ps.unit_price_htva
         ) AS selling_price_stats
       FROM nextore_price_stats ps
       GROUP BY ps.code_norm
     ),
     nextore_price_dom AS (
       SELECT DISTINCT ON (ps.code_norm)
         ps.code_norm,
         ps.unit_price_htva AS dominant_unit_price_htva,
         ps.unit_price_tvac AS dominant_unit_price_tvac
       FROM nextore_price_stats ps
       ORDER BY ps.code_norm, ps.qty DESC, ps.unit_price_htva
     )
     SELECT
       np.id,
       np.code,
       np.label,
       nc.category,
       COALESCE(mc.mapping_count, 0) AS mapping_count,
       (COALESCE(mc.mapping_count, 0) > 0) AS has_mapping,
       COALESCE(ntq.selling_total_qty, 0) AS selling_total_qty,
       COALESCE(npa.selling_price_stats, '[]'::json) AS selling_price_stats,
       npd.dominant_unit_price_htva,
       npd.dominant_unit_price_tvac
     FROM nextore_products np
     LEFT JOIN nextore_cat nc ON nc.code_norm = UPPER(TRIM(np.code))
     LEFT JOIN mapping_counts mc ON mc.nextore_product_id = np.id
     LEFT JOIN nextore_total_qty ntq ON ntq.code_norm = UPPER(TRIM(np.code))
     LEFT JOIN nextore_price_agg npa ON npa.code_norm = UPPER(TRIM(np.code))
     LEFT JOIN nextore_price_dom npd ON npd.code_norm = UPPER(TRIM(np.code))
     WHERE (
       $1 = '%%'
       OR np.label ILIKE $1
       OR np.code ILIKE $1
     )
     AND (
       $2 = ''
       OR ($2 = '__UNCATEGORIZED__' AND COALESCE(TRIM(nc.category), '') = '')
       OR nc.category = $2
     )
     AND (
       $3 = TRUE
       OR COALESCE(mc.mapping_count, 0) = 0
     )
     ORDER BY np.label
     LIMIT 500`,
    [like, categoryFilter, includeMatchedFilter]
  );
  return rows;
}

export async function listSupplierProducts(client, supplierCode, q = '') {
  const supplierCodes = Array.isArray(supplierCode)
    ? supplierCode.map(normUpper).filter(Boolean)
    : [normUpper(supplierCode || 'DETREMBLEUR')];
  const like = `%${normText(q)}%`;
  const { rows } = await client.query(
    `WITH ranked AS (
       SELECT
         sp.id,
         sp.supplier_id,
         sp.supplier_product_code,
         sp.label,
         sp.label_norm,
         sp.volume_override,
         sp.tva_rate,
         sp.last_unit_price,
         s.code AS supplier_code,
         rp.reference_unit_price,
         ROW_NUMBER() OVER (
           PARTITION BY
             CASE
               WHEN COALESCE(TRIM(sp.supplier_product_code), '') <> ''
                 THEN sp.supplier_id::text || '::' || UPPER(TRIM(sp.supplier_product_code))
               ELSE sp.supplier_id::text || '::__NO_CODE__:' || sp.id::text
             END
           ORDER BY sp.updated_at DESC NULLS LAST, sp.id DESC
         ) AS rn
      FROM supplier_products sp
      JOIN suppliers s ON s.id = sp.supplier_id
       LEFT JOIN supplier_reference_prices rp
         ON rp.supplier_id = sp.supplier_id
        AND rp.supplier_product_code = COALESCE(NULLIF(TRIM(sp.supplier_product_code), ''), '')
      WHERE s.code = ANY($1::text[])
        AND (
          $2 = '%%'
          OR sp.label ILIKE $2
          OR sp.supplier_product_code ILIKE $2
         )
     )
     SELECT
       r.id,
       r.supplier_product_code,
       r.label,
       r.volume_override,
       r.tva_rate,
       r.last_unit_price,
       r.supplier_code,
       r.reference_unit_price,
       COALESCE(ps.purchase_total_qty, 0) AS purchase_total_qty,
       COALESCE(ps.purchase_price_stats, '[]'::json) AS purchase_price_stats,
       ps.dominant_unit_price_htva,
       ps.dominant_unit_price_tvac
     FROM ranked r
     LEFT JOIN LATERAL (
       WITH line_rows AS (
         SELECT
           COALESCE(NULLIF(il.quantity_total, 0), NULLIF(il.quantity_colis, 0))::numeric AS qty_base,
           il.line_total_htva,
           il.net_unit_price,
           il.tva_rate
         FROM invoice_lines il
         JOIN invoices i ON i.id = il.invoice_id
         WHERE i.supplier_id = r.supplier_id
           AND il.line_type = 'PRODUCT'
           AND (
             (
               COALESCE(TRIM(r.supplier_product_code), '') <> ''
               AND COALESCE(NULLIF(TRIM(il.product_code), ''), '') = COALESCE(TRIM(r.supplier_product_code), '')
             )
             OR (
               COALESCE(TRIM(r.supplier_product_code), '') = ''
               AND LOWER(TRIM(il.description)) = r.label_norm
             )
           )
       ),
       price_rows AS (
         SELECT
           ROUND(
             COALESCE(
               CASE
                 WHEN lr.qty_base IS NOT NULL
                  AND lr.qty_base <> 0
                  AND lr.line_total_htva IS NOT NULL
                   THEN lr.line_total_htva / lr.qty_base
                 ELSE NULL
               END,
               lr.net_unit_price
             )::numeric,
             2
           ) AS unit_price_htva,
           ROUND(
             (
               COALESCE(
                 CASE
                   WHEN lr.qty_base IS NOT NULL
                    AND lr.qty_base <> 0
                    AND lr.line_total_htva IS NOT NULL
                     THEN lr.line_total_htva / lr.qty_base
                   ELSE NULL
                 END,
                 lr.net_unit_price
               ) * (
                 1 + COALESCE(NULLIF(REGEXP_REPLACE(COALESCE(lr.tva_rate, ''), '[^0-9\\.]', '', 'g'), '')::numeric, 0) / 100
               )
             )::numeric,
             2
           ) AS unit_price_tvac,
           COALESCE(lr.qty_base, 0)::numeric AS qty
         FROM line_rows lr
       ),
       grouped AS (
         SELECT unit_price_htva, unit_price_tvac, SUM(qty)::numeric AS qty
         FROM price_rows
         WHERE unit_price_htva IS NOT NULL
           AND qty > 0
         GROUP BY unit_price_htva, unit_price_tvac
       )
       SELECT
         COALESCE(SUM(g.qty), 0)::numeric AS purchase_total_qty,
         COALESCE(
           JSON_AGG(
             JSON_BUILD_OBJECT(
               'unit_price_htva', g.unit_price_htva,
               'unit_price_tvac', g.unit_price_tvac,
               'qty', g.qty
             )
             ORDER BY g.qty DESC, g.unit_price_htva
           ),
           '[]'::json
         ) AS purchase_price_stats,
         (SELECT gg.unit_price_htva FROM grouped gg ORDER BY gg.qty DESC, gg.unit_price_htva LIMIT 1) AS dominant_unit_price_htva,
         (SELECT gg.unit_price_tvac FROM grouped gg ORDER BY gg.qty DESC, gg.unit_price_tvac LIMIT 1) AS dominant_unit_price_tvac
       FROM grouped g
     ) ps ON TRUE
     WHERE r.rn = 1
     ORDER BY r.label
     LIMIT 500`,
    [supplierCodes, like]
  );
  return rows.map(r => {
    const package_volume_l = getPackageVolumeLitersFromLabel(r.label, r.volume_override);
    const ref = r.reference_unit_price === null ? null : toNum(r.reference_unit_price);
    return {
      ...r,
      package_volume_l,
      reference_price_per_l: (ref !== null && package_volume_l && package_volume_l > 0) ? ref / package_volume_l : null,
    };
  });
}

export async function listMappingsForNextoreProduct(client, nextoreProductId) {
  const { rows } = await client.query(
    `SELECT
       pm.id,
       pm.mapping_type,
       pm.quantity_value,
       pm.quantity_unit,
       pm.note,
       sp.id AS supplier_product_id,
       sp.supplier_product_code,
       sp.label AS supplier_product_label,
       sp.volume_override,
       sp.tva_rate AS supplier_tva_rate,
       rp.reference_unit_price,
       s.code AS supplier_code,
       np.id AS nextore_product_id,
       np.label AS nextore_product_label
     FROM product_mappings pm
     JOIN nextore_products np ON np.id = pm.nextore_product_id
     JOIN supplier_products sp ON sp.id = pm.supplier_product_id
     JOIN suppliers s ON s.id = sp.supplier_id
     LEFT JOIN supplier_reference_prices rp
       ON rp.supplier_id = s.id
      AND rp.supplier_product_code = COALESCE(NULLIF(TRIM(sp.supplier_product_code), ''), '')
     WHERE pm.nextore_product_id = $1
     ORDER BY pm.mapping_type, s.code, sp.label`,
    [nextoreProductId]
  );
  return rows.map(r => ({
    ...r,
    package_volume_l: getPackageVolumeLitersFromLabel(r.supplier_product_label, r.volume_override),
  }));
}

export async function createProductMapping(client, payload) {
  const mappingType = normUpper(payload.mapping_type);
  if (!['DIRECT', 'RECIPE'].includes(mappingType)) {
    throw new Error('mapping_type doit être DIRECT ou RECIPE');
  }
  const nextoreProductId = Number(payload.nextore_product_id);
  const supplierProductId = Number(payload.supplier_product_id);
  if (!Number.isInteger(nextoreProductId) || !Number.isInteger(supplierProductId)) {
    throw new Error('nextore_product_id et supplier_product_id doivent être des entiers');
  }

  const quantityValue =
    payload.quantity_value === null || payload.quantity_value === undefined || payload.quantity_value === ''
      ? null
      : Number(payload.quantity_value);
  if (quantityValue !== null && !Number.isFinite(quantityValue)) {
    throw new Error('quantity_value invalide');
  }
  const quantityUnit = payload.quantity_unit ? normText(payload.quantity_unit) : null;
  const note = payload.note ? normText(payload.note) : null;

  if (mappingType === 'RECIPE' && (quantityValue === null || !quantityUnit)) {
    throw new Error('Pour RECIPE, quantity_value et quantity_unit sont obligatoires');
  }

  const { rows } = await client.query(
    `INSERT INTO product_mappings (
       nextore_product_id, supplier_product_id, mapping_type,
       quantity_value, quantity_unit, note
     ) VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (nextore_product_id, supplier_product_id, mapping_type, quantity_value, quantity_unit)
     DO NOTHING
     RETURNING id`,
    [
      nextoreProductId,
      supplierProductId,
      mappingType,
      quantityValue,
      quantityUnit,
      note,
    ]
  );
  return rows[0] || null;
}

export async function createProductMappingsBulk(client, mappings) {
  if (!Array.isArray(mappings) || mappings.length === 0) {
    throw new Error('mappings doit être une liste non vide');
  }

  let inserted = 0;
  let skipped = 0;

  try {
    await client.query('BEGIN');
    for (const m of mappings) {
      const row = await createProductMapping(client, m);
      if (row) inserted += 1;
      else skipped += 1;
    }
    await client.query('COMMIT');
    return { inserted, skipped };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  }
}

export async function deleteProductMapping(client, mappingId) {
  const { rowCount } = await client.query(
    `DELETE FROM product_mappings WHERE id = $1`,
    [mappingId]
  );
  return rowCount > 0;
}

export async function listSupplierCommandesWithReference(
  client,
  supplierCode = 'DETREMBLEUR',
  q = '',
  includeReturns = false
) {
  const supplierCodes = Array.isArray(supplierCode)
    ? supplierCode.map(normUpper).filter(Boolean)
    : [normUpper(supplierCode || 'DETREMBLEUR')];
  const like = `%${normText(q)}%`;
  const includeReturnsFlag = Boolean(includeReturns);
  const { rows } = await client.query(
    `SELECT
       il.id AS line_id,
       s.code AS supplier_code,
       i.invoice_date,
       i.invoice_number,
       i.total_a_payer AS invoice_total_tvac,
       il.product_code,
       il.description,
       il.quantity_colis,
       il.quantity_total,
       il.line_total_htva,
       sp.volume_override,
       rp.reference_unit_price
     FROM invoice_lines il
     JOIN invoices i ON i.id = il.invoice_id
     JOIN suppliers s ON s.id = i.supplier_id
     LEFT JOIN supplier_products sp
       ON sp.supplier_id = s.id
      AND sp.supplier_product_code = COALESCE(NULLIF(TRIM(il.product_code), ''), '')
     LEFT JOIN supplier_reference_prices rp
       ON rp.supplier_id = s.id
      AND rp.supplier_product_code = COALESCE(NULLIF(TRIM(il.product_code), ''), '')
     WHERE s.code = ANY($2::text[])
       AND il.line_type = 'PRODUCT'
       AND (
         ($3::boolean = TRUE AND COALESCE(il.quantity_total, il.quantity_colis, 0) <> 0)
         OR ($3::boolean = FALSE AND COALESCE(il.quantity_total, il.quantity_colis, 0) > 0)
       )
       AND (
         $1 = '%%'
         OR il.description ILIKE $1
         OR il.product_code ILIKE $1
         OR i.invoice_number ILIKE $1
       )
     ORDER BY i.invoice_date DESC, i.invoice_number DESC, il.id DESC
     LIMIT 2000`,
    [like, supplierCodes, includeReturnsFlag]
  );

  return rows.map(r => {
    const format = parseDetrembleurFormat(r.description);
    const volume = normText(r.volume_override || format.volume);
    const qty = computeDetrembleurQty(r, format);
    const total = toNum(r.line_total_htva);
    const unitPrice = qty !== 0 ? total / qty : 0;
    const refPrice = r.reference_unit_price === null ? null : toNum(r.reference_unit_price);

    const row2 = round2(unitPrice);
    const ref2 = refPrice === null ? null : round2(refPrice);
    const priceStatus = ref2 === null ? 'NO_REF' : (row2 === ref2 ? 'OK' : 'MISMATCH');

    return {
      line_id: r.line_id,
      supplier_code: normUpper(r.supplier_code || ''),
      invoice_date: fmtIsoDate(r.invoice_date),
      invoice_number: r.invoice_number,
      invoice_total_tvac: toNum(r.invoice_total_tvac),
      product_code: normText(r.product_code),
      product_name: normText(r.description),
      quantity: qty,
      unit_price: unitPrice,
      line_total: total,
      format_achat: format.format_achat,
      quantite_format: format.quantite_format,
      volume,
      reference_unit_price: refPrice,
      price_status: priceStatus,
    };
  });
}

export async function listDetrembleurCommandesWithReference(client, q = '') {
  return listSupplierCommandesWithReference(client, 'DETREMBLEUR', q);
}

export async function upsertSupplierReferencePrice(client, supplierCode, supplierProductCode, referenceUnitPrice) {
  const code = normUpper(supplierCode || 'DETREMBLEUR');
  const prodCode = normText(supplierProductCode);
  const ref = toNum(referenceUnitPrice);
  if (!prodCode) throw new Error('supplier_product_code manquant');
  if (!(ref > 0)) throw new Error('reference_unit_price invalide');

  const { rows: sup } = await client.query(
    `SELECT id FROM suppliers WHERE code = $1`,
    [code]
  );
  if (sup.length === 0) throw new Error(`Fournisseur inconnu: ${code}`);
  const supplierId = sup[0].id;

  const { rows } = await client.query(
    `INSERT INTO supplier_reference_prices (supplier_id, supplier_product_code, reference_unit_price, updated_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (supplier_id, supplier_product_code)
     DO UPDATE SET
       reference_unit_price = EXCLUDED.reference_unit_price,
       updated_at = NOW()
     RETURNING id, reference_unit_price`,
    [supplierId, prodCode, ref]
  );
  return rows[0];
}

export async function listSupplierArticlesSummaryWithReference(
  client,
  supplierCode = 'DETREMBLEUR',
  q = '',
  includeReturns = false
) {
  const rows = await listSupplierCommandesWithReference(client, supplierCode, q, includeReturns);
  const byCode = new Map();

  for (const r of rows) {
    const key = `${normUpper(r.supplier_code || '')}::${r.product_code || `NO_CODE__${r.product_name}`}`;
    if (!byCode.has(key)) {
      byCode.set(key, {
        supplier_code: normUpper(r.supplier_code || ''),
        product_code: r.product_code || '',
        product_name: r.product_name || '',
        format_achat: r.format_achat || '',
        quantite_format: Number(r.quantite_format || 0),
        volume: r.volume || '',
        reference_unit_price: r.reference_unit_price === null ? null : Number(r.reference_unit_price),
        quantity_total_commanded: 0,
        total_htva: 0,
        weighted_sum_unit_price: 0,
      });
    }

    const agg = byCode.get(key);
    const qty = Number(r.quantity || 0);
    const unit = Number(r.unit_price || 0);
    const lineTotal = Number(r.line_total || 0);

    agg.quantity_total_commanded += qty;
    agg.total_htva += lineTotal;
    agg.weighted_sum_unit_price += unit * qty;

    if ((agg.reference_unit_price === null || agg.reference_unit_price === undefined)
        && r.reference_unit_price !== null && r.reference_unit_price !== undefined) {
      agg.reference_unit_price = Number(r.reference_unit_price);
    }
  }

  const out = [...byCode.values()].map(r => {
    const avg = r.quantity_total_commanded > 0
      ? r.weighted_sum_unit_price / r.quantity_total_commanded
      : 0;
    return {
      supplier_code: r.supplier_code,
      product_code: r.product_code,
      product_name: r.product_name,
      format_achat: r.format_achat,
      quantite_format: r.quantite_format,
      volume: r.volume,
      reference_unit_price: r.reference_unit_price,
      quantity_total_commanded: r.quantity_total_commanded,
      avg_unit_price: avg,
      total_htva: r.total_htva,
    };
  });

  out.sort((a, b) => a.product_name.localeCompare(b.product_name, 'fr'));
  return out;
}

export async function listDetrembleurArticlesSummaryWithReference(client, q = '') {
  return listSupplierArticlesSummaryWithReference(client, 'DETREMBLEUR', q);
}

export async function listInvoicesForSuppliers(client, supplierCode = 'DETREMBLEUR') {
  const supplierCodes = Array.isArray(supplierCode)
    ? supplierCode.map(normUpper).filter(Boolean)
    : [normUpper(supplierCode || 'DETREMBLEUR')];
  const { rows } = await client.query(
    `SELECT
       i.id,
       s.code AS supplier_code,
       s.name AS supplier_name,
       i.invoice_number,
       i.invoice_date,
       i.total_a_payer,
       i.source_file
     FROM invoices i
     JOIN suppliers s ON s.id = i.supplier_id
     WHERE s.code = ANY($1::text[])
     ORDER BY i.invoice_date DESC NULLS LAST, i.id DESC`,
    [supplierCodes]
  );
  const invoiceRows = rows.map(r => ({
    id: Number(r.id),
    supplier_code: r.supplier_code,
    supplier_name: r.supplier_name,
    invoice_number: normText(r.invoice_number),
    invoice_date: fmtIsoDate(r.invoice_date),
    total_a_payer: r.total_a_payer === null ? null : Number(r.total_a_payer),
    source_file: r.source_file || null,
    source_file_name: r.source_file ? normText(String(r.source_file).split(/[\\/]/).pop()) : null,
  }));

  if (!supplierCodes.includes('NOWJOBS')) {
    return invoiceRows;
  }

  const { entries: nowjobsEntries, assignById } = await buildNowjobsAssignments(client);
  const pseudo = nowjobsEntries.map(e => ({
    id: e.id,
    supplier_code: 'NOWJOBS',
    supplier_name: 'Nowjobs',
    invoice_number: e.invoice_number,
    invoice_date: e.invoice_date,
    total_a_payer: e.total_a_payer,
    source_file: e.source_file,
    source_file_name: e.source_file_name,
    matched_total: assignById.get(e.id)?.assigned_total ?? 0,
    matched_days: (assignById.get(e.id)?.dates || []).length,
  }));

  return [...invoiceRows, ...pseudo].sort((a, b) => {
    const ad = String(a.invoice_date || '');
    const bd = String(b.invoice_date || '');
    if (ad !== bd) return bd.localeCompare(ad);
    return Number(b.id || 0) - Number(a.id || 0);
  });
}

export async function getInvoiceDetails(client, invoiceId) {
  const id = Number(invoiceId);
  if (!Number.isInteger(id)) throw new Error('invoice_id invalide');

  if (id < 0) {
    const { entries: nowjobsEntries, assignById } = await buildNowjobsAssignments(client);
    const match = nowjobsEntries.find(x => x.id === id);
    if (!match) return null;
    const periodMonth = match.period_month;
    const selectedDates = assignById.get(id)?.dates || [];
    const { rows } = await client.query(
      `SELECT
         id,
         shift_date,
         iso_week,
         day_name,
         employee_name,
         start_time,
         end_time,
         break_minutes,
         prestation_num,
         duration_h,
         daily_hours,
         total_employees,
         daily_cost,
         cost_prorata,
         hourly_rate,
         statut
       FROM nowjobs_prestations
       WHERE to_char(shift_date, 'YYYY-MM') = $1
         AND ($2::text[] IS NULL OR to_char(shift_date, 'YYYY-MM-DD') = ANY($2::text[]))
       ORDER BY shift_date ASC, id ASC`,
      [periodMonth, selectedDates.length ? selectedDates : null]
    );
    if (rows.length === 0) {
      const sourceFile = match.source_file || null;
      return {
        id,
        supplier_code: 'NOWJOBS',
        supplier_name: 'Nowjobs',
        invoice_number: match.invoice_number,
        invoice_date: `${periodMonth}-01`,
        total_a_payer: match.total_a_payer ?? 0,
        vidanges_livrees: 0,
        vidanges_reprises: 0,
        source_file: sourceFile,
        source_file_name: sourceFile ? normText(String(sourceFile).split(/[\\/]/).pop()) : null,
        lines: [
          {
            id: -((Math.abs(id) * 10000) + 1),
            line_order: 1,
            product_code: '',
            description: 'Aucune prestation appariée automatiquement pour cette facture NOWJOBS.',
            quantity_colis: 0,
            quantity_total: 0,
            unit_price: 0,
            net_unit_price: 0,
            line_total_htva: 0,
            vid_unit: 0,
            vid_total: 0,
            tva_rate: '0%',
            tva_pct: 0,
            line_type: 'PRESTATION',
            tva_amount: 0,
            line_total_tvac: 0,
            line_impact_total: 0,
          },
        ],
      };
    }
    const lines = rows.map((r, idx) => {
      const ht = r.cost_prorata === null ? 0 : Number(r.cost_prorata);
      const qty = r.duration_h === null ? 0 : Number(r.duration_h);
      const pu = (qty > 0 && Number.isFinite(ht)) ? round2(ht / qty) : (r.hourly_rate === null ? null : Number(r.hourly_rate));
      const label = `${normText(r.employee_name)} | ${normText(r.day_name)} ${fmtIsoDate(r.shift_date)} ${normText(r.start_time)}-${normText(r.end_time)} | ${normText(r.statut)}`;
      return {
        id: -((Math.abs(id) * 10000) + idx + 1),
        line_order: idx + 1,
        product_code: normText(r.iso_week || ''),
        description: label,
        quantity_colis: qty,
        quantity_total: qty,
        unit_price: pu,
        net_unit_price: pu,
        line_total_htva: round2(ht),
        vid_unit: 0,
        vid_total: 0,
        tva_rate: '0%',
        tva_pct: 0,
        line_type: 'PRESTATION',
        tva_amount: 0,
        line_total_tvac: round2(ht),
        line_impact_total: round2(ht),
      };
    });
    const total = round2(lines.reduce((s, l) => s + (Number(l.line_total_htva) || 0), 0));
    const sourceFile = match.source_file || null;
    return {
      id,
      supplier_code: 'NOWJOBS',
      supplier_name: 'Nowjobs',
      invoice_number: match.invoice_number,
      invoice_date: `${periodMonth}-01`,
      total_a_payer: match.total_a_payer ?? total,
      vidanges_livrees: 0,
      vidanges_reprises: 0,
      source_file: sourceFile,
      source_file_name: sourceFile ? normText(String(sourceFile).split(/[\\/]/).pop()) : null,
      lines,
    };
  }

  const { rows: invRows } = await client.query(
    `SELECT
       i.id,
       s.code AS supplier_code,
       s.name AS supplier_name,
       i.invoice_number,
       i.invoice_date,
       i.total_a_payer,
       i.vidanges_livrees,
       i.vidanges_reprises,
       i.source_file
     FROM invoices i
     JOIN suppliers s ON s.id = i.supplier_id
     WHERE i.id = $1`,
    [id]
  );
  if (invRows.length === 0) return null;
  const inv = invRows[0];

  const { rows: lineRows } = await client.query(
    `SELECT
       il.id,
       il.line_order,
       il.product_code,
       il.description,
       il.quantity_colis,
       il.quantity_total,
       il.unit_price,
       il.net_unit_price,
       il.line_total_htva,
       il.vid_unit,
       il.vid_total,
       il.tva_rate,
       il.line_type
     FROM invoice_lines il
     WHERE il.invoice_id = $1
     ORDER BY il.line_order NULLS LAST, il.id`,
    [id]
  );

  let lines = lineRows.map(r => {
    const tvaRaw = normText(r.tva_rate || '');
    const tvaPct = (() => {
      const m = tvaRaw.match(/[\d.,]+/);
      if (!m) return 0;
      const n = Number(m[0].replace(',', '.'));
      return Number.isFinite(n) ? n : 0;
    })();
    const ht = r.line_total_htva === null ? 0 : Number(r.line_total_htva);
    const vidTotal = r.vid_total === null ? 0 : Number(r.vid_total);
    const tvaAmount = ht * (tvaPct / 100);
    return {
      id: Number(r.id),
      line_order: r.line_order === null ? null : Number(r.line_order),
      product_code: normText(r.product_code),
      description: normText(r.description),
      quantity_colis: r.quantity_colis === null ? null : Number(r.quantity_colis),
      quantity_total: r.quantity_total === null ? null : Number(r.quantity_total),
      unit_price: r.unit_price === null ? null : Number(r.unit_price),
      net_unit_price: r.net_unit_price === null ? null : Number(r.net_unit_price),
      line_total_htva: r.line_total_htva === null ? null : Number(r.line_total_htva),
      vid_unit: r.vid_unit === null ? null : Number(r.vid_unit),
      vid_total: r.vid_total === null ? null : Number(r.vid_total),
      tva_rate: tvaRaw,
      tva_pct: tvaPct,
      line_type: normUpper(r.line_type || 'PRODUCT'),
      tva_amount: round2(tvaAmount),
      line_total_tvac: round2(ht + tvaAmount),
      line_impact_total: round2(ht + tvaAmount + vidTotal),
    };
  });

  // Fallback for suppliers where line-level VAT may be unreliable after OCR:
  // keep line HT as-is, then redistribute invoice-level TVA so summed lines
  // match the header total exactly.
  const invoiceTotal = inv.total_a_payer === null ? null : Number(inv.total_a_payer);
  if (invoiceTotal !== null && Number.isFinite(invoiceTotal)) {
    const baseWithoutTva = lines.reduce(
      (s, l) => s + (Number(l.line_total_htva) || 0) + (Number(l.vid_total) || 0),
      0
    );
    const currentWithTva = lines.reduce((s, l) => s + (Number(l.line_impact_total) || 0), 0);
    const gap = round2(invoiceTotal - currentWithTva);
    const needsRebalance = Math.abs(gap) > 0.01 && Math.abs(invoiceTotal - baseWithoutTva) > 0.01;

    if (needsRebalance) {
      const totalTvaToAllocate = round2(invoiceTotal - baseWithoutTva);
      const eligible = lines
        .map((l, idx) => ({ idx, ht: Number(l.line_total_htva) || 0 }))
        .filter(x => x.ht > 0);
      const totalHt = eligible.reduce((s, x) => s + x.ht, 0);

      if (eligible.length > 0 && totalHt > 0) {
        let allocated = 0;
        const byIndex = new Map();
        for (let i = 0; i < eligible.length; i += 1) {
          const e = eligible[i];
          let tva = 0;
          if (i < eligible.length - 1) {
            tva = round2((e.ht / totalHt) * totalTvaToAllocate);
            allocated += tva;
          } else {
            tva = round2(totalTvaToAllocate - allocated);
          }
          const pct = e.ht > 0 ? (tva / e.ht) * 100 : 0;
          byIndex.set(e.idx, { tva, pct });
        }

        lines = lines.map((l, idx) => {
          const reb = byIndex.get(idx);
          const tvaAmount = reb ? reb.tva : 0;
          const tvaPct = reb ? reb.pct : 0;
          const ht = Number(l.line_total_htva) || 0;
          const vid = Number(l.vid_total) || 0;
          return {
            ...l,
            tva_pct: round2(tvaPct),
            tva_amount: round2(tvaAmount),
            line_total_tvac: round2(ht + tvaAmount),
            line_impact_total: round2(ht + tvaAmount + vid),
          };
        });
      }
    }
  }

  return {
    id: Number(inv.id),
    supplier_code: inv.supplier_code,
    supplier_name: inv.supplier_name,
    invoice_number: normText(inv.invoice_number),
    invoice_date: fmtIsoDate(inv.invoice_date),
    total_a_payer: inv.total_a_payer === null ? null : Number(inv.total_a_payer),
    vidanges_livrees: inv.vidanges_livrees === null ? null : Number(inv.vidanges_livrees),
    vidanges_reprises: inv.vidanges_reprises === null ? null : Number(inv.vidanges_reprises),
    source_file: inv.source_file || null,
    source_file_name: inv.source_file ? normText(String(inv.source_file).split(/[\\/]/).pop()) : null,
    lines,
  };
}

export async function listNowjobsPrestations(client, q = '') {
  const like = `%${normText(q)}%`;
  const { rows } = await client.query(
    `SELECT
       id,
       to_char(shift_date, 'YYYY-MM-DD') AS shift_date_iso,
       iso_week,
       day_name,
       employee_name,
       start_time,
       end_time,
       break_minutes,
       prestation_num,
       duration_h,
       daily_hours,
       total_employees,
       daily_cost,
       cost_prorata,
       hourly_rate,
       statut,
       imported_at
     FROM nowjobs_prestations
     WHERE
       $1 = '%%'
       OR employee_name ILIKE $1
       OR iso_week ILIKE $1
       OR day_name ILIKE $1
       OR statut ILIKE $1
     ORDER BY shift_date DESC, id DESC
     LIMIT 5000`,
    [like]
  );

  return rows.map(r => ({
    id: Number(r.id),
    shift_date: normText(r.shift_date_iso),
    iso_week: normText(r.iso_week),
    day_name: normText(r.day_name),
    employee_name: normText(r.employee_name),
    start_time: normText(r.start_time),
    end_time: normText(r.end_time),
    break_minutes: r.break_minutes === null ? null : Number(r.break_minutes),
    prestation_num: r.prestation_num === null ? null : Number(r.prestation_num),
    duration_h: r.duration_h === null ? null : Number(r.duration_h),
    daily_hours: r.daily_hours === null ? null : Number(r.daily_hours),
    total_employees: r.total_employees === null ? null : Number(r.total_employees),
    daily_cost: r.daily_cost === null ? null : Number(r.daily_cost),
    cost_prorata: r.cost_prorata === null ? null : Number(r.cost_prorata),
    hourly_rate: r.hourly_rate === null ? null : Number(r.hourly_rate),
    statut: normText(r.statut),
    imported_at: r.imported_at ? new Date(r.imported_at).toISOString() : null,
  }));
}

export async function listNextoreCostOverview(client) {
  const nextore = await listNextoreProducts(client, '', '', true);
  const { rows: mapRows } = await client.query(
    `SELECT
       pm.id,
       pm.nextore_product_id,
       pm.mapping_type,
       pm.quantity_value,
       pm.quantity_unit,
       sp.label AS supplier_product_label,
       sp.tva_rate AS supplier_tva_rate,
       rp.reference_unit_price,
       sp.volume_override
     FROM product_mappings pm
     JOIN supplier_products sp ON sp.id = pm.supplier_product_id
     LEFT JOIN supplier_reference_prices rp
       ON rp.supplier_id = sp.supplier_id
      AND rp.supplier_product_code = sp.supplier_product_code
     ORDER BY pm.nextore_product_id, pm.mapping_type, pm.id`
  );

  const mapsByNextore = new Map();
  for (const r of mapRows) {
    const key = Number(r.nextore_product_id);
    if (!mapsByNextore.has(key)) mapsByNextore.set(key, []);
    mapsByNextore.get(key).push(r);
  }

  const rows = nextore.map(n => {
    const mappings = mapsByNextore.get(Number(n.id)) || [];
    const recipes = mappings.filter(m => normUpper(m.mapping_type) === 'RECIPE');
    const directs = mappings.filter(m => normUpper(m.mapping_type) === 'DIRECT');
    const use = recipes.length > 0 ? recipes : directs.slice(0, 1);
    const mappingMode = recipes.length > 0 ? 'RECIPE' : (directs.length > 0 ? 'DIRECT' : 'NONE');
    const nextoreQtyCl = parseVolumeClFromText(n.label);

    const ingredients = use.map(m => {
      const ref = m.reference_unit_price === null ? null : Number(m.reference_unit_price);
      const tvaPct = parseTvaPctAny(m.supplier_tva_rate);
      const volL = getPackageVolumeLitersFromLabel(m.supplier_product_label, m.volume_override);
      const priceClHtva = (ref !== null && volL && volL > 0) ? ref / (volL * 100) : null;

      let qtyCl = null;
      let totalHt = null;
      if (recipes.length > 0) {
        qtyCl = toCl(m.quantity_value, m.quantity_unit);
        if (qtyCl !== null && priceClHtva !== null) totalHt = qtyCl * priceClHtva;
      } else {
        qtyCl = nextoreQtyCl;
        if (qtyCl !== null && priceClHtva !== null) totalHt = qtyCl * priceClHtva;
        if (totalHt === null && ref !== null) totalHt = ref;
      }

      const totalTvac = totalHt === null ? null : totalHt * (1 + tvaPct / 100);
      return {
        name: normText(m.supplier_product_label),
        qty_cl: qtyCl,
        purchase_price_cl_htva: priceClHtva,
        total_htva: totalHt,
        total_tvac: totalTvac,
      };
    });

    const ingredientsTotalHtva = round2(ingredients.reduce((s, i) => s + (i.total_htva || 0), 0));
    const ingredientsTotalTvac = round2(ingredients.reduce((s, i) => s + (i.total_tvac || 0), 0));
    const sellHt = n.dominant_unit_price_htva === null ? null : Number(n.dominant_unit_price_htva);
    const sellTv = n.dominant_unit_price_tvac === null ? null : Number(n.dominant_unit_price_tvac);
    const coef = (sellHt && ingredientsTotalHtva > 0) ? (sellHt / ingredientsTotalHtva) : null;

    return {
      nextore_product_id: Number(n.id),
      category: normText(n.category || ''),
      label: normText(n.label),
      qty_cl: nextoreQtyCl,
      mapping_mode: mappingMode,
      ingredient_count: recipes.length > 0 ? recipes.length : (directs.length > 0 ? 1 : 0),
      sell_price_htva: sellHt,
      sell_price_tvac: sellTv,
      ingredients_total_htva: ingredientsTotalHtva,
      ingredients_total_tvac: ingredientsTotalTvac,
      coef_vente_achat: coef === null ? null : round2(coef),
      ingredients,
    };
  });

  rows.sort((a, b) => a.category.localeCompare(b.category, 'fr') || a.label.localeCompare(b.label, 'fr'));
  return rows;
}

function normKeyLabel(s) {
  return normText(s).toLowerCase();
}

function purchaseKey(supplierCode, productCode, productName) {
  const sup = normUpper(supplierCode);
  const code = normText(productCode);
  if (code) return `${sup}::CODE::${code}`;
  return `${sup}::LABEL::${normKeyLabel(productName)}`;
}

function computeRecipeConsumedUnits(quantityValue, quantityUnit, supplierLabel, volumeOverride) {
  const unit = normText(quantityUnit).toLowerCase();
  const q = toNum(quantityValue);
  if (!(q > 0)) return 0;
  if (unit === 'piece') return q;
  const qtyCl = toCl(q, unit);
  if (!(qtyCl > 0)) return 0;
  const packageL = getPackageVolumeLitersFromLabel(supplierLabel, volumeOverride);
  if (!(packageL > 0)) return 0;
  return (qtyCl / 100) / packageL;
}

export async function listInventoryOverview(client, supplierCode = 'DETREMBLEUR') {
  const supplierCodes = Array.isArray(supplierCode)
    ? supplierCode.map(normUpper).filter(Boolean)
    : [normUpper(supplierCode || 'DETREMBLEUR')];

  const [purchaseRows, nextoreRows, mapRes] = await Promise.all([
    listSupplierCommandesWithReference(client, supplierCodes, '', true),
    listNextoreProducts(client, '', '', true),
    client.query(
      `SELECT
         pm.id,
         pm.nextore_product_id,
         pm.mapping_type,
         pm.quantity_value,
         pm.quantity_unit,
         sp.supplier_product_code,
         sp.label AS supplier_product_label,
         sp.volume_override,
         s.code AS supplier_code
       FROM product_mappings pm
       JOIN supplier_products sp ON sp.id = pm.supplier_product_id
       JOIN suppliers s ON s.id = sp.supplier_id
       WHERE s.code = ANY($1::text[])
       ORDER BY pm.nextore_product_id, pm.id`,
      [supplierCodes]
    ),
  ]);

  const purchasesByKey = new Map();
  for (const r of purchaseRows) {
    const key = purchaseKey(r.supplier_code, r.product_code, r.product_name);
    if (!purchasesByKey.has(key)) {
      purchasesByKey.set(key, {
        supplier_code: normUpper(r.supplier_code),
        supplier_product_code: normText(r.product_code),
        supplier_product_label: normText(r.product_name),
        quantity_purchased: 0,
        total_purchase_htva: 0,
        avg_purchase_unit_htva: 0,
        format_achat: normText(r.format_achat),
        quantite_format: toNum(r.quantite_format),
        volume: normText(r.volume),
      });
    }
    const agg = purchasesByKey.get(key);
    agg.quantity_purchased += toNum(r.quantity);
    agg.total_purchase_htva += toNum(r.line_total);
  }
  for (const agg of purchasesByKey.values()) {
    agg.avg_purchase_unit_htva = agg.quantity_purchased > 0
      ? (agg.total_purchase_htva / agg.quantity_purchased)
      : 0;
    agg.quantity_purchased = round2(agg.quantity_purchased);
    agg.total_purchase_htva = round2(agg.total_purchase_htva);
    agg.avg_purchase_unit_htva = round2(agg.avg_purchase_unit_htva);
  }

  const nextoreById = new Map(nextoreRows.map(r => [Number(r.id), r]));

  const directRows = [];
  const directSeen = new Set();
  for (const m of mapRes.rows) {
    if (normUpper(m.mapping_type) !== 'DIRECT') continue;
    const sale = nextoreById.get(Number(m.nextore_product_id));
    if (!sale) continue;
    const key = purchaseKey(m.supplier_code, m.supplier_product_code, m.supplier_product_label);
    const purchase = purchasesByKey.get(key) || {
      supplier_code: normUpper(m.supplier_code),
      supplier_product_code: normText(m.supplier_product_code),
      supplier_product_label: normText(m.supplier_product_label),
      quantity_purchased: 0,
      total_purchase_htva: 0,
      avg_purchase_unit_htva: 0,
      format_achat: '',
      quantite_format: 0,
      volume: normText(m.volume_override),
    };
    const dedupeKey = `${key}::NEXTORE::${sale.id}`;
    if (directSeen.has(dedupeKey)) continue;
    directSeen.add(dedupeKey);
    const soldQty = toNum(sale.selling_total_qty);
    directRows.push({
      supplier_code: purchase.supplier_code,
      supplier_product_code: purchase.supplier_product_code,
      supplier_product_label: purchase.supplier_product_label,
      quantity_purchased: round2(purchase.quantity_purchased),
      total_purchase_htva: round2(purchase.total_purchase_htva),
      avg_purchase_unit_htva: round2(purchase.avg_purchase_unit_htva),
      format_achat: purchase.format_achat,
      quantite_format: purchase.quantite_format,
      volume: purchase.volume || normText(m.volume_override),
      nextore_ref: normText(sale.code || ''),
      nextore_label: normText(sale.label || ''),
      quantity_sold: round2(soldQty),
      sell_price_htva: sale.dominant_unit_price_htva === null ? null : round2(sale.dominant_unit_price_htva),
      sell_price_tvac: sale.dominant_unit_price_tvac === null ? null : round2(sale.dominant_unit_price_tvac),
      quantity_stock: round2(toNum(purchase.quantity_purchased) - soldQty),
    });
  }

  directRows.sort((a, b) =>
    a.supplier_code.localeCompare(b.supplier_code, 'fr')
    || a.supplier_product_label.localeCompare(b.supplier_product_label, 'fr')
    || a.nextore_label.localeCompare(b.nextore_label, 'fr')
  );

  const combinedByPurchase = new Map();
  for (const m of mapRes.rows) {
    if (normUpper(m.mapping_type) !== 'RECIPE') continue;
    const sale = nextoreById.get(Number(m.nextore_product_id));
    if (!sale) continue;
    const pKey = purchaseKey(m.supplier_code, m.supplier_product_code, m.supplier_product_label);
    const purchase = purchasesByKey.get(pKey) || {
      supplier_code: normUpper(m.supplier_code),
      supplier_product_code: normText(m.supplier_product_code),
      supplier_product_label: normText(m.supplier_product_label),
      quantity_purchased: 0,
      total_purchase_htva: 0,
      avg_purchase_unit_htva: 0,
      format_achat: '',
      quantite_format: 0,
      volume: normText(m.volume_override),
    };
    if (!combinedByPurchase.has(pKey)) {
      combinedByPurchase.set(pKey, {
        supplier_code: purchase.supplier_code,
        supplier_product_code: purchase.supplier_product_code,
        supplier_product_label: purchase.supplier_product_label,
        quantity_purchased: round2(purchase.quantity_purchased),
        total_purchase_htva: round2(purchase.total_purchase_htva),
        avg_purchase_unit_htva: round2(purchase.avg_purchase_unit_htva),
        format_achat: purchase.format_achat,
        quantite_format: purchase.quantite_format,
        volume: purchase.volume || normText(m.volume_override),
        quantity_consumed: 0,
        quantity_stock: 0,
        usages: [],
      });
    }
    const parent = combinedByPurchase.get(pKey);
    const soldQty = toNum(sale.selling_total_qty);
    const perSaleConsumedUnits = computeRecipeConsumedUnits(
      m.quantity_value,
      m.quantity_unit,
      m.supplier_product_label,
      m.volume_override
    );
    const consumedQty = soldQty * perSaleConsumedUnits;
    parent.quantity_consumed += consumedQty;
    parent.usages.push({
      nextore_ref: normText(sale.code || ''),
      nextore_label: normText(sale.label || ''),
      quantity_sold: round2(soldQty),
      recipe_qty_value: m.quantity_value === null ? null : toNum(m.quantity_value),
      recipe_qty_unit: normText(m.quantity_unit),
      consumed_units: round2(consumedQty),
      sell_price_htva: sale.dominant_unit_price_htva === null ? null : round2(sale.dominant_unit_price_htva),
      sell_price_tvac: sale.dominant_unit_price_tvac === null ? null : round2(sale.dominant_unit_price_tvac),
    });
  }

  const combinedRows = [...combinedByPurchase.values()].map(r => ({
    ...r,
    quantity_consumed: round2(r.quantity_consumed),
    quantity_stock: round2(toNum(r.quantity_purchased) - toNum(r.quantity_consumed)),
    usages: r.usages.sort((a, b) => a.nextore_label.localeCompare(b.nextore_label, 'fr')),
  }));

  combinedRows.sort((a, b) =>
    a.supplier_code.localeCompare(b.supplier_code, 'fr')
    || a.supplier_product_label.localeCompare(b.supplier_product_label, 'fr')
  );

  return {
    direct_rows: directRows,
    combined_rows: combinedRows,
  };
}

export async function listInventoryPurchaseLines(
  client,
  supplierCode,
  supplierProductCode = '',
  supplierProductLabel = ''
) {
  const supplierCodes = Array.isArray(supplierCode)
    ? supplierCode.map(normUpper).filter(Boolean)
    : [normUpper(supplierCode || 'DETREMBLEUR')];
  const rows = await listSupplierCommandesWithReference(client, supplierCodes, '', true);
  const code = normText(supplierProductCode);
  const labelNorm = normKeyLabel(supplierProductLabel);

  const filtered = rows.filter(r => {
    if (!supplierCodes.includes(normUpper(r.supplier_code))) return false;
    const rowCode = normText(r.product_code);
    if (code) return rowCode === code;
    return normKeyLabel(r.product_name) === labelNorm;
  });

  return filtered.map(r => ({
    supplier_code: r.supplier_code,
    invoice_date: r.invoice_date,
    invoice_number: r.invoice_number,
    product_code: r.product_code,
    product_name: r.product_name,
    quantity: round2(toNum(r.quantity)),
    unit_price_htva: round2(toNum(r.unit_price)),
    total_htva: round2(toNum(r.line_total)),
    format_achat: r.format_achat,
    quantite_format: r.quantite_format,
    volume: r.volume,
  }));
}

async function buildConsumedSalesByPurchaseKey(client, supplierCodes) {
  const [npRes, mapRes, salesRes] = await Promise.all([
    client.query(
      `SELECT id, UPPER(TRIM(code)) AS code_norm, label
       FROM nextore_products
       WHERE code IS NOT NULL
         AND TRIM(code) <> ''`
    ),
    client.query(
      `SELECT
         pm.nextore_product_id,
         pm.mapping_type,
         pm.quantity_value,
         pm.quantity_unit,
         sp.supplier_product_code,
         sp.label AS supplier_product_label,
         sp.volume_override,
         s.code AS supplier_code
       FROM product_mappings pm
       JOIN supplier_products sp ON sp.id = pm.supplier_product_id
       JOIN suppliers s ON s.id = sp.supplier_id
       WHERE s.code = ANY($1::text[])`,
      [supplierCodes]
    ),
    client.query(
      `SELECT sale_date, article_name, quantity
       FROM nextore_sales
       WHERE is_bar = TRUE
         AND sale_date IS NOT NULL
         AND article_name IS NOT NULL
         AND TRIM(article_name) <> ''`
    ),
  ]);

  const nextoreByCode = new Map(npRes.rows.map(r => [String(r.code_norm || ''), { id: Number(r.id), label: normText(r.label) }]));
  const mappingsByNextore = new Map();
  for (const m of mapRes.rows) {
    const key = Number(m.nextore_product_id);
    if (!mappingsByNextore.has(key)) mappingsByNextore.set(key, []);
    mappingsByNextore.get(key).push(m);
  }

  const byKey = new Map();
  for (const s of salesRes.rows) {
    const codeNorm = normUpper(s.article_name || '');
    const nextore = nextoreByCode.get(codeNorm);
    if (!nextore) continue;
    const mappings = mappingsByNextore.get(nextore.id) || [];
    const saleQty = toNum(s.quantity);
    if (!(saleQty > 0)) continue;
    const saleDate = fmtIsoDate(s.sale_date);

    for (const m of mappings) {
      const pKey = purchaseKey(m.supplier_code, m.supplier_product_code, m.supplier_product_label);
      const consumed = normUpper(m.mapping_type) === 'DIRECT'
        ? saleQty
        : (saleQty * computeRecipeConsumedUnits(
          m.quantity_value,
          m.quantity_unit,
          m.supplier_product_label,
          m.volume_override
        ));
      if (!(consumed > 0)) continue;

      if (!byKey.has(pKey)) byKey.set(pKey, { total: 0, details: new Map() });
      const agg = byKey.get(pKey);
      agg.total += consumed;
      const dKey = `${saleDate}::${nextore.label}`;
      agg.details.set(dKey, {
        sale_date: saleDate,
        nextore_label: nextore.label,
        consumed_quantity: round2((agg.details.get(dKey)?.consumed_quantity || 0) + consumed),
      });
    }
  }

  return byKey;
}

export async function listInventorySalesLines(
  client,
  supplierCode,
  supplierProductCode = '',
  supplierProductLabel = ''
) {
  const supplierCodes = Array.isArray(supplierCode)
    ? supplierCode.map(normUpper).filter(Boolean)
    : [normUpper(supplierCode || 'DETREMBLEUR')];
  const code = normText(supplierProductCode);
  const labelNorm = normKeyLabel(supplierProductLabel);
  const byKey = await buildConsumedSalesByPurchaseKey(client, supplierCodes);
  const key = purchaseKey(supplierCodes[0] || '', code, supplierProductLabel);

  // If no product code, fallback to label match across selected suppliers.
  let details = [];
  if (code) {
    details = [...(byKey.get(key)?.details?.values() || [])];
  } else {
    for (const [k, v] of byKey.entries()) {
      if (!k.includes('::LABEL::')) continue;
      if (k.endsWith(`::LABEL::${labelNorm}`)) {
        details.push(...v.details.values());
      }
    }
  }
  details.sort((a, b) => a.sale_date.localeCompare(b.sale_date) || a.nextore_label.localeCompare(b.nextore_label, 'fr'));
  return details;
}

export async function listInventoryCountHistory(
  client,
  supplierCode,
  supplierProductCode = '',
  supplierProductLabel = ''
) {
  const code = normUpper(supplierCode || '');
  const prodCode = normText(supplierProductCode);
  const labelNorm = normKeyLabel(supplierProductLabel);
  const { rows } = await client.query(
    `SELECT
       to_char(ic.counted_on, 'YYYY-MM-DD') AS counted_on,
       ic.theoretical_quantity,
       ic.physical_quantity,
       ic.difference_quantity,
       ic.avg_purchase_unit_htva,
       ic.difference_cost_htva,
       ic.note,
       ic.created_at
     FROM inventory_counts ic
     JOIN suppliers s ON s.id = ic.supplier_id
     WHERE s.code = $1
       AND (
         ($2 <> '' AND ic.supplier_product_code = $2)
         OR ($2 = '' AND ic.product_label_norm = $3)
       )
     ORDER BY ic.counted_on DESC, ic.created_at DESC`,
    [code, prodCode, labelNorm]
  );
  return rows.map(r => ({
    counted_on: r.counted_on,
    theoretical_quantity: round2(toNum(r.theoretical_quantity)),
    physical_quantity: round2(toNum(r.physical_quantity)),
    difference_quantity: round2(toNum(r.difference_quantity)),
    avg_purchase_unit_htva: round2(toNum(r.avg_purchase_unit_htva)),
    difference_cost_htva: round2(toNum(r.difference_cost_htva)),
    note: normText(r.note),
  }));
}

export async function listInventoryControlRows(client, supplierCode = 'DETREMBLEUR') {
  const supplierCodes = Array.isArray(supplierCode)
    ? supplierCode.map(normUpper).filter(Boolean)
    : [normUpper(supplierCode || 'DETREMBLEUR')];

  const [purchases, consumedByKey, latestCountsRes] = await Promise.all([
    listSupplierArticlesSummaryWithReference(client, supplierCodes, '', true),
    buildConsumedSalesByPurchaseKey(client, supplierCodes),
    client.query(
      `SELECT DISTINCT ON (ic.supplier_id, ic.supplier_product_code, ic.product_label_norm)
         s.code AS supplier_code,
         ic.supplier_product_code,
         ic.product_label_norm,
         ic.counted_on,
         ic.theoretical_quantity,
         ic.physical_quantity,
         ic.difference_quantity,
         ic.avg_purchase_unit_htva,
         ic.difference_cost_htva
       FROM inventory_counts ic
       JOIN suppliers s ON s.id = ic.supplier_id
       WHERE s.code = ANY($1::text[])
       ORDER BY ic.supplier_id, ic.supplier_product_code, ic.product_label_norm, ic.counted_on DESC, ic.updated_at DESC, ic.id DESC`,
      [supplierCodes]
    ),
  ]);

  const countByKey = new Map();
  for (const r of latestCountsRes.rows) {
    const k = purchaseKey(r.supplier_code, r.supplier_product_code, r.product_label_norm);
    countByKey.set(k, r);
  }

  const rows = purchases.map(p => {
    const pKey = purchaseKey(p.supplier_code, p.product_code, p.product_name);
    const sold = round2(toNum(consumedByKey.get(pKey)?.total || 0));
    const theoretical = round2(toNum(p.quantity_total_commanded) - sold);
    const c = countByKey.get(pKey);
    const physical = c ? round2(toNum(c.physical_quantity)) : null;
    const diff = c ? round2(toNum(c.difference_quantity)) : null;
    const diffCost = c ? round2(toNum(c.difference_cost_htva)) : null;

    return {
      supplier_code: p.supplier_code,
      supplier_product_code: p.product_code,
      supplier_product_label: p.product_name,
      quantity_purchased: round2(toNum(p.quantity_total_commanded)),
      quantity_sold: sold,
      quantity_theoretical: theoretical,
      physical_quantity: physical,
      difference_quantity: diff,
      difference_cost_htva: diffCost,
      avg_purchase_unit_htva: round2(toNum(p.avg_unit_price)),
    };
  });

  rows.sort((a, b) =>
    a.supplier_code.localeCompare(b.supplier_code, 'fr')
    || a.supplier_product_label.localeCompare(b.supplier_product_label, 'fr')
  );
  return rows;
}

async function getOrCreateInventoryDocument(client, countedOn) {
  const { rows } = await client.query(
    `INSERT INTO inventory_financial_documents (document_date, updated_at)
     VALUES ($1, NOW())
     ON CONFLICT (document_date)
     DO UPDATE SET updated_at = NOW()
     RETURNING id`,
    [countedOn]
  );
  return Number(rows[0].id);
}

async function recomputeInventoryDocumentTotals(client, documentId) {
  await client.query(
    `UPDATE inventory_financial_documents d
     SET
       total_difference_cost_htva = x.total_cost,
       lines_count = x.lines_count,
       updated_at = NOW()
     FROM (
       SELECT
         $1::int AS id,
         COALESCE(SUM(difference_cost_htva), 0)::numeric(14,4) AS total_cost,
         COUNT(*)::int AS lines_count
       FROM inventory_financial_lines
       WHERE document_id = $1
     ) x
     WHERE d.id = x.id`,
    [documentId]
  );
}

export async function saveInventoryControlCounts(client, entries) {
  if (!Array.isArray(entries) || entries.length === 0) {
    return { saved: 0, document: null };
  }

  const supplierIdByCode = new Map();
  const touchedDates = new Set();
  let saved = 0;
  await client.query('BEGIN');
  try {
    for (const e of entries) {
      const supplierCode = normUpper(e.supplier_code || '');
      if (!supplierCode) continue;
      if (!supplierIdByCode.has(supplierCode)) {
        const { rows } = await client.query(`SELECT id FROM suppliers WHERE code = $1`, [supplierCode]);
        if (!rows.length) continue;
        supplierIdByCode.set(supplierCode, Number(rows[0].id));
      }
      const supplierId = supplierIdByCode.get(supplierCode);
      const supplierProductCode = normText(e.supplier_product_code || '');
      const labelNorm = normKeyLabel(e.supplier_product_label || '');
      if (!supplierProductCode && !labelNorm) continue;

      const countedOn = fmtIsoDate(e.counted_on || new Date());
      const theoretical = round2(toNum(e.theoretical_quantity));
      const physical = round2(toNum(e.physical_quantity));
      const avg = round2(toNum(e.avg_purchase_unit_htva));
      const diff = round2(physical - theoretical);
      const diffCost = round2(diff * avg);

      await client.query(
        `INSERT INTO inventory_counts (
           supplier_id, supplier_product_code, product_label_norm,
           theoretical_quantity, physical_quantity, difference_quantity,
           avg_purchase_unit_htva, difference_cost_htva, counted_on, note, updated_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW())
         ON CONFLICT (supplier_id, supplier_product_code, product_label_norm, counted_on)
         DO UPDATE SET
           theoretical_quantity = EXCLUDED.theoretical_quantity,
           physical_quantity = EXCLUDED.physical_quantity,
           difference_quantity = EXCLUDED.difference_quantity,
           avg_purchase_unit_htva = EXCLUDED.avg_purchase_unit_htva,
           difference_cost_htva = EXCLUDED.difference_cost_htva,
           note = EXCLUDED.note,
           updated_at = NOW()`,
        [supplierId, supplierProductCode, labelNorm, theoretical, physical, diff, avg, diffCost, countedOn, normText(e.note || '') || null]
      );

      const docId = await getOrCreateInventoryDocument(client, countedOn);
      await client.query(
        `INSERT INTO inventory_financial_lines (
           document_id, supplier_id, supplier_product_code, product_label_norm,
           theoretical_quantity, physical_quantity, difference_quantity,
           avg_purchase_unit_htva, difference_cost_htva, updated_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())
         ON CONFLICT (document_id, supplier_id, supplier_product_code, product_label_norm)
         DO UPDATE SET
           theoretical_quantity = EXCLUDED.theoretical_quantity,
           physical_quantity = EXCLUDED.physical_quantity,
           difference_quantity = EXCLUDED.difference_quantity,
           avg_purchase_unit_htva = EXCLUDED.avg_purchase_unit_htva,
           difference_cost_htva = EXCLUDED.difference_cost_htva,
           updated_at = NOW()`,
        [docId, supplierId, supplierProductCode, labelNorm, theoretical, physical, diff, avg, diffCost]
      );
      touchedDates.add(countedOn);
      saved += 1;
    }

    for (const d of touchedDates) {
      const { rows } = await client.query(`SELECT id FROM inventory_financial_documents WHERE document_date = $1`, [d]);
      if (rows[0]?.id) await recomputeInventoryDocumentTotals(client, Number(rows[0].id));
    }

    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  }

  const latestDate = [...touchedDates].sort().at(-1) || fmtIsoDate(new Date());
  const { rows: docRows } = await client.query(
    `SELECT
       id,
       to_char(document_date, 'YYYY-MM-DD') AS document_date,
       total_difference_cost_htva,
       lines_count
     FROM inventory_financial_documents
     WHERE document_date = $1`,
    [latestDate]
  );

  return {
    saved,
    document: docRows[0] ? {
      id: Number(docRows[0].id),
      document_date: docRows[0].document_date,
      total_difference_cost_htva: round2(toNum(docRows[0].total_difference_cost_htva)),
      lines_count: Number(docRows[0].lines_count || 0),
    } : null,
  };
}

export async function getInventoryFinancialDocument(client, countedOn = null) {
  const dateIso = fmtIsoDate(countedOn || new Date());
  const { rows } = await client.query(
    `SELECT
       id,
       to_char(document_date, 'YYYY-MM-DD') AS document_date,
       total_difference_cost_htva,
       lines_count
     FROM inventory_financial_documents
     WHERE document_date = $1`,
    [dateIso]
  );
  if (!rows.length) {
    return {
      document_date: dateIso,
      total_difference_cost_htva: 0,
      lines_count: 0,
    };
  }
  return {
    id: Number(rows[0].id),
    document_date: rows[0].document_date,
    total_difference_cost_htva: round2(toNum(rows[0].total_difference_cost_htva)),
    lines_count: Number(rows[0].lines_count || 0),
  };
}

function toIsoDateFromDateObj(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function shiftToBusinessDate(saleDate, saleTime) {
  const iso = fmtIsoDate(saleDate);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return '';
  const [yy, mm, dd] = iso.split('-').map(Number);
  const base = new Date(yy, (mm || 1) - 1, dd || 1);
  const hhmm = String(saleTime || '').slice(0, 5);
  if (/^\d{2}:\d{2}$/.test(hhmm) && hhmm < '05:00') {
    base.setDate(base.getDate() - 1);
  }
  return toIsoDateFromDateObj(base);
}

function classifyPaymentMode(mode) {
  const m = normText(mode).toUpperCase();
  if (!m) return 'OTHER';
  if (m.includes('ESPECE') || m.includes('ESPECES') || m.includes('CASH')) return 'CASH';
  if (
    m.includes('CB') ||
    m.includes('CARTE') ||
    m.includes('BANCONTACT') ||
    m.includes('VISA') ||
    m.includes('MASTERCARD') ||
    m.includes('MAESTRO') ||
    m.includes('STRIPE')
  ) return 'CB';
  return 'OTHER';
}

function computeRecipeCostPerSaleUnit(mappingRow) {
  const ref = mappingRow.reference_unit_price === null ? null : toNum(mappingRow.reference_unit_price);
  if (!(ref > 0)) return 0;
  const unit = normText(mappingRow.quantity_unit).toLowerCase();
  const qty = toNum(mappingRow.quantity_value);
  if (!(qty > 0)) return 0;
  if (unit === 'piece') return ref * qty;
  const qtyCl = toCl(qty, unit);
  if (!(qtyCl > 0)) return 0;
  const packageL = getPackageVolumeLitersFromLabel(mappingRow.supplier_product_label, mappingRow.volume_override);
  if (!(packageL > 0)) return 0;
  const unitsConsumed = (qtyCl / 100) / packageL;
  return ref * unitsConsumed;
}

function computeDirectCostPerSaleUnit(mappingRow) {
  const ref = mappingRow.reference_unit_price === null ? null : toNum(mappingRow.reference_unit_price);
  return ref > 0 ? ref : 0;
}

export async function listBarRentabilityDaily(client) {
  const [{ rows: salesRows }, { rows: mapRows }, { rows: nowjobsRows }] = await Promise.all([
    client.query(
      `SELECT
         sale_date,
         sale_time,
         article_name,
         quantity,
         amount_ttc,
         payment_mode
       FROM nextore_sales
       WHERE is_bar = TRUE
         AND sale_date IS NOT NULL
         AND article_name IS NOT NULL
         AND TRIM(article_name) <> ''`
    ),
    client.query(
      `SELECT
         pm.id,
         pm.nextore_product_id,
         pm.mapping_type,
         pm.quantity_value,
         pm.quantity_unit,
         sp.label AS supplier_product_label,
         sp.volume_override,
         rp.reference_unit_price
       FROM product_mappings pm
       JOIN supplier_products sp ON sp.id = pm.supplier_product_id
       LEFT JOIN supplier_reference_prices rp
         ON rp.supplier_id = sp.supplier_id
        AND rp.supplier_product_code = sp.supplier_product_code
       ORDER BY pm.nextore_product_id, pm.id`
    ),
    client.query(
      `SELECT
         to_char(shift_date, 'YYYY-MM-DD') AS shift_date,
         COALESCE(sum(duration_h), 0)::numeric AS total_hours,
         COALESCE(sum(cost_prorata), 0)::numeric AS total_cost
       FROM nowjobs_prestations
       GROUP BY to_char(shift_date, 'YYYY-MM-DD')`
    ),
  ]);

  const { rows: npRows } = await client.query(
    `SELECT id, UPPER(TRIM(code)) AS code_norm
     FROM nextore_products
     WHERE code IS NOT NULL
       AND TRIM(code) <> ''`
  );
  const nextoreIdByCode = new Map(npRows.map(r => [String(r.code_norm || ''), Number(r.id)]));

  const mapsByNextore = new Map();
  for (const m of mapRows) {
    const key = Number(m.nextore_product_id);
    if (!mapsByNextore.has(key)) mapsByNextore.set(key, []);
    mapsByNextore.get(key).push(m);
  }

  const costPerSaleUnitByNextore = new Map();
  for (const [nextoreId, rows] of mapsByNextore.entries()) {
    const recipes = rows.filter(r => normUpper(r.mapping_type) === 'RECIPE');
    const directs = rows.filter(r => normUpper(r.mapping_type) === 'DIRECT');
    let unitCost = 0;
    if (recipes.length > 0) {
      unitCost = recipes.reduce((s, r) => s + computeRecipeCostPerSaleUnit(r), 0);
    } else if (directs.length > 0) {
      unitCost = computeDirectCostPerSaleUnit(directs[0]);
    }
    costPerSaleUnitByNextore.set(Number(nextoreId), round2(unitCost));
  }

  const nowjobsByDate = new Map(
    nowjobsRows.map(r => [
      String(r.shift_date),
      {
        total_hours: round2(toNum(r.total_hours)),
        total_cost: round2(toNum(r.total_cost)),
      },
    ])
  );

  const daily = new Map();
  for (const r of salesRows) {
    const bizDate = shiftToBusinessDate(r.sale_date, r.sale_time);
    if (!bizDate) continue;
    if (!daily.has(bizDate)) {
      daily.set(bizDate, {
        business_date: bizDate,
        ca_cb: 0,
        ca_cash: 0,
        ca_total: 0,
        purchase_cost_total: 0,
        purchase_without_pa: 0,
      });
    }
    const day = daily.get(bizDate);
    const payType = classifyPaymentMode(r.payment_mode);
    const ttc = toNum(r.amount_ttc);
    // Nextore TVA non fiable: on reconstruit HTVA depuis TVAC avec 21%
    const saleHtva = ttc > 0 ? (ttc / 1.21) : 0;
    if (payType === 'CB') day.ca_cb += saleHtva;
    if (payType === 'CASH') day.ca_cash += saleHtva;

    const articleCodeNorm = normUpper(r.article_name || '');
    const nextoreId = nextoreIdByCode.get(articleCodeNorm);
    const qty = toNum(r.quantity);
    const hasMapping = Number.isInteger(nextoreId) && mapsByNextore.has(nextoreId);
    if (hasMapping) {
      const unitCost = toNum(costPerSaleUnitByNextore.get(nextoreId));
      day.purchase_cost_total += qty * unitCost;
    } else {
      // Estimation demandée: si pas de mapping, PA = Prix de vente HTVA / 2.5
      const estimatedPa = saleHtva / 2.5;
      day.purchase_without_pa += estimatedPa;
      day.purchase_cost_total += estimatedPa;
    }
  }

  const out = [...daily.values()]
    .map(d => {
      const caTotal = round2(toNum(d.ca_cb) + toNum(d.ca_cash));
      const purchaseCost = round2(d.purchase_cost_total);
      const marge = round2(caTotal - purchaseCost);
      const rh = nowjobsByDate.get(d.business_date) || { total_hours: 0, total_cost: 0 };
      const avgHour = rh.total_hours > 0 ? round2(rh.total_cost / rh.total_hours) : 0;
      const margeTotal = round2(caTotal - purchaseCost - rh.total_cost);
      return {
        business_date: d.business_date,
        ca_cb: round2(d.ca_cb),
        ca_cash: round2(d.ca_cash),
        ca_total: caTotal,
        purchase_cost_total: purchaseCost,
        purchase_without_pa: round2(d.purchase_without_pa),
        marge,
        nowjobs_hours: round2(rh.total_hours),
        nowjobs_hourly_avg: avgHour,
        nowjobs_total_cost: round2(rh.total_cost),
        marge_total: margeTotal,
      };
    })
    .filter(r => round2(r.ca_cb + r.ca_cash) > 0)
    .sort((a, b) => a.business_date.localeCompare(b.business_date));

  return out;
}

export async function withClient(fn) {
  const client = await pool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}
