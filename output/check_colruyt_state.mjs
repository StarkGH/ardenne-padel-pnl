import { pool } from '/home/stark2026/projects/ardenne-padel-pnl/db.js';
const c=await pool.connect();
try{
  const a=await c.query(`SELECT COUNT(*) n FROM invoices i JOIN suppliers s ON s.id=i.supplier_id WHERE s.code='COLRUYT'`);
  const b=await c.query(`SELECT COUNT(*) n FROM invoice_lines il JOIN invoices i ON i.id=il.invoice_id JOIN suppliers s ON s.id=i.supplier_id WHERE s.code='COLRUYT'`);
  const c1=await c.query(`SELECT COUNT(*) n FROM supplier_products sp JOIN suppliers s ON s.id=sp.supplier_id WHERE s.code='COLRUYT'`);
  const d=await c.query(`SELECT il.product_code, il.description, il.quantity_total, il.net_unit_price, il.line_total_htva FROM invoice_lines il JOIN invoices i ON i.id=il.invoice_id JOIN suppliers s ON s.id=i.supplier_id WHERE s.code='COLRUYT' ORDER BY il.id LIMIT 10`);
  console.log(JSON.stringify({invoices:a.rows[0].n, lines:b.rows[0].n, supplier_products:c1.rows[0].n, sample:d.rows},null,2));
}finally{c.release(); await pool.end();}
