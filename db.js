// db.js — Connexion PostgreSQL + migrations automatiques
// Pattern adapté de padel-service/db.js (SQLite) → PostgreSQL/pg

import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

const { Pool } = pg;

if (!process.env.DB_URL) {
  console.error('❌  DB_URL manquant dans .env');
  process.exit(1);
}

export const pool = new Pool({ connectionString: process.env.DB_URL });

// ─── Migration runner ────────────────────────────────────────────────────────

export async function migrate() {
  const client = await pool.connect();
  try {
    // Table de tracking (idempotente)
    await client.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        id         TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    if (!fs.existsSync(MIGRATIONS_DIR)) {
      console.warn('⚠️  Dossier migrations introuvable :', MIGRATIONS_DIR);
      return;
    }

    const files = fs.readdirSync(MIGRATIONS_DIR)
      .filter(f => f.endsWith('.sql'))
      .sort();

    for (const f of files) {
      const { rows } = await client.query(
        'SELECT 1 FROM _migrations WHERE id = $1', [f]
      );
      if (rows.length > 0) continue;

      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8');
      console.log('>>> Application migration :', f);

      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO _migrations(id) VALUES($1)', [f]);
      await client.query('COMMIT');

      console.log('✔  Migration OK :', f);
    }
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌  Migration échouée :', err.message);
    throw err;
  } finally {
    client.release();
  }
}

// ─── Helpers UPSERT ──────────────────────────────────────────────────────────

/**
 * Upsert un fournisseur → retourne son id
 */
export async function upsertSupplier(client, { code, name, vat_number, address }) {
  const { rows } = await client.query(
    `INSERT INTO suppliers (code, name, vat_number, address)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [code, name, vat_number ?? null, address ?? null]
  );
  return rows[0].id;
}

/**
 * Upsert une facture → retourne { id, inserted: bool }
 * ON CONFLICT DO NOTHING : si la facture existe déjà → skip
 */
export async function upsertInvoice(client, supplierCode, invoice) {
  const { rows: sup } = await client.query(
    'SELECT id FROM suppliers WHERE code = $1', [supplierCode]
  );
  if (sup.length === 0) throw new Error(`Fournisseur inconnu : ${supplierCode}`);
  const supplier_id = sup[0].id;

  const { rows } = await client.query(
    `INSERT INTO invoices (
       supplier_id, invoice_number, invoice_date, bordereau_number,
       due_date, reference, doc_type,
       total_htva_21, total_tva_21, total_htva_6, total_tva_6,
       vidanges_livrees, vidanges_reprises, total_a_payer,
       source_file, import_status, import_notes
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17
     )
     ON CONFLICT (supplier_id, invoice_number) DO NOTHING
     RETURNING id`,
    [
      supplier_id,
      invoice.invoice_number,
      invoice.invoice_date,
      invoice.bordereau_number ?? null,
      invoice.due_date         ?? null,
      invoice.reference        ?? null,
      invoice.doc_type         ?? 'FACTURE',
      invoice.total_htva_21    ?? null,
      invoice.total_tva_21     ?? null,
      invoice.total_htva_6     ?? null,
      invoice.total_tva_6      ?? null,
      invoice.vidanges_livrees  ?? null,
      invoice.vidanges_reprises ?? null,
      invoice.total_a_payer    ?? null,
      invoice.source_file      ?? null,
      invoice.import_status    ?? 'OK',
      invoice.import_notes     ?? null,
    ]
  );

  if (rows.length === 0) return { id: null, inserted: false };
  return { id: rows[0].id, inserted: true };
}

/**
 * Insérer les lignes de facture (en batch)
 */
export async function insertInvoiceLines(client, invoiceId, lines) {
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    try {
      await client.query(
        `INSERT INTO invoice_lines (
           invoice_id, line_order, product_code, description,
           quantity_colis, quantity_total, unit_price, excise_ecoboni,
           discount_pct, net_unit_price, line_total_htva,
           vid_unit, vid_total, tva_rate, line_type
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
        [
          invoiceId,
          i + 1,
          l.product_code     ?? null,
          l.description      ?? null,
          l.quantity_colis   ?? null,
          l.quantity_total   ?? null,
          l.unit_price       ?? null,
          l.excise_ecoboni   ?? null,
          l.discount_pct     ?? null,
          l.net_unit_price   ?? null,
          l.line_total_htva  ?? null,
          l.vid_unit         ?? null,
          l.vid_total        ?? null,
          l.tva_rate         ?? null,
          l.line_type        ?? 'PRODUCT',
        ]
      );
    } catch (err) {
      throw new Error(
        `Line ${i+1} [${l.product_code ?? '?'}] "${(l.description ?? '').substring(0, 40)}": ${err.message}\n` +
        `  qty_colis=${l.quantity_colis} qty_total=${l.quantity_total}\n` +
        `  unit_price=${l.unit_price} excise=${l.excise_ecoboni} discount_pct=${l.discount_pct}\n` +
        `  net_unit=${l.net_unit_price} line_total=${l.line_total_htva}\n` +
        `  vid_unit=${l.vid_unit} vid_total=${l.vid_total} tva=${l.tva_rate}`
      );
    }
  }
}

