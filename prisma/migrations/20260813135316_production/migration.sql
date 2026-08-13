-- CreateTable
CREATE TABLE "production" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "payrollWeekId" TEXT,
    "projectId" TEXT,
    "crewId" TEXT,
    "contractorId" TEXT,
    "productionDate" DATE NOT NULL,
    "unitCode" TEXT NOT NULL,
    "unitLabel" TEXT NOT NULL,
    "unitOfMeasure" TEXT NOT NULL DEFAULT 'FOOT',
    "quantity" DECIMAL(14,2) NOT NULL,
    "appliedPrice" DECIMAL(18,4) NOT NULL,
    "pricingId" TEXT,
    "amount" DECIMAL(18,2) NOT NULL,
    "sourceType" "SourceType" NOT NULL DEFAULT 'MANUAL',
    "externalRef" TEXT,
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "production_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "production_companyId_productionDate_idx" ON "production"("companyId", "productionDate");

-- CreateIndex
CREATE INDEX "production_companyId_payrollWeekId_idx" ON "production"("companyId", "payrollWeekId");

-- CreateIndex
CREATE INDEX "production_crewId_productionDate_idx" ON "production"("crewId", "productionDate");

-- AddForeignKey
ALTER TABLE "production" ADD CONSTRAINT "production_payrollWeekId_fkey" FOREIGN KEY ("payrollWeekId") REFERENCES "payroll_week"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production" ADD CONSTRAINT "production_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production" ADD CONSTRAINT "production_crewId_fkey" FOREIGN KEY ("crewId") REFERENCES "crew"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production" ADD CONSTRAINT "production_contractorId_fkey" FOREIGN KEY ("contractorId") REFERENCES "contractor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production" ADD CONSTRAINT "production_pricingId_fkey" FOREIGN KEY ("pricingId") REFERENCES "crew_pricing"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Cantidades y precios no negativos: una producción negativa sería una
-- corrección disfrazada, y esas van como ajuste explícito.
ALTER TABLE production ADD CONSTRAINT production_quantity_positive CHECK (quantity > 0);
ALTER TABLE production ADD CONSTRAINT production_price_positive CHECK ("appliedPrice" >= 0);
ALTER TABLE production ADD CONSTRAINT production_amount_positive CHECK (amount >= 0);
