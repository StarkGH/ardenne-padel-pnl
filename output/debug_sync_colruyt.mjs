import { pool } from '/home/stark2026/projects/ardenne-padel-pnl/db.js';
const c=await pool.connect();
try{
 const a=await c.query(`SELECT COUNT(*) n FROM invoice_lines il JOIN invoices i ON i.id=il.invoice_id JOIN suppliers s ON s.id=i.supplier_id WHERE s.code='COLRUYT' AND il.line_type='PRODUCT' AND il.description IS NOT NULL AND TRIM(il.description)<>''`);
 const b=await c.query(`SELECT id, code FROM suppliers WHERE code='COLRUYT'`);
 console.log('src_base',a.rows[0].n,'supplier',b.rows);
 const r=await c.query(`WITH src_base AS (
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
     )
     SELECT COUNT(*) n, COUNT(DISTINCT supplier_product_code) d_code, COUNT(DISTINCT label_norm) d_label FROM src_base`,['COLRUYT']);
 console.log(r.rows[0]);
}finally{c.release(); await pool.end();}
