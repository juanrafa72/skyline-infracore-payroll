-- Contra QUÉ se paga cada renglón de una orden de desembolso.
--
-- «5 días», «3 registros de producción», «4 días × $450.00». Va CONGELADO
-- junto al nombre y al monto (BR-186): el soporte de contabilidad de una orden
-- ya pagada tiene que seguir diciendo lo que decía el día del pago, aunque
-- después alguien corrija la nómina de esa semana.
--
-- Nulo en las órdenes viejas: no se inventa un detalle que nadie congeló.
ALTER TABLE "disbursement_order_item" ADD COLUMN "itemDetailSnapshot" TEXT;
