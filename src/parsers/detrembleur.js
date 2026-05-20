// src/parsers/detrembleur.js  v5
// Parser pour les factures PDF Brasserie Detrembleur SRL
//
// v5 — corrections majeures :
//   - _parseQty retourne TOUS les splits possibles (pas juste le premier)
//   - _parseLine choisit le split où qty × net_unit_price ≈ line_total_htva
//   - Gère les retours de fûts (qty négatif concaténé au prix : "-370,415" = -3 kegs × 70,415)
//   - Gère les lignes tarif (VERRES, LI NEURRE) sans qty ni total
//   - Validation par ligne ajoutée dans _validate

import pdfParse from 'pdf-parse/lib/pdf-parse.js';
import fs from 'fs';

// ─── Utilitaires ──────────────────────────────────────────────────────────────

/**
 * Convertit format belge → float JS.
 * "1.369,31" → 1369.31  |  "35,472" → 35.472  |  "-09,000" → -9.0
 */
function parseBelgian(s) {
  if (!s && s !== 0) return null;
  return parseFloat(String(s).replace(/\./g, '').replace(',', '.')) || null;
}

/**
 * Extrait tous les nombres au format belge (exactement 3 décimales)
 * depuis une chaîne concaténée de chiffres.
 * ex: "35,4722,764" → [35.472, 2.764]
 */
function extractBelgianNumbers(str) {
  const matches = [...(str || '').matchAll(/-?\d+,\d{3}/g)];
  return matches.map(m => parseBelgian(m[0])).filter(n => n !== null);
}

// ─── Parser principal ─────────────────────────────────────────────────────────

export class DetrembleurParser {

  async parse(input) {
    const buf = Buffer.isBuffer(input) ? input : fs.readFileSync(input);
    const data = await pdfParse(buf);
    const text = data.text;

    const header     = this._parseHeader(text);
    const lines      = this._parseProductLines(text);
    const summary    = this._parseSummary(text);
    const validation = this._validate(lines, summary);

    return { header, lines, summary, validation };
  }

  // ── En-tête ──────────────────────────────────────────────────────────────

