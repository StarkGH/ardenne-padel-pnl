import { pool } from '/home/stark2026/projects/ardenne-padel-pnl/db.js';
const c = await pool.connect();
try {
  const inv = await c.query(`
    SELECT i.id, s.code supplier, i.invoice_number, i.total_a_payer, i.vidanges_livrees, i.vidanges_reprises
    FROM invoices i JOIN suppliers s ON s.id=i.supplier_id
    WHERE s.code='DETREMBLEUR' AND i.invoice_number='00002049'
    LIMIT 1
  `);
  if (!inv.rows.length) throw new Error('invoice introuvable');
  const id = inv.rows[0].id;
  const lines = await c.query(`
    SELECT line_type, COUNT(*) n, ROUND(COALESCE(SUM(vid_total),0)::numeric,2) vid_total_sum,
           ROUND(COALESCE(SUM(line_total_htva),0)::numeric,2) ht_sum
    FROM invoice_lines
    WHERE invoice_id=$1
    GROUP BY line_type
    ORDER BY line_type
  `,[id]);
  const totals = await c.query(`
    SELECT
      ROUND(COALESCE(SUM(COALESCE(line_total_htva,0) * (1 + COALESCE(NULLIF(REGEXP_REPLACE(COALESCE(tva_rate,''), '[^0-9\.]', '', 'g'), '')::numeric, 0)/100)),0)::numeric,2) goods_tvac,
      ROUND(COALESCE(SUM(COALESCE(vid_total,0)),0)::numeric,2) vid_sum
    FROM invoice_lines WHERE invoice_id=$1
  `,[id]);
  console.log(JSON.stringify({invoice:inv.rows[0], by_line_type:lines.rows, totals:totals.rows[0]},null,2));
} finally { c.release(); await pool.end(); }
