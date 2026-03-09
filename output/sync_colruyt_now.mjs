import { withClient, syncSupplierProducts } from '/home/stark2026/projects/ardenne-padel-pnl/src/mappings/product-mappings.js';
console.log(await withClient(c => syncSupplierProducts(c, 'COLRUYT')));