/**
 * Upsert une transaction bancaire (CODA)
 * ON CONFLICT (source_file, movement_number) DO NOTHING → idempotent
 * @returns {{ inserted: boolean }}
 */
export async function upsertBankTransaction(client, tx) {
  const { rows } = await client.query(
    `INSERT INTO bank_transactions
       (account_iban, transaction_date, value_date, movement_number, bank_reference,
        direction, amount, signed_amount, currency, description,
        counterparty_iban, counterparty_name, narrative, source_file)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     ON CONFLICT (source_file, movement_number) DO NOTHING
     RETURNING id`,
    [
      tx.accountIban,
      tx.transactionDate,
      tx.valueDate       ?? null,
      tx.movementNumber,
      tx.bankReference   ?? null,
      tx.direction,
      tx.amount,
      tx.signedAmount,
      tx.currency        ?? 'EUR',
      tx.description     ?? null,
      tx.counterpartyIban ?? null,
      tx.counterpartyName ?? null,
      tx.narrative       ?? null,
      tx.sourceFile,
    ]
  );
  return { inserted: rows.length > 0 };
}

/**
 * Upsert un registre Nextore + sous-tables (payments, categories, sales)
 * ON CONFLICT (id) DO NOTHING → idempotent
 * @returns {{ inserted: boolean }}
 */
export async function upsertNrRegister(client, { register, payments, categories, sales }) {
  const { rows } = await client.query(
    `INSERT INTO nr_registers
       (id, open_at, close_at, open_date, tickets_count, fond_caisse, avoirs, total_ttc, source_file)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (id) DO NOTHING
     RETURNING id`,
    [
      register.id,
      register.openAt     ?? null,
      register.closeAt    ?? null,
      register.openDate   ?? null,
      register.ticketsCount,
      register.fondCaisse,
      register.avoirs,
      register.totalTtc,
      register.sourceFile,
    ]
  );
  if (rows.length === 0) return { inserted: false };

  // Paiements
  for (const p of payments) {
    await client.query(
      `INSERT INTO nr_payments (register_id, method, count, amount, is_summary)
       VALUES ($1,$2,$3,$4,$5)`,
      [register.id, p.method, p.count, p.amount, p.isSummary]
    );
  }

  // Catégories
  for (const c of categories) {
    await client.query(
      `INSERT INTO nr_categories (register_id, label, count, amount, segment)
       VALUES ($1,$2,$3,$4,$5)`,
      [register.id, c.label, c.count, c.amount, c.segment]
    );
  }

  // Ventes
  for (const s of sales) {
    await client.query(
      `INSERT INTO nr_sales (register_id, item, count, amount, segment)
       VALUES ($1,$2,$3,$4,$5)`,
      [register.id, s.item, s.count, s.amount, s.segment]
    );
  }

  return { inserted: true };
}

// Lancer les migrations si exécuté directement
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await migrate();
  await pool.end();
  console.log('✅  Migrations terminées');
}
