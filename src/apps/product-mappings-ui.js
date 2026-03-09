import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { migrate, pool } from '../../db.js';
import {
  withClient,
  listSuppliers,
  syncNextoreProducts,
  syncSupplierProducts,
  listNextoreCategories,
  listNextoreProducts,
  listSupplierProducts,
  listMappingsForNextoreProduct,
  listSupplierCommandesWithReference,
  listSupplierArticlesSummaryWithReference,
  listInvoicesForSuppliers,
  getInvoiceDetails,
  listNowjobsPrestations,
  listNextoreCostOverview,
  listInventoryOverview,
  listInventoryPurchaseLines,
  listInventoryControlRows,
  listInventorySalesLines,
  listInventoryCountHistory,
  saveInventoryControlCounts,
  getInventoryFinancialDocument,
  listBarRentabilityDaily,
  upsertSupplierReferencePrice,
  createProductMapping,
  createProductMappingsBulk,
  deleteProductMapping,
} from '../mappings/product-mappings.js';

dotenv.config();

const PORT = Number(process.env.MAPPINGS_UI_PORT || 8090);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const HTML_PATH = path.join(__dirname, 'product-mappings-ui.html');

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 2_000_000) reject(new Error('Payload trop volumineux'));
    });
    req.on('end', () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error('JSON invalide'));
      }
    });
    req.on('error', reject);
  });
}

function parseSupplierCodes(raw, fallback = ['DETREMBLEUR']) {
  if (Array.isArray(raw)) {
    const codes = raw.map(x => String(x || '').toUpperCase().trim()).filter(Boolean);
    return codes.length ? [...new Set(codes)] : fallback;
  }
  const txt = String(raw || '').trim();
  if (!txt) return fallback;
  const codes = txt.split(',').map(x => x.toUpperCase().trim()).filter(Boolean);
  return codes.length ? [...new Set(codes)] : fallback;
}

