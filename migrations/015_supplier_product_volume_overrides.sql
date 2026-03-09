-- 015_supplier_product_volume_overrides.sql
-- Stocke un volume unitaire manuel quand le parsing du libellé ne suffit pas.

ALTER TABLE supplier_products
  ADD COLUMN IF NOT EXISTS volume_override VARCHAR(30);

-- DETREMBLEUR: corrections manuelles de volume unitaire
UPDATE supplier_products sp
SET volume_override = upd.volume_override,
    updated_at = NOW()
FROM (
  VALUES
    ('LA TORRE CHARDONNAY BLANC', '75 cl'),
    ('LA TORRE NEGROAMARO IGP SALENTO', '75 cl'),
    ('LA TORRE ROSATO IGP SALENTO 75 CL RS', '75 cl'),
    ('SCHW EPPES MOJITO/PINK/SPRITZ 24 X 25', '25 cl'),
    ('ST HUBERTUS BLONDE - AMBREE 12 X 33 C', '33 cl'),
    ('VILLERS CITRON 6 X 1 LITRE', '100 cl'),
    ('VILLERS ORANGE 6 X 1 LITRE', '100 cl')
) AS upd(label_key, volume_override),
suppliers s
WHERE s.code = 'DETREMBLEUR'
  AND s.id = sp.supplier_id
  AND UPPER(sp.label) LIKE '%' || upd.label_key || '%';
