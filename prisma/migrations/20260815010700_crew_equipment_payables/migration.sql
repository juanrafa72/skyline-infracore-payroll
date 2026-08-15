-- AlterTable
ALTER TABLE "work_entry" ADD COLUMN     "isControlOnly" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "crew_payroll" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "payrollWeekId" TEXT NOT NULL,
    "crewId" TEXT NOT NULL,
    "status" "PayrollStatus" NOT NULL DEFAULT 'DRAFT',
    "contractorId" TEXT,
    "crewNameSnapshot" TEXT NOT NULL,
    "contractorNameSnapshot" TEXT,
    "productionTotal" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "productionCount" INTEGER NOT NULL DEFAULT 0,
    "calculationHash" TEXT,
    "preparedById" TEXT,
    "preparedAt" TIMESTAMP(3),
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "approvalInvalidatedAt" TIMESTAMP(3),
    "approvalInvalidatedReason" TEXT,
    "selfApproved" BOOLEAN NOT NULL DEFAULT false,
    "rejectedById" TEXT,
    "rejectedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "paymentId" TEXT,
    "paymentRecipientId" TEXT,
    "recipientAssignedById" TEXT,
    "recipientAssignedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crew_payroll_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "equipment_payroll" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "payrollWeekId" TEXT NOT NULL,
    "equipmentId" TEXT NOT NULL,
    "status" "PayrollStatus" NOT NULL DEFAULT 'DRAFT',
    "equipmentNameSnapshot" TEXT NOT NULL,
    "vendorId" TEXT,
    "vendorNameSnapshot" TEXT,
    "daysTotal" INTEGER NOT NULL DEFAULT 0,
    "appliedDailyCost" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "totalAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "calculationHash" TEXT,
    "preparedById" TEXT,
    "preparedAt" TIMESTAMP(3),
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "approvalInvalidatedAt" TIMESTAMP(3),
    "approvalInvalidatedReason" TEXT,
    "selfApproved" BOOLEAN NOT NULL DEFAULT false,
    "rejectedById" TEXT,
    "rejectedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "paymentId" TEXT,
    "paymentRecipientId" TEXT,
    "recipientAssignedById" TEXT,
    "recipientAssignedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "equipment_payroll_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "equipment_entry" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "payrollWeekId" TEXT NOT NULL,
    "equipmentId" TEXT NOT NULL,
    "workDate" DATE NOT NULL,
    "projectId" TEXT,
    "crewId" TEXT,
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "equipment_entry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "crew_payroll_paymentId_key" ON "crew_payroll"("paymentId");

