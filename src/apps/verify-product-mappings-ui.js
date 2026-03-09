// Vérification rapide de l'UI Mapping Produits (API + HTML)
// Usage:
//   node src/apps/verify-product-mappings-ui.js
//   MAPPINGS_UI_BASE=http://localhost:8090 node src/apps/verify-product-mappings-ui.js

const BASE = process.env.MAPPINGS_UI_BASE || 'http://localhost:8090';

function fail(msg) {
  console.error(`❌ ${msg}`);
  process.exit(1);
}

async function getJson(pathname) {
  const url = `${BASE}${pathname}`;
  const res = await fetch(url);
  if (!res.ok) fail(`${pathname} -> HTTP ${res.status}`);
  return res.json();
}

async function getText(pathname) {
  const url = `${BASE}${pathname}`;
  const res = await fetch(url);
  if (!res.ok) fail(`${pathname} -> HTTP ${res.status}`);
  return res.text();
}

function asSet(arr) {
  return new Set((arr || []).map(x => String(x)));
}

async function main() {
  console.log(`🔎 Vérification UI Mapping: ${BASE}`);

  const html = await getText('/');
  if (!/<select\s+id="supplier"[^>]*multiple/i.test(html)) {
    fail('Le sélecteur fournisseur n\'est pas en mode multi-sélection dans le HTML servi.');
  }
  console.log('✅ HTML: sélecteur fournisseur en multi-sélection');

  if (!/id="tabNowjobs"/i.test(html) || !/id="nowjobsTab"/i.test(html)) {
    fail('Onglet NOWJOBS absent dans le HTML servi.');
  }
  console.log('✅ HTML: onglet NOWJOBS présent');

  const suppliers = await getJson('/api/suppliers');
  const supplierCodes = asSet(suppliers.map(s => s.code));
  ['DETREMBLEUR', 'COLRUYT', 'COMARCHE', 'CONTE_SALM', 'NOWJOBS'].forEach(code => {
    if (!supplierCodes.has(code)) fail(`Fournisseur manquant dans /api/suppliers: ${code}`);
  });
  console.log('✅ API: fournisseurs DETREMBLEUR/COLRUYT/COMARCHE/CONTE_SALM/NOWJOBS présents');

  const rowsDet = await getJson('/api/supplier-commandes?supplier=DETREMBLEUR');
  const rowsCol = await getJson('/api/supplier-commandes?supplier=COLRUYT');
  const rowsCom = await getJson('/api/supplier-commandes?supplier=COMARCHE');
  const rowsAll = await getJson('/api/supplier-commandes?supplier=DETREMBLEUR,COLRUYT,COMARCHE');

  if (!Array.isArray(rowsDet) || !Array.isArray(rowsCol) || !Array.isArray(rowsCom) || !Array.isArray(rowsAll)) {
    fail('Format inattendu de /api/supplier-commandes');
  }

  // En l'état actuel de la DB, DETREMBLEUR doit être non vide.
  if (rowsDet.length === 0) {
    fail('Aucune ligne pour DETREMBLEUR: l\'onglet Prix de référence restera vide.');
  }
  if (rowsAll.length < rowsDet.length) {
    fail('Le mode multi-fournisseurs renvoie moins de lignes que DETREMBLEUR seul.');
  }
  console.log(`✅ Commandes: DET=${rowsDet.length}, COL=${rowsCol.length}, COM=${rowsCom.length}, ALL=${rowsAll.length}`);

  const sumDet = await getJson('/api/supplier-articles-summary?supplier=DETREMBLEUR');
  const sumAll = await getJson('/api/supplier-articles-summary?supplier=DETREMBLEUR,COLRUYT,COMARCHE');
  if (!Array.isArray(sumDet) || !Array.isArray(sumAll)) {
    fail('Format inattendu de /api/supplier-articles-summary');
  }
  if (sumDet.length === 0) {
    fail('Aucune ligne de synthèse pour DETREMBLEUR.');
  }
  if (sumAll.length < sumDet.length) {
    fail('La synthèse multi-fournisseurs renvoie moins de lignes que DETREMBLEUR seul.');
  }
  console.log(`✅ Synthèse: DET=${sumDet.length}, ALL=${sumAll.length}`);

  const nowjobs = await getJson('/api/nowjobs-prestations');
  if (!Array.isArray(nowjobs)) {
    fail('Format inattendu de /api/nowjobs-prestations');
  }
  if (nowjobs.length === 0) {
    fail('Aucune ligne NOWJOBS trouvée alors que l’onglet NOWJOBS est attendu.');
  }
  console.log(`✅ NOWJOBS: ${nowjobs.length} ligne(s)`);

  console.log('🎯 Vérification OK: l\'affichage ne doit pas être vide si DETREMBLEUR est inclus dans la sélection.');
}

main().catch(err => fail(err.message));
