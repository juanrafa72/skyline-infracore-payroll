-- CreateEnum
CREATE TYPE "ShareType" AS ENUM ('PERCENTAGE', 'PER_UNIT', 'FIXED_DAILY');

-- AlterTable
ALTER TABLE "crew" ADD COLUMN     "leaderName" TEXT,
ADD COLUMN     "tracksInternalAccounting" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "work_entry" ADD COLUMN     "additionalAmount" DECIMAL(18,2),
ADD COLUMN     "additionalNote" TEXT;

-- CreateTable
CREATE TABLE "crew_pricing" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "crewId" TEXT NOT NULL,
    "projectId" TEXT,
    "unitCode" TEXT NOT NULL,
    "unitLabel" TEXT NOT NULL,
    "unitOfMeasure" TEXT NOT NULL DEFAULT 'FOOT',
    "pricePerUnit" DECIMAL(18,4) NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "effectiveTo" DATE,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crew_pricing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crew_member_share" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "crewId" TEXT NOT NULL,
    "workerId" TEXT NOT NULL,
    "shareType" "ShareType" NOT NULL DEFAULT 'PERCENTAGE',
    "value" DECIMAL(18,4) NOT NULL,
    "role" TEXT,
    "effectiveFrom" DATE NOT NULL,
    "effectiveTo" DATE,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crew_member_share_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_week_member" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "payrollWeekId" TEXT NOT NULL,
    "workerId" TEXT NOT NULL,
    "addedById" TEXT,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removedById" TEXT,
    "removedAt" TIMESTAMP(3),
    "removalReason" TEXT,

    CONSTRAINT "payroll_week_member_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "crew_pricing_crewId_effectiveFrom_idx" ON "crew_pricing"("crewId", "effectiveFrom");

-- CreateIndex
CREATE INDEX "crew_member_share_crewId_effectiveFrom_idx" ON "crew_member_share"("crewId", "effectiveFrom");

-- CreateIndex
CREATE INDEX "payroll_week_member_companyId_payrollWeekId_idx" ON "payroll_week_member"("companyId", "payrollWeekId");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_week_member_payrollWeekId_workerId_key" ON "payroll_week_member"("payrollWeekId", "workerId");

-- AddForeignKey
ALTER TABLE "crew_pricing" ADD CONSTRAINT "crew_pricing_crewId_fkey" FOREIGN KEY ("crewId") REFERENCES "crew"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crew_pricing" ADD CONSTRAINT "crew_pricing_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crew_member_share" ADD CONSTRAINT "crew_member_share_crewId_fkey" FOREIGN KEY ("crewId") REFERENCES "crew"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crew_member_share" ADD CONSTRAINT "crew_member_share_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "worker"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_week_member" ADD CONSTRAINT "payroll_week_member_payrollWeekId_fkey" FOREIGN KEY ("payrollWeekId") REFERENCES "payroll_week"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_week_member" ADD CONSTRAINT "payroll_week_member_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "worker"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Un monto adicional siempre viene con su explicación (BR-061).
-- "Si algo cambió toca poner una nota": aquí se hace cumplir, no se sugiere.
ALTER TABLE work_entry
  ADD CONSTRAINT work_entry_additional_needs_note
  CHECK (
    "additionalAmount" IS NULL
    OR ("additionalAmount" >= 0 AND "additionalNote" IS NOT NULL AND length(trim("additionalNote")) > 0)
  );

-- Los precios de una cuadrilla no se solapan para el mismo alcance.
ALTER TABLE crew_pricing
  ADD CONSTRAINT crew_pricing_no_overlap
  EXCLUDE USING gist (
    "crewId" WITH =,
    "unitCode" WITH =,
    COALESCE("projectId", '') WITH =,
    daterange("effectiveFrom", "effectiveTo", '[)') WITH &&
  )
  WHERE (active);

ALTER TABLE crew_pricing ADD CONSTRAINT crew_pricing_price_positive CHECK ("pricePerUnit" >= 0);

-- El reparto interno tampoco se solapa por integrante.
ALTER TABLE crew_member_share
  ADD CONSTRAINT crew_member_share_no_overlap
  EXCLUDE USING gist (
    "crewId" WITH =,
    "workerId" WITH =,
    daterange("effectiveFrom", "effectiveTo", '[)') WITH &&
  )
  WHERE (active);

-- Un porcentaje no puede pasar de 100.
ALTER TABLE crew_member_share
  ADD CONSTRAINT crew_member_share_percentage_range
  CHECK ("shareType" <> 'PERCENTAGE' OR (value >= 0 AND value <= 100));
