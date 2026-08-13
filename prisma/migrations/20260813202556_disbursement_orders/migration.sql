-- CreateEnum
CREATE TYPE "DisbursementOrderStatus" AS ENUM ('PENDING_PAYMENT', 'PARTIALLY_PAID', 'PAID', 'CANCELLED');

-- CreateEnum
CREATE TYPE "DisbursementDocumentKind" AS ENUM ('PAYMENT_PROOF', 'ORDER_PDF', 'OTHER');

-- AlterTable
ALTER TABLE "payment" ADD COLUMN     "disbursementOrderId" TEXT;

-- AlterTable
ALTER TABLE "worker_payroll" ADD COLUMN     "paymentRecipientId" TEXT,
ADD COLUMN     "recipientAssignedAt" TIMESTAMP(3),
ADD COLUMN     "recipientAssignedById" TEXT;

-- CreateTable
CREATE TABLE "payment_recipient" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "legalName" TEXT,
    "taxId" TEXT,
    "contactName" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "paymentMethodDefault" "PaymentMethod",
    "bankName" TEXT,
    "bankAccountLast4" TEXT,
    "paymentDetails" TEXT,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_recipient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "disbursement_order" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "payrollWeekId" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "orderNumber" TEXT NOT NULL,
    "status" "DisbursementOrderStatus" NOT NULL DEFAULT 'PENDING_PAYMENT',
    "workerCount" INTEGER NOT NULL DEFAULT 0,
    "totalAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "amountPaid" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "companyNameSnapshot" TEXT NOT NULL,
    "recipientNameSnapshot" TEXT NOT NULL,
    "recipientTaxIdSnapshot" TEXT,
    "weekLabelSnapshot" TEXT NOT NULL,
    "periodStart" DATE NOT NULL,
    "periodEnd" DATE NOT NULL,
    "preparedByName" TEXT,
    "approvedById" TEXT,
    "approvedByName" TEXT,
    "approvedAt" TIMESTAMP(3),
    "paidById" TEXT,
    "paidByName" TEXT,
    "paidAt" TIMESTAMP(3),
    "paymentDate" DATE,
    "method" "PaymentMethod",
    "bankName" TEXT,
    "reference" TEXT,
    "paymentNotes" TEXT,
    "differenceReason" TEXT,
    "cancelledById" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancellationReason" TEXT,
    "sentToAccountingAt" TIMESTAMP(3),
    "sentToAccountingById" TEXT,
    "sentToAccountingTo" TEXT,
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "disbursement_order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "disbursement_order_item" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "disbursementOrderId" TEXT NOT NULL,
    "workerPayrollId" TEXT NOT NULL,
    "workerId" TEXT NOT NULL,
    "workerNameSnapshot" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "disbursement_order_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "disbursement_document" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "disbursementOrderId" TEXT NOT NULL,
    "kind" "DisbursementDocumentKind" NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileRef" TEXT NOT NULL,
    "notes" TEXT,
    "uploadedById" TEXT,
    "uploadedByName" TEXT,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "disbursement_document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_sequence" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "lastNumber" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "document_sequence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "payment_recipient_companyId_active_idx" ON "payment_recipient"("companyId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "payment_recipient_companyId_normalizedName_key" ON "payment_recipient"("companyId", "normalizedName");

-- CreateIndex
CREATE INDEX "disbursement_order_companyId_status_idx" ON "disbursement_order"("companyId", "status");

-- CreateIndex
CREATE INDEX "disbursement_order_companyId_payrollWeekId_idx" ON "disbursement_order"("companyId", "payrollWeekId");

-- CreateIndex
CREATE UNIQUE INDEX "disbursement_order_companyId_orderNumber_key" ON "disbursement_order"("companyId", "orderNumber");

-- CreateIndex
CREATE UNIQUE INDEX "disbursement_order_item_workerPayrollId_key" ON "disbursement_order_item"("workerPayrollId");

-- CreateIndex
CREATE INDEX "disbursement_order_item_disbursementOrderId_idx" ON "disbursement_order_item"("disbursementOrderId");

