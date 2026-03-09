import { withClient, syncSupplierProducts } from '/home/stark2026/projects/ardenne-padel-pnl/src/mappings/product-mappings.js';
import { pool } from '/home/stark2026/projects/ardenne-padel-pnl/db.js';
const before = await pool.query(`SELECT COUNT(*) n FROM supplier_products sp JOIN suppliers s ON s.id=sp.supplier_id WHERE s.code='COLRUYT'`);
const touched = await withClient(c => syncSupplierProducts(c, 'COLRUYT'));
const after = await pool.query(`SELECT COUNT(*) n FROM supplier_products sp JOIN suppliers s ON s.id=sp.supplier_id WHERE s.code='COLRUYT'`);
console.log({before:before.rows[0].n,touched,after:after.rows[0].n});
await pool.end();