  _parseHeader(text) {
    const toISO = (d) => {
      if (!d) return null;
      const [day, month, year] = d.split('/');
      return `${year}-${month}-${day}`;
    };

    const isCopy = /C\s*O\s*P\s*I\s*E/.test(text);

    return {
      invoice_number:   text.match(/FACTURE N°\s*(\d+)/)?.[1]         ?? null,
      invoice_date:     toISO(text.match(/Date(\d{2}\/\d{2}\/\d{4})/)?.[1]),
      bordereau_number: text.match(/N° de bordereau(\d+)/)?.[1]       ?? null,
      due_date:         toISO(text.match(/Date d'échéance(\d{2}\/\d{2}\/\d{4})/)?.[1]),
      reference:        text.match(/Référence à rappeler([\d\/]+)/)?.[1] ?? null,
      client_number:    text.match(/N° de client(\d+)/)?.[1]          ?? null,
      doc_type:         isCopy ? 'CORRECTION' : 'FACTURE',
    };
  }

  // ── Section résumé ────────────────────────────────────────────────────────

  _parseSummary(text) {
    const tvaSectionIdx = text.lastIndexOf('TauxBaseTVATotal');
    const tvaSection    = tvaSectionIdx >= 0 ? text.substring(tvaSectionIdx) : '';

    const tva21 = tvaSection.match(/21\s*%\s*(-?[\d.]*,\d{2})\s*(-?[\d.]*,\d{2})/);
    const tva6  = tvaSection.match(/6\s*%\s*(-?[\d.]*,\d{2})\s*(-?[\d.]*,\d{2})/);

    const totalMatch = text.match(/(?:TOTAL A PAYER|RENDU)\s*(-?[\d.,]+)\s*EUR/);

    const summarySection = text.lastIndexOf('Vidanges livrées') >= 0
      ? text.substring(text.lastIndexOf('Vidanges livrées'))
      : text;

    return {
      total_a_payer:     parseBelgian(totalMatch?.[1])     ?? null,
      total_htva_21:     parseBelgian(tva21?.[1])          ?? null,
      total_tva_21:      parseBelgian(tva21?.[2])          ?? null,
      total_htva_6:      parseBelgian(tva6?.[1])           ?? null,
      total_tva_6:       parseBelgian(tva6?.[2])           ?? null,
      vidanges_livrees:  parseBelgian(summarySection.match(/Vidanges livrées\s*(-?[\d.,]+)\s*EUR/)?.[1])  ?? null,
      vidanges_reprises: parseBelgian(summarySection.match(/Vidanges reprises\s*(-?[\d.,]+)\s*EUR/)?.[1]) ?? null,
    };
  }

  // ── Lignes produits ───────────────────────────────────────────────────────

  _parseProductLines(text) {
    return text
      .split('\n')
      .map(l => l.trim())
      .filter(l => /^\d{10}/.test(l))
      .filter(l => !/^Report|SUITE SUR PAGE/i.test(l.substring(10)))
      .map(l => this._parseLine(l))
      .filter(Boolean);
  }

  _parseLine(raw) {
    const code = raw.substring(0, 10);
    const rest = raw.substring(10);

    // ── Type de ligne ──
    let lineType = 'PRODUCT';
    if (rest.includes('*** GRATUIT ***')) lineType = 'GRATUIT';
    else if (/^VIDANGE/i.test(rest))      lineType = 'VIDANGE';
    else if (/^RET(?:OUR)?\s+VID/i.test(rest)) lineType = 'RETOUR_VIDANGE';

    // ── TVA en fin de ligne ──
    const tvaMatch = rest.match(/(6|21)\s*%\s*$/);
    const tvaRate  = tvaMatch ? tvaMatch[1] + '%' : null;

    // ── Description ──
    let description;
    // N limité à 1-2 chiffres (max 99 caisses) + M non-greedy + lookahead prix belge.
    // Distingue :  "3 x 24" (qty)  vs "20CLX24**3** x 24" → N=243 (3 digits) → rejeté
    //              "1 x 24" (qty)  vs "24 x 25 CL" (spec taille, pas de prix belge après)
    const lowerXIdx = rest.search(/\d{1,2}\s+x\s+\d+?(?=\d*,\d{3})/);
    if (lowerXIdx >= 0) {
      description = rest.substring(0, lowerXIdx).trimEnd();
    } else {
      const greedyMatch = rest.match(/^(.*[A-Za-z°)€*\]])/s);
      description = greedyMatch ? greedyMatch[1].trimEnd() : '';
    }

    // ── Section numérique ──
    const numSection = rest
      .substring(description.length)
      .replace(/\s*(6|21)\s*%\s*$/, '');

    // ── Choisir le meilleur split qty / financiers ──
    let { qty_colis, qty_total, fin } = this._pickBestSplit(numSection, lineType);

    // ── Correction frontière description (cas "20CLX24|3 x 24") ──
    // Si numSection commence par "Nwrong x M" mais qty=Nright qui est un SUFFIXE de Nwrong,
    // alors les derniers chiffres de Nwrong appartiennent au prix produit, pas au qty.
    // Ex : "43 x 2418,648..." → qty=3 (dérivé), "43".endsWith("3") → corriger +1 char
    if (lowerXIdx >= 0 && qty_colis !== null) {
      const nxMatch = numSection.match(/^(-?\d+)\s+x\s+/);
      if (nxMatch) {
        const Nwrong = parseInt(nxMatch[1], 10);
        if (Nwrong !== qty_colis) {
          const nwStr = String(Math.abs(Nwrong));
          const nrStr = String(Math.abs(qty_colis));
          if (nwStr.endsWith(nrStr) && nwStr.length > nrStr.length) {
            const extraLen = nwStr.length - nrStr.length;
            description = rest.substring(0, lowerXIdx + extraLen).trimEnd();
            const corrNum = rest.substring(description.length)
                               .replace(/\s*(6|21)\s*%\s*$/, '');
            ({ qty_colis, qty_total, fin } = this._pickBestSplit(corrNum, lineType));
          }
        }
      }
    }

    return {
      product_code:    code,
      description,
      line_type:       lineType,
      tva_rate:        tvaRate,
      quantity_colis:  qty_colis,
      quantity_total:  qty_total,
      unit_price:      fin.unit_price,
      excise_ecoboni:  fin.excise_ecoboni,
      discount_pct:    fin.discount_pct,
      net_unit_price:  fin.net_unit_price,
      line_total_htva: fin.line_total_htva,
      vid_unit:        fin.vid_unit,
      vid_total:       fin.vid_total,
      raw_numbers:     fin.raw_numbers,
      raw_line:        raw,
    };
  }

