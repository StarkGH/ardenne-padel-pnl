// src/adapters/nextore-registers/parser.js
// Parse un fichier register_N.json Nextore → structure normalisée
// Segments : TERRAIN | BAR | ACCES | TOTAL

import fs from 'fs';

// ─── Classification catégories ────────────────────────────────────────────────

const BAR_CATEGORY_SET = new Set([
  'FUT',
  'BIERE BOUTEILLE 25 CL',
  'BIERE BOUTEILLE 33 CL',
  'BOISSON CHAUDE',
  'SNACK',
  'SOFT - 20 ou 25 CL',
  'SOFT - 33 CL',
]);

/**
 * TERRAIN ne figure pas dans categories[] — uniquement dans sales[]
 * PADEL AUTRES = accessoires (tube de balles, etc.)
 */
function classifyCategory(label) {
  if (!label || label === 'TOTAL') return 'TOTAL';
  if (label === 'PADEL AUTRES')    return 'ACCES';
  if (BAR_CATEGORY_SET.has(label)) return 'BAR';
  if (/^Alcool/i.test(label))      return 'BAR';
  return 'BAR'; // inconnu → BAR par défaut (conservateur)
}

// ─── Classification items (ventes) ───────────────────────────────────────────

/**
 * Items terrain : "1H Padel HC - 2 participants", "1H30 Padel HP - 4 participan",
 *                 "2H Padel HC...", "30 Padel HC..." (30min tronqué), "PROMO Padel..."
 * Items acces   : tubes de balles, location raquette, bon cadeau
 * Items total   : TOTAL, Avoir emis
 * Items bar     : tout le reste
 */
function classifyItem(item) {
  if (!item || item === 'TOTAL' || item === 'Avoir emis') return 'TOTAL';
  // Terrain : formats durée + Padel, ou PROMO Padel
  if (/^(1H30|1H|2H|30)\s+Padel/i.test(item)) return 'TERRAIN';
  if (/^PROMO\s+Padel/i.test(item))          return 'TERRAIN';
  // Accessoires
  if (/^(TUBE DE BALLES|Tube de balles)/i.test(item)) return 'ACCES';
  if (/^(Location d|BON CADEAU)/i.test(item))         return 'ACCES';
  return 'BAR';
}

// ─── Conversion date française → ISO ─────────────────────────────────────────

const MONTHS_FR = {
  janvier: '01', février: '02', mars: '03', avril: '04',
  mai: '05', juin: '06', juillet: '07', août: '08',
  septembre: '09', octobre: '10', novembre: '11', décembre: '12',
};

/**
 * "dimanche 30 novembre 2025 14:59"       → "2025-11-30T14:59:00"
 * "vendredi 05 décembre 2025 à 14:30"     → "2025-12-05T14:30:00"
 * "lundi 29 décembre 2025 à 16:55"        → "2025-12-29T16:55:00"
 */
function parseFrenchDate(str) {
  if (!str) return null;
  try {
    const parts = str.trim().split(/\s+/);
    const day   = parts.find(p => /^\d{1,2}$/.test(p));
    const month = parts.find(p => MONTHS_FR[p]);
    const year  = parts.find(p => /^\d{4}$/.test(p));
    const time  = parts.find(p => /^\d{2}:\d{2}$/.test(p));
    if (!day || !month || !year) return null;
    const mm = MONTHS_FR[month];
    const dd = day.padStart(2, '0');
    const hhmm = time || '00:00';
    return `${year}-${mm}-${dd}T${hhmm}:00`;
  } catch {
    return null;
  }
}

// ─── Parser principal ─────────────────────────────────────────────────────────

export class NextoreRegisterParser {

  /**
   * @param {string} filePath  Chemin vers register_N.json
   * @returns {{
   *   register: object,
   *   payments: Array,
   *   categories: Array,
   *   sales: Array,
   * }}
   */
  parse(filePath) {
    const raw  = fs.readFileSync(filePath, 'utf8');
    const data = JSON.parse(raw);

    const { meta, totals, payments = [], categories = [], sales = [] } = data;

    if (!meta || !totals) throw new Error('Format JSON invalide (meta/totals manquants)');

    const openAt  = parseFrenchDate(meta.open);
    const closeAt = parseFrenchDate(meta.close);
    // open_date : date seule YYYY-MM-DD (pour agrégats par jour)
    const openDate = openAt ? openAt.substring(0, 10) : null;

    const register = {
      id:            meta.report_number,
      openAt,
      closeAt,
      openDate,
      ticketsCount:  meta.tickets_count  ?? 0,
      fondCaisse:    meta.fond_caisse    ?? 0,
      avoirs:        meta.avoirs         ?? 0,
      totalTtc:      totals.total_ttc    ?? 0,
      sourceFile:    filePath,
    };

    const parsedPayments = payments
      .filter(p => p.method)
      .map(p => ({
        method:    p.method,
        count:     p.count  ?? 0,
        amount:    p.amount ?? 0,
        isSummary: /^TOTAL/.test(p.method),
      }));

    const parsedCategories = categories
      .filter(c => c.label)
      .map(c => ({
        label:   c.label,
        count:   c.count  ?? 0,
        amount:  c.amount ?? 0,
        segment: classifyCategory(c.label),
      }));

    const parsedSales = sales
      .filter(s => s.item)
      .map(s => ({
        item:    s.item,
        count:   s.count  ?? 0,
        amount:  s.amount ?? 0,
        segment: classifyItem(s.item),
      }));

    return { register, payments: parsedPayments, categories: parsedCategories, sales: parsedSales };
  }
}
