import { withClient, syncSupplierProducts } from '/home/stark2026/projects/ardenne-padel-pnl/src/mappings/product-mappings.js';
const out = await withClient(async (c) => ({
  colruyt: await syncSupplierProducts(c, 'COLRUYT'),
  comarche: await syncSupplierProducts(c, 'COMARCHE'),
}));
console.log(JSON.stringify(out, null, 2));