  // ── Sélection du meilleur split ───────────────────────────────────────────

  /**
   * Génère tous les splits qty/afterQty possibles, extrait les financiers
   * pour chacun, et retourne celui où qty × net_unit_price ≈ line_total_htva.
   *
   * Gère 3 formats :
   *   A) "N x M" (lowercase x) → un seul candidat, toujours correct
   *   B) Integer concaténé au prix : "370,415..." = 3 × 70,415
   *      ou retour négatif : "-221,687..." = -22 × 1,687
   *   C) Pas de qty (ligne tarif, VERRES, etc.) → qty dérivé de total/net
   */
  _pickBestSplit(numSection, lineType) {
    const s = (numSection || '').trimStart();
    const TOLERANCE = 0.10;
    const candidates = [];

    // ── Format "N x M" : tester plusieurs longueurs de M ──
    // Problème PDF : "3 x 24" + "44,592" (prix) → "3 x 2444,592" (concaténé)
    // On génère M=2, M=24, M=244 et on valide qty_colis × net ≈ total
    const multiBaseMatch = s.match(/^(-?\d+)\s*x\s*/);
    if (multiBaseMatch) {
      const colis     = parseInt(multiBaseMatch[1], 10);
      const afterNx   = s.substring(multiBaseMatch[0].length);
      const mAllDigits = (afterNx.match(/^(\d+)/) || [])[1] || '';

      for (let mLen = 1; mLen <= mAllDigits.length; mLen++) {
        const mStr     = mAllDigits.substring(0, mLen);
        const afterQty = afterNx.substring(mLen);
        // L'afterQty doit démarrer par un nombre belge (ou être vide)
        if (afterQty && !/^-?\d+,\d{3}/.test(afterQty)) continue;
        const unit = parseInt(mStr, 10);
        candidates.push({ qty_colis: colis, qty_total: colis * unit, afterQty, isNxM: true });
      }
    } else {
      // ── Format entier seul : "-221,687" = -22 (qty) + 1,687 (prix) ──
      // Aussi : "36" seul (GRATUIT sans vid), ou "1 0,080..." (espace avant vid)
      const bareMatch = s.match(/^(-?\d+)/);
      if (bareMatch) {
        const allDigits = bareMatch[1];
        for (let len = 1; len <= allDigits.length; len++) {
          const cand = allDigits.substring(0, len);
          if (cand === '-') continue;
          const rem = s.substring(len);
          // Accepter : rem démarre par un nombre belge (direct ou après espace)
          //            OU rem est vide (qty seul, ex: "36" dans GRATUIT)
          const remTrimmed = rem.trimStart();
          if (/^-?\d+,\d{3}/.test(remTrimmed) || remTrimmed === '') {
            const qty = parseInt(cand, 10);
            if (!isNaN(qty)) candidates.push({ qty_colis: qty, qty_total: qty, afterQty: rem, isNxM: false });
          }
        }
      }
    }

    // ── Raccourci GRATUIT : prendre le premier candidat avec qty entier ──
    // Les lignes GRATUIT ont qty N (nb verres/items gratuits), sans financiers
    if (lineType === 'GRATUIT') {
      const gc = candidates.find(c => c.qty_colis !== null);
      if (gc) return { qty_colis: gc.qty_colis, qty_total: gc.qty_total, fin: this._extractFinancials(gc.afterQty, lineType) };
    }

    // Fallback : toute la section est financière (ligne tarif, VERRES…)
    candidates.push({ qty_colis: null, qty_total: null, afterQty: s, isNxM: false });

    // ── Sélection : qty_colis × net_unit_price ≈ line_total_htva ──
    // Pour "N x M" le prix de la facture est PAR COLIS (pas par bouteille)
    for (const cand of candidates) {
      if (cand.qty_colis === null) continue;
      const fin = this._extractFinancials(cand.afterQty, lineType);
      if (fin.net_unit_price === null || fin.line_total_htva === null) continue;

      const delta = Math.abs(cand.qty_colis * fin.net_unit_price - fin.line_total_htva);
      if (delta >= TOLERANCE) continue;

      // Vérification supplémentaire : unit_price et net_unit_price dans le même ordre
      // de grandeur (évite M=2 qui donne unit_price=444 vs net=44)
      if (fin.unit_price !== null) {
        const ratio = Math.abs(fin.unit_price - fin.net_unit_price) /
                      (Math.abs(fin.unit_price) || 0.001);
        if (ratio > 0.5) continue;
      }

      return { qty_colis: cand.qty_colis, qty_total: cand.qty_total, fin };
    }

    // ── Dernier recours : pleine section → dériver qty depuis total/net ──
    const fallbackFin = this._extractFinancials(s, lineType);
    let derivedQty = null;
    if (fallbackFin.net_unit_price !== null && fallbackFin.line_total_htva !== null &&
        fallbackFin.line_total_htva !== 0) {
      const q = Math.round(fallbackFin.line_total_htva / fallbackFin.net_unit_price);
      if (q !== 0 && Math.abs(q * fallbackFin.net_unit_price - fallbackFin.line_total_htva) < TOLERANCE) {
        derivedQty = q;
      }
    }
    return { qty_colis: derivedQty, qty_total: derivedQty, fin: fallbackFin };
  }

