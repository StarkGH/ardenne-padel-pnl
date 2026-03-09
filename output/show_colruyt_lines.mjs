import { pool } from '/home/stark2026/projects/ardenne-padel-pnl/db.js';
const c=await pool.connect();
try{
 const inv=await c.query(`SELECT i.id,i.invoice_number FROM invoices i JOIN suppliers s ON s.id=i.supplier_id WHERE s.code='COLRUYT' ORDER BY i.id DESC LIMIT 1`);
 if(!inv.rows.length){console.log('NO_INVOICE'); process.exit(0);} 
 const id=inv.rows[0].id;
 const lines=await c.query(`SELECT id,line_order,product_code,description,quantity_total,net_unit_price,line_total_htva,tva_rate FROM invoice_lines WHERE invoice_id=$1 ORDER BY id`,[id]);
 console.log(JSON.stringify({invoice:inv.rows[0],count:lines.rows.length,lines:lines.rows},null,2));
}finally{c.release(); await pool.end();}