-- CreateIndex
CREATE INDEX "crew_payroll_companyId_payrollWeekId_status_idx" ON "crew_payroll"("companyId", "payrollWeekId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "crew_payroll_companyId_payrollWeekId_crewId_key" ON "crew_payroll"("companyId", "payrollWeekId", "crewId");

-- CreateIndex
CREATE UNIQUE INDEX "equipment_payroll_paymentId_key" ON "equipment_payroll"("paymentId");

-- CreateIndex
CREATE INDEX "equipment_payroll_companyId_payrollWeekId_status_idx" ON "equipment_payroll"("companyId", "payrollWeekId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "equipment_payroll_companyId_payrollWeekId_equipmentId_key" ON "equipment_payroll"("companyId", "payrollWeekId", "equipmentId");

-- CreateIndex
CREATE INDEX "equipment_entry_companyId_payrollWeekId_idx" ON "equipment_entry"("companyId", "payrollWeekId");

-- CreateIndex
CREATE UNIQUE INDEX "equipment_entry_companyId_equipmentId_workDate_key" ON "equipment_entry"("companyId", "equipmentId", "workDate");

-- AddForeignKey
ALTER TABLE "crew_payroll" ADD CONSTRAINT "crew_payroll_payrollWeekId_fkey" FOREIGN KEY ("payrollWeekId") REFERENCES "payroll_week"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crew_payroll" ADD CONSTRAINT "crew_payroll_crewId_fkey" FOREIGN KEY ("crewId") REFERENCES "crew"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crew_payroll" ADD CONSTRAINT "crew_payroll_contractorId_fkey" FOREIGN KEY ("contractorId") REFERENCES "contractor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crew_payroll" ADD CONSTRAINT "crew_payroll_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crew_payroll" ADD CONSTRAINT "crew_payroll_paymentRecipientId_fkey" FOREIGN KEY ("paymentRecipientId") REFERENCES "payment_recipient"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipment_payroll" ADD CONSTRAINT "equipment_payroll_payrollWeekId_fkey" FOREIGN KEY ("payrollWeekId") REFERENCES "payroll_week"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipment_payroll" ADD CONSTRAINT "equipment_payroll_equipmentId_fkey" FOREIGN KEY ("equipmentId") REFERENCES "equipment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipment_payroll" ADD CONSTRAINT "equipment_payroll_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipment_payroll" ADD CONSTRAINT "equipment_payroll_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipment_payroll" ADD CONSTRAINT "equipment_payroll_paymentRecipientId_fkey" FOREIGN KEY ("paymentRecipientId") REFERENCES "payment_recipient"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipment_entry" ADD CONSTRAINT "equipment_entry_payrollWeekId_fkey" FOREIGN KEY ("payrollWeekId") REFERENCES "payroll_week"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipment_entry" ADD CONSTRAINT "equipment_entry_equipmentId_fkey" FOREIGN KEY ("equipmentId") REFERENCES "equipment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipment_entry" ADD CONSTRAINT "equipment_entry_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipment_entry" ADD CONSTRAINT "equipment_entry_crewId_fkey" FOREIGN KEY ("crewId") REFERENCES "crew"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────
-- Candados: una liquidación pagada de cuadrilla o de equipo es inmutable,
-- igual que la de una persona. Solo avanza el cierre contable
-- PAID → RECONCILED → CLOSED. (RETURN OLD en DELETE: devolver NULL desde un
-- BEFORE DELETE cancela el borrado en silencio — trampa ya vivida.)
-- ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION crew_payroll_immutable_when_paid()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.status IN ('PAID', 'RECONCILED', 'CLOSED') THEN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'No se puede borrar una liquidacion de cuadrilla en estado %', OLD.status::text
        USING ERRCODE = 'insufficient_privilege';
    END IF;

    IF NEW.status IS DISTINCT FROM OLD.status
       AND NOT (
         (OLD.status = 'PAID'       AND NEW.status = 'RECONCILED') OR
         (OLD.status = 'RECONCILED' AND NEW.status = 'CLOSED')
       ) THEN
      RAISE EXCEPTION 'Transicion no permitida desde % hacia %', OLD.status::text, NEW.status::text
        USING ERRCODE = 'insufficient_privilege';
    END IF;

    IF NEW."productionTotal"    IS DISTINCT FROM OLD."productionTotal"
    OR NEW."productionCount"    IS DISTINCT FROM OLD."productionCount"
    OR NEW."crewId"             IS DISTINCT FROM OLD."crewId"
    OR NEW."contractorId"       IS DISTINCT FROM OLD."contractorId"
    OR NEW."payrollWeekId"      IS DISTINCT FROM OLD."payrollWeekId"
    OR NEW."paymentRecipientId" IS DISTINCT FROM OLD."paymentRecipientId"
    THEN
      RAISE EXCEPTION 'Una liquidacion de cuadrilla en estado % es inmutable.', OLD.status::text
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER crew_payroll_immutable
  BEFORE UPDATE OR DELETE ON crew_payroll
  FOR EACH ROW EXECUTE FUNCTION crew_payroll_immutable_when_paid();

CREATE OR REPLACE FUNCTION equipment_payroll_immutable_when_paid()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.status IN ('PAID', 'RECONCILED', 'CLOSED') THEN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'No se puede borrar una liquidacion de equipo en estado %', OLD.status::text
        USING ERRCODE = 'insufficient_privilege';
    END IF;

    IF NEW.status IS DISTINCT FROM OLD.status
       AND NOT (
         (OLD.status = 'PAID'       AND NEW.status = 'RECONCILED') OR
         (OLD.status = 'RECONCILED' AND NEW.status = 'CLOSED')
       ) THEN
      RAISE EXCEPTION 'Transicion no permitida desde % hacia %', OLD.status::text, NEW.status::text
        USING ERRCODE = 'insufficient_privilege';
    END IF;

    IF NEW."totalAmount"        IS DISTINCT FROM OLD."totalAmount"
    OR NEW."daysTotal"          IS DISTINCT FROM OLD."daysTotal"
    OR NEW."appliedDailyCost"   IS DISTINCT FROM OLD."appliedDailyCost"
    OR NEW."equipmentId"        IS DISTINCT FROM OLD."equipmentId"
    OR NEW."vendorId"           IS DISTINCT FROM OLD."vendorId"
    OR NEW."payrollWeekId"      IS DISTINCT FROM OLD."payrollWeekId"
    OR NEW."paymentRecipientId" IS DISTINCT FROM OLD."paymentRecipientId"
    THEN
      RAISE EXCEPTION 'Una liquidacion de equipo en estado % es inmutable.', OLD.status::text
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER equipment_payroll_immutable
  BEFORE UPDATE OR DELETE ON equipment_payroll
  FOR EACH ROW EXECUTE FUNCTION equipment_payroll_immutable_when_paid();

-- Nombres congelados no vacíos y montos que no pueden ser negativos.
ALTER TABLE crew_payroll
  ADD CONSTRAINT crew_payroll_name_required CHECK (length(trim("crewNameSnapshot")) > 0);
ALTER TABLE crew_payroll
  ADD CONSTRAINT crew_payroll_totals_positive CHECK ("productionTotal" >= 0 AND "productionCount" >= 0);
ALTER TABLE equipment_payroll
  ADD CONSTRAINT equipment_payroll_name_required CHECK (length(trim("equipmentNameSnapshot")) > 0);
ALTER TABLE equipment_payroll
  ADD CONSTRAINT equipment_payroll_amounts CHECK ("daysTotal" >= 0 AND "appliedDailyCost" >= 0 AND "totalAmount" >= 0);