-- CreateIndex
CREATE INDEX "disbursement_document_disbursementOrderId_idx" ON "disbursement_document"("disbursementOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "document_sequence_companyId_kind_year_key" ON "document_sequence"("companyId", "kind", "year");

-- CreateIndex
CREATE INDEX "payment_disbursementOrderId_idx" ON "payment"("disbursementOrderId");

-- AddForeignKey
ALTER TABLE "worker_payroll" ADD CONSTRAINT "worker_payroll_paymentRecipientId_fkey" FOREIGN KEY ("paymentRecipientId") REFERENCES "payment_recipient"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment" ADD CONSTRAINT "payment_disbursementOrderId_fkey" FOREIGN KEY ("disbursementOrderId") REFERENCES "disbursement_order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_recipient" ADD CONSTRAINT "payment_recipient_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "disbursement_order" ADD CONSTRAINT "disbursement_order_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "disbursement_order" ADD CONSTRAINT "disbursement_order_payrollWeekId_fkey" FOREIGN KEY ("payrollWeekId") REFERENCES "payroll_week"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "disbursement_order" ADD CONSTRAINT "disbursement_order_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "payment_recipient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "disbursement_order_item" ADD CONSTRAINT "disbursement_order_item_disbursementOrderId_fkey" FOREIGN KEY ("disbursementOrderId") REFERENCES "disbursement_order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "disbursement_order_item" ADD CONSTRAINT "disbursement_order_item_workerPayrollId_fkey" FOREIGN KEY ("workerPayrollId") REFERENCES "worker_payroll"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "disbursement_document" ADD CONSTRAINT "disbursement_document_disbursementOrderId_fkey" FOREIGN KEY ("disbursementOrderId") REFERENCES "disbursement_order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ═════════════════════════════════════════════════════════════
-- PROTECCIONES DE LAS ÓRDENES DE DESEMBOLSO
--
-- Lo que sigue no se puede saltar desde la aplicación, ni por error ni por un
-- script suelto. Es la última línea de defensa sobre el dinero que sale.
-- ═════════════════════════════════════════════════════════════

-- Montos coherentes.
ALTER TABLE disbursement_order
  ADD CONSTRAINT disbursement_order_total_positive CHECK ("totalAmount" >= 0);
ALTER TABLE disbursement_order
  ADD CONSTRAINT disbursement_order_paid_positive CHECK ("amountPaid" >= 0);

-- Pagar por encima de lo aprobado es imposible, igual que en las nóminas.
ALTER TABLE disbursement_order
  ADD CONSTRAINT disbursement_order_no_overpay CHECK ("amountPaid" <= "totalAmount");

-- Una orden pagada por un monto distinto al aprobado exige explicación.
-- Sin esto, una diferencia pasaría en silencio, que es justo lo que no puede pasar.
ALTER TABLE disbursement_order
  ADD CONSTRAINT disbursement_order_difference_explained CHECK (
    status <> 'PAID'
    OR "amountPaid" = "totalAmount"
    OR ("differenceReason" IS NOT NULL AND length(trim("differenceReason")) > 0)
  );

-- Anular exige motivo.
ALTER TABLE disbursement_order
  ADD CONSTRAINT disbursement_order_cancellation_reason CHECK (
    status <> 'CANCELLED'
    OR ("cancellationReason" IS NOT NULL AND length(trim("cancellationReason")) > 0)
  );

-- Una orden pagada tiene que decir quién y cuándo.
ALTER TABLE disbursement_order
  ADD CONSTRAINT disbursement_order_paid_needs_actor CHECK (
    status NOT IN ('PAID', 'PARTIALLY_PAID')
    OR ("paidById" IS NOT NULL AND "paidAt" IS NOT NULL)
  );

-- Los snapshots no pueden quedar vacíos: son lo que hace que el PDF histórico
-- siga diciendo la verdad cuando alguien renombre una empresa.
ALTER TABLE disbursement_order
  ADD CONSTRAINT disbursement_order_snapshots_required CHECK (
    length(trim("companyNameSnapshot")) > 0
    AND length(trim("recipientNameSnapshot")) > 0
    AND length(trim("weekLabelSnapshot")) > 0
  );

ALTER TABLE disbursement_order_item
  ADD CONSTRAINT disbursement_order_item_amount_positive CHECK (amount >= 0);
ALTER TABLE disbursement_order_item
  ADD CONSTRAINT disbursement_order_item_name_required CHECK (length(trim("workerNameSnapshot")) > 0);

ALTER TABLE payment_recipient
  ADD CONSTRAINT payment_recipient_name_required CHECK (length(trim(name)) > 0);
ALTER TABLE payment_recipient
  ADD CONSTRAINT payment_recipient_normalized_required CHECK (length(trim("normalizedName")) > 0);

ALTER TABLE disbursement_document
  ADD CONSTRAINT disbursement_document_ref_required CHECK (length(trim("fileRef")) > 0);

-- ─────────────────────────────────────────────────────────────
-- Una orden pagada o anulada no se modifica en silencio.
--
-- Solo se permiten los campos que registran algo posterior y auditable: el
-- envío a contabilidad y los documentos adjuntos. Todo lo demás — montos,
-- receptora, semana, referencia, snapshots — queda congelado.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION disbursement_order_immutable_when_settled()
RETURNS TRIGGER AS $$
BEGIN
  -- En un DELETE hay que devolver OLD. Devolver NEW (que es NULL) cancelaria
  -- el borrado sin decir nada.
  IF TG_OP = 'DELETE' THEN
    IF OLD.status IN ('PAID', 'PARTIALLY_PAID') THEN
      RAISE EXCEPTION 'La orden % ya tiene dinero desembolsado y no se puede borrar. Anulala con motivo.', OLD."orderNumber";
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.status NOT IN ('PAID', 'CANCELLED') THEN
    RETURN NEW;
  END IF;

  IF NEW."totalAmount"       IS DISTINCT FROM OLD."totalAmount"
  OR NEW."amountPaid"        IS DISTINCT FROM OLD."amountPaid"
  OR NEW."workerCount"       IS DISTINCT FROM OLD."workerCount"
  OR NEW."recipientId"       IS DISTINCT FROM OLD."recipientId"
  OR NEW."payrollWeekId"     IS DISTINCT FROM OLD."payrollWeekId"
  OR NEW."orderNumber"       IS DISTINCT FROM OLD."orderNumber"
  OR NEW."companyId"         IS DISTINCT FROM OLD."companyId"
  OR NEW.status              IS DISTINCT FROM OLD.status
  OR NEW.reference           IS DISTINCT FROM OLD.reference
  OR NEW.method              IS DISTINCT FROM OLD.method
  OR NEW."paymentDate"       IS DISTINCT FROM OLD."paymentDate"
  OR NEW."paidById"          IS DISTINCT FROM OLD."paidById"
  OR NEW."paidAt"            IS DISTINCT FROM OLD."paidAt"
  OR NEW."companyNameSnapshot"   IS DISTINCT FROM OLD."companyNameSnapshot"
  OR NEW."recipientNameSnapshot" IS DISTINCT FROM OLD."recipientNameSnapshot"
  OR NEW."weekLabelSnapshot"     IS DISTINCT FROM OLD."weekLabelSnapshot"
  THEN
    RAISE EXCEPTION 'La orden % ya esta % y no se puede modificar. Usa un ajuste o una reversion, que quedan registrados.',
      OLD."orderNumber", lower(OLD.status);
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER disbursement_order_immutable
BEFORE UPDATE OR DELETE ON disbursement_order
FOR EACH ROW EXECUTE FUNCTION disbursement_order_immutable_when_settled();

-- Los renglones de una orden ya desembolsada tampoco se tocan: el PDF tiene que
-- seguir coincidiendo exactamente con lo que se transfirio.
CREATE OR REPLACE FUNCTION disbursement_item_immutable_when_settled()
RETURNS TRIGGER AS $$
DECLARE
  order_status TEXT;
  order_number TEXT;
BEGIN
  SELECT status, "orderNumber" INTO order_status, order_number
  FROM disbursement_order
  WHERE id = COALESCE(OLD."disbursementOrderId", NEW."disbursementOrderId");

  IF order_status IN ('PAID', 'PARTIALLY_PAID') THEN
    RAISE EXCEPTION 'La orden % ya tiene dinero desembolsado: sus renglones no se pueden cambiar.', order_number;
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER disbursement_item_immutable
BEFORE UPDATE OR DELETE ON disbursement_order_item
FOR EACH ROW EXECUTE FUNCTION disbursement_item_immutable_when_settled();

-- Una empresa receptora con historial no se borra. Se desactiva.
CREATE OR REPLACE FUNCTION payment_recipient_no_delete_with_history()
RETURNS TRIGGER AS $$
DECLARE
  used INT;
BEGIN
  SELECT count(*) INTO used FROM disbursement_order WHERE "recipientId" = OLD.id;
  IF used > 0 THEN
    RAISE EXCEPTION 'La empresa receptora % tiene % orden(es) de desembolso. No se borra: marcala como inactiva para conservar el historial contable.', OLD.name, used;
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER payment_recipient_keep_history
BEFORE DELETE ON payment_recipient
FOR EACH ROW EXECUTE FUNCTION payment_recipient_no_delete_with_history();
