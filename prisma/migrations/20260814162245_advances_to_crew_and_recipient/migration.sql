-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "BeneficiaryType" ADD VALUE 'CREW';
ALTER TYPE "BeneficiaryType" ADD VALUE 'RECIPIENT';

-- AlterTable
ALTER TABLE "advance" ADD COLUMN     "crewId" TEXT,
ADD COLUMN     "recipientId" TEXT;

-- AddForeignKey
ALTER TABLE "advance" ADD CONSTRAINT "advance_crewId_fkey" FOREIGN KEY ("crewId") REFERENCES "crew"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "advance" ADD CONSTRAINT "advance_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "payment_recipient"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ═════════════════════════════════════════════════════════════
-- UN PRÉSTAMO TIENE EXACTAMENTE UN BENEFICIARIO
--
-- Sin esto se podría guardar un préstamo apuntando a un trabajador Y a una
-- cuadrilla a la vez, o a ninguno: en el primer caso no se sabria a quien
-- descontarle, en el segundo el dinero salio hacia nadie.
-- ═════════════════════════════════════════════════════════════

ALTER TABLE advance
  ADD CONSTRAINT advance_one_beneficiary CHECK (
    (CASE WHEN "workerId"     IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN "contractorId" IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN "crewId"       IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN "recipientId"  IS NOT NULL THEN 1 ELSE 0 END) = 1
  );

-- Y el beneficiario declarado tiene que coincidir con el que apunta.
ALTER TABLE advance
  ADD CONSTRAINT advance_beneficiary_matches CHECK (
    ("beneficiaryType" = 'WORKER'     AND "workerId"     IS NOT NULL) OR
    ("beneficiaryType" = 'CONTRACTOR' AND "contractorId" IS NOT NULL) OR
    ("beneficiaryType" = 'CREW'       AND "crewId"       IS NOT NULL) OR
    ("beneficiaryType" = 'RECIPIENT'  AND "recipientId"  IS NOT NULL)
  );

-- Un prestamo sin motivo es plata que salio sin explicacion.
ALTER TABLE advance
  ADD CONSTRAINT advance_reason_required CHECK (length(trim(reason)) > 0);
