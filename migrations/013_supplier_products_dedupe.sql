-- 013_supplier_products_dedupe.sql
-- Objectif:
-- 1) Fusionner les doublons supplier_products ayant le même (supplier_id, supplier_product_code) non vide
-- 2) Conserver les mappings existants en les réaffectant vers la ligne conservée
-- 3) Empêcher les futurs doublons sur code fournisseur non vide

BEGIN;

-- Map old_id -> keep_id pour les lignes dupliquées par code fournisseur
CREATE TEMP TABLE _sp_dup_map ON COMMIT DROP AS
WITH ranked AS (
  SELECT
    sp.id,
    sp.supplier_id,
    sp.supplier_product_code,
    ROW_NUMBER() OVER (
      PARTITION BY sp.supplier_id, sp.supplier_product_code
      ORDER BY sp.updated_at DESC NULLS LAST, sp.id DESC
    ) AS rn
  FROM supplier_products sp
  WHERE sp.supplier_product_code IS NOT NULL
    AND TRIM(sp.supplier_product_code) <> ''
),
keepers AS (
  SELECT supplier_id, supplier_product_code, id AS keep_id
  FROM ranked
  WHERE rn = 1
),
dups AS (
  SELECT supplier_id, supplier_product_code, id AS old_id
  FROM ranked
  WHERE rn > 1
)
SELECT d.old_id, k.keep_id
FROM dups d
JOIN keepers k USING (supplier_id, supplier_product_code);

-- Éviter les collisions de contrainte unique dans product_mappings après réaffectation
DELETE FROM product_mappings pm_old
USING _sp_dup_map m
WHERE pm_old.supplier_product_id = m.old_id
  AND EXISTS (
    SELECT 1
    FROM product_mappings pm_keep
    WHERE pm_keep.supplier_product_id = m.keep_id
      AND pm_keep.nextore_product_id = pm_old.nextore_product_id
      AND pm_keep.mapping_type = pm_old.mapping_type
      AND COALESCE(pm_keep.quantity_value, -1) = COALESCE(pm_old.quantity_value, -1)
      AND COALESCE(pm_keep.quantity_unit, '') = COALESCE(pm_old.quantity_unit, '')
      AND pm_keep.id <> pm_old.id
  );

-- Réaffecter les mappings restants vers la ligne conservée
UPDATE product_mappings pm
SET supplier_product_id = m.keep_id
FROM _sp_dup_map m
WHERE pm.supplier_product_id = m.old_id;

-- Supprimer les lignes dupliquées obsolètes
DELETE FROM supplier_products sp
USING _sp_dup_map m
WHERE sp.id = m.old_id;

-- Garantir l'unicité du code fournisseur non vide par fournisseur
CREATE UNIQUE INDEX IF NOT EXISTS uq_supplier_products_supplier_code_nonempty
  ON supplier_products (supplier_id, supplier_product_code)
  WHERE supplier_product_code IS NOT NULL
    AND TRIM(supplier_product_code) <> '';

COMMIT;
