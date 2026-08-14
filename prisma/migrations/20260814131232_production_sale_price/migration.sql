-- AlterTable
ALTER TABLE "crew_pricing" ADD COLUMN     "customerId" TEXT,
ADD COLUMN     "salePricePerUnit" DECIMAL(18,4);

-- AlterTable
ALTER TABLE "production" ADD COLUMN     "appliedSalePrice" DECIMAL(18,4),
ADD COLUMN     "revenue" DECIMAL(18,2);

-- AddForeignKey
ALTER TABLE "crew_pricing" ADD CONSTRAINT "crew_pricing_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ═════════════════════════════════════════════════════════════
-- PRECIO DE VENTA POR UNIDAD
-- ═════════════════════════════════════════════════════════════

ALTER TABLE crew_pricing
  ADD CONSTRAINT crew_pricing_sale_positive
  CHECK ("salePricePerUnit" IS NULL OR "salePricePerUnit" >= 0);

-- Un precio de venta sin cliente no se le puede cobrar a nadie.
ALTER TABLE crew_pricing
  ADD CONSTRAINT crew_pricing_sale_needs_customer
  CHECK ("salePricePerUnit" IS NULL OR "customerId" IS NOT NULL);

ALTER TABLE production
  ADD CONSTRAINT production_revenue_positive
  CHECK (revenue IS NULL OR revenue >= 0);

-- Si hay venta tiene que haber precio, y al reves.
ALTER TABLE production
  ADD CONSTRAINT production_revenue_needs_price
  CHECK ((revenue IS NULL) = ("appliedSalePrice" IS NULL));
