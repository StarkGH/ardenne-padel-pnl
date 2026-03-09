// src/adapters/belfius-coda/parser.js
// Parser pour fichiers Belfius CODA v2 (.CD2)
// Format : lignes de 128 chars + CRLF, positions 0-indexed

import fs from 'fs';
import path from 'path';

export class CodaParser {

  /**
   * Parse un fichier .CD2
   * @param {string} filePath
   * @returns {{ fileDate: string, accountIban: string, currency: string,
   *             openingBalance: number, closingBalance: number,
   *             transactions: Array }}
   */
  parse(filePath) {
    const raw = fs.readFileSync(filePath, 'latin1');
    // Découper en lignes de 128 chars (ignorer CRLF)
    const lines = raw.split(/\r?\n/).map(l => l.trimEnd()).filter(l => l.length > 0);

    const result = {
      fileDate:       null,
      accountIban:    null,
      currency:       'EUR',
      openingBalance: null,
      closingBalance: null,
      transactions:   [],
    };

    let currentTx = null;

    for (const line of lines) {
      if (line.length < 2) continue;

      const type = this._recordType(line);

      switch (type) {
        case 'HEADER':
          result.fileDate = this._parseDate(line.substring(5, 11));
          break;

        case 'OLD_BALANCE': {
          // pos[5-20] = IBAN (16 chars), [39-41]=currency, [42]=sign, [43-57]=amount, [58-63]=date
          result.accountIban = line.substring(5, 21).trim();
          result.currency    = line.substring(39, 42).trim() || 'EUR';
          const { signedAmount } = this._parseAmount(line, 42, 43, 58);
          result.openingBalance = signedAmount;
          break;
        }

        case '21': {
          // Flush la transaction précédente
          if (currentTx) result.transactions.push(currentTx);
          currentTx = this._parseRecord21(line, result.accountIban, path.basename(filePath));
          break;
        }

        case '23': {
          if (currentTx && this._movementMatch(line, currentTx)) {
            currentTx.counterpartyIban = line.substring(10, 47).trim() || null;
            currentTx.counterpartyName = line.substring(47, 83).trim() || null;
          }
          break;
        }

        case '31': {
          if (currentTx && this._movementMatch(line, currentTx)) {
            // Text at [40-112] (73 chars), positions [113-127] = CODA control flags → excluded
            const text = line.substring(40, 113).trim();
            if (text) {
              currentTx.narrative = currentTx.narrative
                ? currentTx.narrative + '\n' + text
                : text;
            }
          }
          break;
        }

        case 'NEW_BALANCE': {
          // Flush la dernière transaction
          if (currentTx) {
            result.transactions.push(currentTx);
            currentTx = null;
          }
          // Record 8: '8' + 3-char seq + IBAN@[4-19] + 18sp + EUR@[38-40] + sign@[41] + amount@[42-56] + date@[57-62]
          const { signedAmount } = this._parseAmount(line, 41, 42, 57);
          result.closingBalance = signedAmount;
          break;
        }

        // '22', '32', 'TRAILER' → ignoré
        default:
          break;
      }
    }

    // Sécurité : flush si jamais le record 8 était absent
    if (currentTx) {
      result.transactions.push(currentTx);
    }

    return result;
  }

  // ─── Helpers privés ──────────────────────────────────────────────────────────

  /**
   * Identifier le type de record (first char ou deux premiers chars)
   */
  _recordType(line) {
    const c0 = line[0];
    if (c0 === '0') return 'HEADER';
    if (c0 === '1') return 'OLD_BALANCE';
    if (c0 === '8') return 'NEW_BALANCE';
    if (c0 === '9') return 'TRAILER';
    // Records à deux chiffres : 21, 22, 23, 31, 32
    return line.substring(0, 2);
  }

  /**
   * Vérifier que le mouvement de la ligne correspond au currentTx
   */
  _movementMatch(line, tx) {
    return parseInt(line.substring(2, 6), 10) === tx.movementNumber;
  }

  /**
   * Convertir DDMMYY → 'YYYY-MM-DD'
   * Les années 00-99 → 20xx (fichiers récents)
   */
  _parseDate(ddmmyy) {
    if (!ddmmyy || ddmmyy.trim() === '' || ddmmyy === '000000') return null;
    const dd = ddmmyy.substring(0, 2);
    const mm = ddmmyy.substring(2, 4);
    const yy = ddmmyy.substring(4, 6);
    const yyyy = '20' + yy;
    return `${yyyy}-${mm}-${dd}`;
  }

  /**
   * Parser le signe + montant
   * @param {string} line
   * @param {number} signPos   - position du char de signe
   * @param {number} amtStart  - début du montant (15 chars)
   * @param {number} amtEnd    - fin du montant (signPos + 1 + 15)
   */
  _parseAmount(line, signPos, amtStart, amtEnd) {
    const signChar = line[signPos];
    const direction = signChar === '1' ? 'DEBIT' : 'CREDIT';
    const magnitude = parseInt(line.substring(amtStart, amtEnd), 10) || 0;
    const amount = magnitude / 1000;
    const signedAmount = direction === 'DEBIT' ? -amount : amount;
    return { direction, amount, signedAmount };
  }

  /**
   * Parser le record 21 (transaction principale)
   * Positions (0-indexed) :
   *   [2-5]    numéro mouvement (4 chars)
   *   [6-9]    article (4 chars, ignoré)
   *   [10-30]  bank reference (21 chars)
   *   [31]     signe ('0'=CREDIT, '1'=DEBIT)
   *   [32-46]  montant magnitude (15 chars, /1000 = EUR)
   *   [47-52]  date transaction DDMMYY
   *   [53-61]  séquence relevé (9 chars, ignoré)
   *   [62-114] description (53 chars)
   *   [115-120] date valeur DDMMYY
   */
  _parseRecord21(line, accountIban, sourceFile) {
    const movementNumber = parseInt(line.substring(2, 6), 10);
    const bankReference  = line.substring(10, 31).trim() || null;
    const { direction, amount, signedAmount } = this._parseAmount(line, 31, 32, 47);
    const transactionDate = this._parseDate(line.substring(47, 53));
    const description     = line.substring(62, 115).trim() || null;
    const valueDate       = this._parseDate(line.substring(115, 121));

    return {
      accountIban,
      movementNumber,
      bankReference,
      direction,
      amount,
      signedAmount,
      transactionDate,
      valueDate,
      description,
      counterpartyIban: null,
      counterpartyName: null,
      narrative:        null,
      sourceFile,
    };
  }
}