async function handleApi(req, res, urlObj) {
  const { pathname, searchParams } = urlObj;

  if (req.method === 'GET' && pathname === '/api/suppliers') {
    return sendJson(res, 200, await withClient(listSuppliers));
  }

  if (req.method === 'POST' && pathname === '/api/sync') {
    const payload = await readJsonBody(req);
    const supplierCodes = parseSupplierCodes(payload.supplier_codes || payload.supplier_code, ['DETREMBLEUR']);
    const result = await withClient(async client => {
      const nextoreCount = await syncNextoreProducts(client);
      const supplierCounts = [];
      for (const code of supplierCodes) {
        supplierCounts.push({
          supplierCode: code,
          supplierCount: await syncSupplierProducts(client, code),
        });
      }
      return { nextoreCount, supplierCounts };
    });
    return sendJson(res, 200, result);
  }

  if (req.method === 'GET' && pathname === '/api/nextore-products') {
    const includeMatchedRaw = String(searchParams.get('include_matched') ?? '1').toLowerCase();
    const includeMatched =
      includeMatchedRaw === '1' || includeMatchedRaw === 'true' || includeMatchedRaw === 'yes';
    return sendJson(
      res,
      200,
      await withClient(c =>
        listNextoreProducts(
          c,
          searchParams.get('q') || '',
          searchParams.get('category') || '',
          includeMatched
        )
      )
    );
  }

  if (req.method === 'GET' && pathname === '/api/nextore-categories') {
    return sendJson(res, 200, await withClient(listNextoreCategories));
  }

  if (req.method === 'GET' && pathname === '/api/supplier-products') {
    const supplierCodes = parseSupplierCodes(searchParams.get('supplier'), ['DETREMBLEUR']);
    return sendJson(res, 200, await withClient(c => listSupplierProducts(c, supplierCodes, searchParams.get('q') || '')));
  }

  if (req.method === 'GET' && pathname === '/api/mappings') {
    const nextoreId = Number(searchParams.get('nextore_id'));
    if (!Number.isInteger(nextoreId)) return sendJson(res, 400, { error: 'nextore_id invalide' });
    return sendJson(res, 200, await withClient(c => listMappingsForNextoreProduct(c, nextoreId)));
  }

  if (req.method === 'GET' && pathname === '/api/supplier-commandes') {
    const supplierCodes = parseSupplierCodes(searchParams.get('supplier'), ['DETREMBLEUR']);
    return sendJson(
      res,
      200,
      await withClient(c => listSupplierCommandesWithReference(c, supplierCodes, searchParams.get('q') || ''))
    );
  }

  if (req.method === 'GET' && pathname === '/api/supplier-articles-summary') {
    const supplierCodes = parseSupplierCodes(searchParams.get('supplier'), ['DETREMBLEUR']);
    return sendJson(
      res,
      200,
      await withClient(c => listSupplierArticlesSummaryWithReference(c, supplierCodes, searchParams.get('q') || ''))
    );
  }

  if (req.method === 'GET' && pathname === '/api/invoices') {
    const supplierCodes = parseSupplierCodes(searchParams.get('supplier'), ['DETREMBLEUR']);
    return sendJson(res, 200, await withClient(c => listInvoicesForSuppliers(c, supplierCodes)));
  }

  if (req.method === 'GET' && pathname === '/api/invoice-details') {
    const invoiceId = Number(searchParams.get('id'));
    if (!Number.isInteger(invoiceId)) return sendJson(res, 400, { error: 'id invalide' });
    const data = await withClient(c => getInvoiceDetails(c, invoiceId));
    if (!data) return sendJson(res, 404, { error: 'Facture introuvable' });
    return sendJson(res, 200, data);
  }

  if (req.method === 'GET' && pathname === '/api/nowjobs-prestations') {
    return sendJson(res, 200, await withClient(c => listNowjobsPrestations(c, searchParams.get('q') || '')));
  }

  if (req.method === 'GET' && pathname === '/api/nextore-cost-overview') {
    return sendJson(res, 200, await withClient(c => listNextoreCostOverview(c)));
  }

  if (req.method === 'GET' && pathname === '/api/inventory-overview') {
    const supplierCodes = parseSupplierCodes(searchParams.get('supplier'), ['DETREMBLEUR']);
    return sendJson(res, 200, await withClient(c => listInventoryOverview(c, supplierCodes)));
  }

  if (req.method === 'GET' && pathname === '/api/inventory-purchase-lines') {
    const supplierCode = String(searchParams.get('supplier_code') || '');
    const supplierProductCode = String(searchParams.get('supplier_product_code') || '');
    const supplierProductLabel = String(searchParams.get('supplier_product_label') || '');
    return sendJson(
      res,
      200,
      await withClient(c => listInventoryPurchaseLines(c, supplierCode, supplierProductCode, supplierProductLabel))
    );
  }

  if (req.method === 'GET' && pathname === '/api/inventory-control') {
    const supplierCodes = parseSupplierCodes(searchParams.get('supplier'), ['DETREMBLEUR']);
    return sendJson(res, 200, await withClient(c => listInventoryControlRows(c, supplierCodes)));
  }

  if (req.method === 'GET' && pathname === '/api/inventory-sales-lines') {
    const supplierCode = String(searchParams.get('supplier_code') || '');
    const supplierProductCode = String(searchParams.get('supplier_product_code') || '');
    const supplierProductLabel = String(searchParams.get('supplier_product_label') || '');
    return sendJson(
      res,
      200,
      await withClient(c => listInventorySalesLines(c, supplierCode, supplierProductCode, supplierProductLabel))
    );
  }

  if (req.method === 'GET' && pathname === '/api/inventory-count-history') {
    const supplierCode = String(searchParams.get('supplier_code') || '');
    const supplierProductCode = String(searchParams.get('supplier_product_code') || '');
    const supplierProductLabel = String(searchParams.get('supplier_product_label') || '');
    return sendJson(
      res,
      200,
      await withClient(c => listInventoryCountHistory(c, supplierCode, supplierProductCode, supplierProductLabel))
    );
  }

  if (req.method === 'GET' && pathname === '/api/inventory-financial-document') {
    const countedOn = String(searchParams.get('counted_on') || '');
    return sendJson(res, 200, await withClient(c => getInventoryFinancialDocument(c, countedOn || null)));
  }

  if (req.method === 'POST' && pathname === '/api/inventory-control-counts') {
    const payload = await readJsonBody(req);
    const entries = Array.isArray(payload.entries) ? payload.entries : [];
    return sendJson(res, 200, await withClient(c => saveInventoryControlCounts(c, entries)));
  }

  if (req.method === 'GET' && pathname === '/api/bar-rentability-daily') {
    return sendJson(res, 200, await withClient(c => listBarRentabilityDaily(c)));
  }

  if (req.method === 'GET' && pathname === '/api/invoice-file') {
    const invoiceId = Number(searchParams.get('id'));
    if (!Number.isInteger(invoiceId)) return sendJson(res, 400, { error: 'id invalide' });
    const data = await withClient(c => getInvoiceDetails(c, invoiceId));
    if (!data || !data.source_file) return sendJson(res, 404, { error: 'Fichier source introuvable' });
    if (!fs.existsSync(data.source_file)) return sendJson(res, 404, { error: 'Fichier source absent sur disque' });
    const ext = path.extname(data.source_file).toLowerCase();
    const ct =
      ext === '.pdf' ? 'application/pdf' :
      (ext === '.jpg' || ext === '.jpeg') ? 'image/jpeg' :
      ext === '.xlsx' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' :
      ext === '.xls' ? 'application/vnd.ms-excel' :
      ext === '.csv' ? 'text/csv; charset=utf-8' :
      ext === '.png' ? 'image/png' :
      'application/octet-stream';
    res.writeHead(200, {
      'Content-Type': ct,
      'Cache-Control': 'no-cache',
    });
    fs.createReadStream(data.source_file).pipe(res);
    return;
  }

  if (req.method === 'POST' && pathname === '/api/reference-price') {
    const payload = await readJsonBody(req);
    const supplierCode = String(payload.supplier_code || 'DETREMBLEUR').toUpperCase();
    const supplierProductCode = String(payload.supplier_product_code || '');
    const referenceUnitPrice = payload.reference_unit_price;
    const data = await withClient(c =>
      upsertSupplierReferencePrice(c, supplierCode, supplierProductCode, referenceUnitPrice)
    );
    return sendJson(res, 200, { ok: true, ...data });
  }

  if (req.method === 'POST' && pathname === '/api/mappings') {
    const payload = await readJsonBody(req);
    const data = await withClient(c => createProductMapping(c, payload));
    if (!data) return sendJson(res, 200, { inserted: false, message: 'Déjà existant' });
    return sendJson(res, 201, { inserted: true, id: data.id });
  }

  if (req.method === 'POST' && pathname === '/api/mappings/bulk') {
    const payload = await readJsonBody(req);
    const mappings = Array.isArray(payload.mappings) ? payload.mappings : [];
    const data = await withClient(c => createProductMappingsBulk(c, mappings));
    return sendJson(res, 200, data);
  }

  if (req.method === 'DELETE' && pathname.startsWith('/api/mappings/')) {
    const id = Number(pathname.split('/').pop());
    if (!Number.isInteger(id)) return sendJson(res, 400, { error: 'id invalide' });
    return sendJson(res, 200, { deleted: await withClient(c => deleteProductMapping(c, id)) });
  }

  return false;
}

async function main() {
  await migrate();
  const html = fs.readFileSync(HTML_PATH, 'utf8');

  const server = http.createServer(async (req, res) => {
    try {
      const urlObj = new URL(req.url, `http://${req.headers.host}`);
      if (urlObj.pathname.startsWith('/api/')) {
        const handled = await handleApi(req, res, urlObj);
        if (handled === false) return sendJson(res, 404, { error: 'Not found' });
        return;
      }

      if (req.method === 'GET' && urlObj.pathname === '/') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(html);
        return;
      }

      sendJson(res, 404, { error: 'Not found' });
    } catch (err) {
      sendJson(res, 500, { error: err.message });
    }
  });

  server.listen(PORT, () => {
    console.log(`✅ Product mappings UI: http://localhost:${PORT}`);
  });
}

main().catch(async err => {
  console.error('❌ Erreur:', err.message);
  await pool.end();
  process.exit(1);
});