  // ── Champs financiers ─────────────────────────────────────────────────────

  /**
   * Découpe la section après la quantité en :
   *   [LEFT : prix_unit + accises]  [ESPACE ou REM%]  [RIGHT : prix_net + total + vid?]
   */
  _extractFinancials(afterQty, lineType) {
    const result = {
      unit_price:      null,
      excise_ecoboni:  null,
      discount_pct:    null,
      net_unit_price:  null,
      line_total_htva: null,
      vid_unit:        null,
      vid_total:       null,
      raw_numbers:     [],
    };

    if (!afterQty) return result;

    result.raw_numbers = extractBelgianNumbers(afterQty);

    if (lineType === 'GRATUIT') {
      const nums = extractBelgianNumbers(afterQty);
      result.vid_unit  = nums[0] ?? null;
      result.vid_total = nums[1] ?? null;
      return result;
    }

    if (lineType === 'VIDANGE' || lineType === 'RETOUR_VIDANGE') {
      const nums = extractBelgianNumbers(afterQty);
      result.vid_unit  = nums[0] ?? null;
      result.vid_total = nums[1] ?? null;
      return result;
    }

    // ── Lignes PRODUCT ──

    // Remise explicite : après fin d'un nombre belge (,\d{3}), avant TVA final
    const remiseMatch = afterQty.match(/(?<=,\d{3})(-?\d+(?:,\d{1,2})?)\s*%(?!\s*$)/);
    if (remiseMatch) result.discount_pct = parseBelgian(remiseMatch[1]);

    let leftStr  = '';
    let rightStr = '';

    if (result.discount_pct !== null) {
      const remIdx = remiseMatch.index;
      leftStr  = afterQty.substring(0, remIdx);
      const afterRem = afterQty.substring(afterQty.indexOf('%', remIdx) + 1);
      rightStr = afterRem;
    } else {
      // Chercher l'espace entre deux nombres à 3 décimales
      const spaceMatch = afterQty.match(/(-?\d+,\d{3})\s+(-?\d+,\d{3})/);
      if (spaceMatch) {
        const pos = afterQty.indexOf(spaceMatch[0]);
        leftStr  = afterQty.substring(0, pos + spaceMatch[1].length);
        rightStr = afterQty.substring(pos + spaceMatch[1].length).trimStart();
      } else {
        rightStr = afterQty;
      }
    }

    // Gauche : prix_unit + accises
    const leftNums = extractBelgianNumbers(leftStr);
    if (leftNums.length >= 2) {
      result.unit_price     = leftNums[leftNums.length - 2];
      result.excise_ecoboni = leftNums[leftNums.length - 1];
    } else if (leftNums.length === 1) {
      result.unit_price = leftNums[0];
    }

    // Droite : prix_net [0], total_htva [1], vid_unit [2], vid_total [3]
    const rightNums = extractBelgianNumbers(rightStr);
    result.net_unit_price  = rightNums[0] ?? null;
    result.line_total_htva = rightNums[1] ?? null;
    result.vid_unit        = rightNums[2] ?? null;
    result.vid_total       = rightNums[3] ?? null;

    // ── Correction vid_unit 4 décimales ─────────────────────────────────────
    // Problème : certains dépôts bouteille ont 4 dec dans le PDF (ex: "0,1955").
    // La regex 3-dec capture "0,195" et laisse "5" orphelin → "5"+"4,300"="54,300".
    // Détection : vid_unit < 1€ ET vid_total > 50× vid_unit (aberrant).
    // Correction : re-parser la fin de rightStr avec regex 4-dec + 3-dec.
    if (result.vid_unit !== null && result.vid_total !== null) {
      const absUnit  = Math.abs(result.vid_unit);
      const absTotal = Math.abs(result.vid_total);
      if (absUnit < 1.0 && absTotal >= absUnit * 50) {
        // Retrouver la position de vid_unit dans rightStr pour re-parser depuis là
        const vUnit3 = result.vid_unit < 0
          ? `-${Math.abs(result.vid_unit).toFixed(3).replace('.', ',')}`
          :      result.vid_unit.toFixed(3).replace('.', ',');
        const vidPos = rightStr.indexOf(vUnit3);
        if (vidPos >= 0) {
          const vidSubstr = rightStr.substring(vidPos);
          // Tenter 4 dec pour vid_unit + 3 dec pour vid_total (ex: "0,1955" + "4,300")
          const m4 = vidSubstr.match(/^(-?\d+,\d{4})(-?\d+,\d{3})\s*$/);
          if (m4) {
            const vu4 = parseBelgian(m4[1]);
            const vt4 = parseBelgian(m4[2]);
            if (vu4 !== null && vt4 !== null && Math.abs(vu4) < 1.0) {
              result.vid_unit  = vu4;
              result.vid_total = vt4;
            }
          }
        }
      }
    }

    // Correction : si rightNums n'a qu'un seul élément
    if (rightNums.length === 1) {
      if (leftNums.length >= 2) {
        // Gauche a unit_price + excise, droite n'a que net → ligne tarif (pas de total réel)
        // Ex: "LI NEURRE ... 1,724 0,115 1,724"
        result.net_unit_price  = rightNums[0];
        result.line_total_htva = null;
      } else if (leftNums.length === 1 && leftNums[0] === rightNums[0]) {
        // Gauche = droite (même valeur) → unit_price = net_unit_price, pas de total
        // Ex: "VERRES JUPILER 1,260 1,260" (verres offerts, prix unitaire seulement)
        result.net_unit_price  = rightNums[0];
        result.line_total_htva = null;
      } else {
        // Gauche a seulement unit_price, droite a seulement le total (ligne simplifiée)
        result.line_total_htva = rightNums[0];
        result.net_unit_price  = null;
      }
    }

    return result;
  }

