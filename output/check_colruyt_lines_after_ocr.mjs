import { pool } from '/home/stark2026/projects/ardenne-padel-pnl/db.js';
const c=await pool.connect();
try{
 const inv=await c.query(`SELECT i.id,i.invoice_number,i.invoice_date,i.total_a_payer FROM invoices i JOIN suppliers s ON s.id=i.supplier_id WHERE s.code='COLRUYT' ORDER BY i.id DESC LIMIT 1`);
 const id=inv.rows[0].id;
 const cnt=await c.query(`SELECT COUNT(*) n FROM invoice_lines WHERE invoice_id=$1`,[id]);
 const sample=await c.query(`SELECT product_code, description, quantity_total, net_unit_price, line_total_htva FROM invoice_lines WHERE invoice_id=$1 ORDER BY line_order NULLS LAST, id LIMIT 12`,[id]);
 console.log(JSON.stringify({invoice:inv.rows[0], line_count:Number(cnt.rows[0].n), sample:sample.rows},null,2));
}finally{c.release(); await pool.end();}
