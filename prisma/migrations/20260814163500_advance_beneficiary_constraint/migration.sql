-- El candado viejo solo conocía dos clases de beneficiario: trabajador y
-- contratista. Al abrir los préstamos a cuadrillas y empresas receptoras
-- seguía vivo y rechazaba los nuevos, aunque la aplicación los diera por
-- válidos. La base tenía razón y el código estaba desactualizado.
--
-- Se reemplaza por el que sí conoce las cuatro clases, ya instalado en la
-- migración anterior (advance_one_beneficiary).

ALTER TABLE advance DROP CONSTRAINT IF EXISTS advance_single_beneficiary;