  // ── Validation ────────────────────────────────────────────────────────────

  _validate(lines, summary) {
    const warnings = [];
    const TOLERANCE_SUM  = 0.15;
    const TOLERANCE_LINE = 0.10;

    const products = lines.filter(l => l.line_type === 'PRODUCT');

    // ── Validation par ligne : qty_colis × net ≈ total ──
    // Le prix Detrembleur est PAR COLIS (caisse), pas par bouteille individuelle
    const lineErrors = products.filter(l =>
      l.quantity_colis !== null &&
      l.net_unit_price !== null &&
      l.line_total_htva !== null &&
      Math.abs(l.quantity_colis * l.net_unit_price - l.line_total_htva) > TOLERANCE_LINE
    );

    if (lineErrors.length > 0) {
      lineErrors.forEach(l => {
        const computed = (l.quantity_colis * l.net_unit_price).toFixed(3);
        warnings.push(`ligne ${l.product_code} "${l.description.substring(0,20)}": ${l.quantity_colis}×${l.net_unit_price}=${computed} ≠ total=${l.line_total_htva}`);
      });
    }

    // ── Validation sommes TVA ──
    const sum21 = products
      .filter(l => l.tva_rate === '21%')
      .reduce((a, l) => a + (l.line_total_htva ?? 0), 0);
    const sum6 = products
      .filter(l => l.tva_rate === '6%')
      .reduce((a, l) => a + (l.line_total_htva ?? 0), 0);

    const check = (label, computed, expected) => {
      if (expected === null) return;
      if (Math.abs(computed - expected) > TOLERANCE_SUM) {
        warnings.push(`${label}: lignes=${computed.toFixed(2)} vs résumé=${expected} (écart=${(computed - expected).toFixed(2)})`);
      }
    };

    check('HTVA 21%', sum21, summary.total_htva_21);
    check('HTVA 6%',  sum6,  summary.total_htva_6);

    // ── Contrôle vidanges ──
    const isVidLine = l => l.line_type === 'VIDANGE' || l.line_type === 'RETOUR_VIDANGE';
    const vidLivrees = lines.reduce((a, l) => {
      if (l.vid_total === null) return a;
      if (!isVidLine(l)) return a + l.vid_total;       // PRODUCT: net (positif et négatif)
      return l.vid_total > 0 ? a + l.vid_total : a;    // VIDANGE/RETOUR_VIDANGE: positif seulement
    }, 0);
    const vidReprises = lines.reduce((a, l) => {
      if (l.vid_total === null || l.vid_total >= 0) return a;
      return isVidLine(l) ? a + l.vid_total : a;       // VIDANGE/RETOUR_VIDANGE: négatif seulement
    }, 0);
    check('Vid.livrées',  vidLivrees,  summary.vidanges_livrees);
    check('Vid.reprises', vidReprises, summary.vidanges_reprises);

    // ── Contrôle total à payer ──
    // total_a_payer = HTVA_21 + TVA_21 + HTVA_6 + TVA_6 + vid_livrees + vid_reprises
    if (summary.total_a_payer !== null &&
        summary.total_htva_21 !== null && summary.total_tva_21 !== null &&
        summary.total_htva_6  !== null && summary.total_tva_6  !== null) {
      const recon = (summary.total_htva_21 ?? 0) + (summary.total_tva_21 ?? 0)
                  + (summary.total_htva_6  ?? 0) + (summary.total_tva_6  ?? 0)
                  + (summary.vidanges_livrees ?? 0) + (summary.vidanges_reprises ?? 0);
      if (Math.abs(recon - summary.total_a_payer) > TOLERANCE_SUM) {
        warnings.push(`Total à payer: reconstitué=${recon.toFixed(2)} vs PDF=${summary.total_a_payer} (écart=${(recon - summary.total_a_payer).toFixed(2)})`);
      }
    }

    return { valid: warnings.length === 0, warnings };
  }
}

