-- AlterTable
ALTER TABLE "payroll_line" ADD COLUMN     "billedRate" DECIMAL(18,2),
ADD COLUMN     "billingRateSourceId" TEXT,
ADD COLUMN     "revenue" DECIMAL(18,2);

-- AlterTable
ALTER TABLE "worker_payroll" ADD COLUMN     "daysWithoutBillingRate" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "revenueTotal" DECIMAL(18,2);

-- CreateTable
CREATE TABLE "billing_rate" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "projectId" TEXT,
    "operationId" TEXT,
    "crewId" TEXT,
    "shift" "Shift" NOT NULL DEFAULT 'ANY',
    "rateType" "RateType" NOT NULL DEFAULT 'DAILY',
    "amount" DECIMAL(18,2) NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "effectiveTo" DATE,
    "sourceNote" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "billing_rate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "billing_rate_companyId_customerId_effectiveFrom_idx" ON "billing_rate"("companyId", "customerId", "effectiveFrom");

-- CreateIndex
CREATE INDEX "billing_rate_companyId_active_idx" ON "billing_rate"("companyId", "active");

-- AddForeignKey
ALTER TABLE "payroll_line" ADD CONSTRAINT "payroll_line_billingRateSourceId_fkey" FOREIGN KEY ("billingRateSourceId") REFERENCES "billing_rate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_rate" ADD CONSTRAINT "billing_rate_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_rate" ADD CONSTRAINT "billing_rate_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_rate" ADD CONSTRAINT "billing_rate_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_rate" ADD CONSTRAINT "billing_rate_operationId_fkey" FOREIGN KEY ("operationId") REFERENCES "operation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_rate" ADD CONSTRAINT "billing_rate_crewId_fkey" FOREIGN KEY ("crewId") REFERENCES "crew"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ═════════════════════════════════════════════════════════════
-- PROTECCIONES DE LA TARIFA DE VENTA
--
-- Las mismas que ya protegen la tarifa de costo. La venta decide el margen y
-- lo que se le factura al cliente: merece exactamente el mismo cuidado.
-- ═════════════════════════════════════════════════════════════

ALTER TABLE billing_rate ADD CONSTRAINT billing_rate_amount_positive CHECK (amount >= 0);

-- La vigencia no puede terminar antes de empezar.
ALTER TABLE billing_rate
  ADD CONSTRAINT billing_rate_dates_ordered
  CHECK ("effectiveTo" IS NULL OR "effectiveTo" >= "effectiveFrom");

-- Dos tarifas de venta del MISMO alcance no pueden convivir en la misma fecha.
-- Sin esto, un dia podria facturarse a dos precios distintos segun cual leyera
-- primero la consulta, y el margen dependeria del azar.
ALTER TABLE billing_rate
  ADD CONSTRAINT billing_rate_no_overlap
  EXCLUDE USING gist (
    "companyId"   WITH =,
    "customerId"  WITH =,
    "rateType"    WITH =,
    shift         WITH =,
    COALESCE("projectId",   '') WITH =,
    COALESCE("operationId", '') WITH =,
    COALESCE("crewId",      '') WITH =,
    daterange("effectiveFrom", "effectiveTo", '[)') WITH &&
  )
  WHERE (active);

-- Coherencia de la venta congelada en cada linea.
ALTER TABLE payroll_line ADD CONSTRAINT payroll_line_revenue_positive CHECK (revenue IS NULL OR revenue >= 0);
ALTER TABLE payroll_line ADD CONSTRAINT payroll_line_billed_rate_positive CHECK ("billedRate" IS NULL OR "billedRate" >= 0);

-- Si hay venta tiene que haber tarifa, y al reves. Una sola de las dos seria
-- una cifra sin sustento en un estado de resultados.
ALTER TABLE payroll_line
  ADD CONSTRAINT payroll_line_revenue_needs_rate
  CHECK ((revenue IS NULL) = ("billedRate" IS NULL));

ALTER TABLE worker_payroll
  ADD CONSTRAINT worker_payroll_revenue_positive CHECK ("revenueTotal" IS NULL OR "revenueTotal" >= 0);
ALTER TABLE worker_payroll
  ADD CONSTRAINT worker_payroll_missing_billing_positive CHECK ("daysWithoutBillingRate" >= 0);