// ─── Test standalone ──────────────────────────────────────────────────────────

if (process.argv[1]?.endsWith('detrembleur.js')) {
  const PDF_DIR = process.env.DATA_DIR ||
    '/mnt/c/Users/stark/OneDrive - Antoine Zingaro (CQFD Consult)/Boulot New/Ardenne Padel/_Finance/PNL/Shared/BAR/DB';

  const files = fs.readdirSync(PDF_DIR)
    .filter(f => f.startsWith('DETREMBLEUR') && f.endsWith('.pdf'))
    .sort();

  const parser = new DetrembleurParser();

  for (const f of files) {
    console.log(`\n${'─'.repeat(65)}`);
    console.log(`📄  ${f}`);
    try {
      const { header: h, lines, summary: s, validation: v } = await parser.parse(`${PDF_DIR}/${f}`);
      const products = lines.filter(l => l.line_type === 'PRODUCT');
      const specials  = lines.filter(l => l.line_type !== 'PRODUCT');
      console.log(`  ${h.doc_type}  N° ${h.invoice_number}  (${h.invoice_date})  bord. ${h.bordereau_number}`);
      console.log(`  Total à payer : ${s.total_a_payer} €`);
      console.log(`  HTVA 21%      : ${s.total_htva_21} €   TVA: ${s.total_tva_21} €`);
      console.log(`  HTVA 6%       : ${s.total_htva_6} €   TVA: ${s.total_tva_6} €`);
      console.log(`  Vidanges      : +${s.vidanges_livrees} €  /  ${s.vidanges_reprises} €`);
      console.log(`  Lignes produit: ${products.length}  /  Spéciales: ${specials.length}`);
      const sum21 = products.filter(l=>l.tva_rate==='21%').reduce((a,l)=>a+(l.line_total_htva??0),0);
      const sum6  = products.filter(l=>l.tva_rate==='6%').reduce((a,l)=>a+(l.line_total_htva??0),0);
      console.log(`  Σ lignes 21%  : ${sum21.toFixed(2)} €   Σ lignes 6%: ${sum6.toFixed(2)} €`);
      if (!v.valid) {
        v.warnings.forEach(w => console.log(`  ⚠️  ${w}`));
      } else {
        console.log(`  Validation    : ✅ OK`);
      }
    } catch (err) {
      console.log(`  ❌ ERREUR: ${err.message}`);
      console.error(err.stack);
    }
  }
}
