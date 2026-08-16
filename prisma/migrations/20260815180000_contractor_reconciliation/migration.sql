-- Conciliación de la liquidación de una cuadrilla contra la fuente externa
-- (hoy SharePoint), y el desglose de cómo se reparte por dentro.
--
-- Al contratista se le paga UN total (BR-242) y él le paga a su gente. Nosotros
-- no le pagamos a esa gente, pero llevamos la cuenta para poder verificar que
-- lo de la gente más la parte del contratista da lo que dice la fuente.

ALTER TABLE "crew_payroll"
  ADD COLUMN "expectedTotal"  DECIMAL(18,2),
  ADD COLUMN "expectedSource" TEXT,
  ADD COLUMN "expectedNote"   TEXT,
  ADD COLUMN "reconciledById" TEXT,
  ADD COLUMN "reconciledAt"   TIMESTAMP(3);

CREATE TABLE "crew_payroll_member" (
  "id"            TEXT NOT NULL,
  "companyId"     TEXT NOT NULL,
  "crewPayrollId" TEXT NOT NULL,
  "workerId"      TEXT,
  "nameSnapshot"  TEXT NOT NULL,
  "isContractor"  BOOLEAN NOT NULL DEFAULT false,
  "rateAmount"    DECIMAL(18,2) NOT NULL,
  "rateUnit"      TEXT NOT NULL DEFAULT 'WEEK',
  "quantity"      DECIMAL(14,2) NOT NULL DEFAULT 1,
  "amount"        DECIMAL(18,2) NOT NULL,
  "notes"         TEXT,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL,

  CONSTRAINT "crew_payroll_member_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "crew_payroll_member_companyId_crewPayrollId_idx"
  ON "crew_payroll_member"("companyId", "crewPayrollId");

-- Al borrarse la liquidación se va su desglose: no significa nada por su cuenta.
ALTER TABLE "crew_payroll_member"
  ADD CONSTRAINT "crew_payroll_member_crewPayrollId_fkey"
  FOREIGN KEY ("crewPayrollId") REFERENCES "crew_payroll"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- La ficha del trabajador NO se borra por tener desglose histórico.
ALTER TABLE "crew_payroll_member"
  ADD CONSTRAINT "crew_payroll_member_workerId_fkey"
  FOREIGN KEY ("workerId") REFERENCES "worker"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- Un renglón del desglose jamás vale negativo ni sale sin nombre: es lo que se
-- lee para verificar un pago, y un nombre vacío no verifica nada.
ALTER TABLE "crew_payroll_member"
  ADD CONSTRAINT "crew_payroll_member_amounts_not_negative"
  CHECK ("rateAmount" >= 0 AND "quantity" >= 0 AND "amount" >= 0);

ALTER TABLE "crew_payroll_member"
  ADD CONSTRAINT "crew_payroll_member_name_not_blank"
  CHECK (length(btrim("nameSnapshot")) > 0);

-- Lo que dice la fuente externa tampoco puede ser negativo.
ALTER TABLE "crew_payroll"
  ADD CONSTRAINT "crew_payroll_expected_not_negative"
  CHECK ("expectedTotal" IS NULL OR "expectedTotal" >= 0);

/*
 * El desglose de una liquidación PAGADA es intocable.
 *
 * Es el soporte de por qué salió esa plata: si mañana alguien le cambia la
 * tarifa a un renglón, el pago hecho quedaría respaldado por un documento que
 * dice otra cosa. Mismo principio que la regla 6.
 */
CREATE OR REPLACE FUNCTION crew_payroll_member_frozen_when_paid()
RETURNS TRIGGER AS $$
DECLARE
  estado TEXT;
BEGIN
  SELECT status::text INTO estado
  FROM crew_payroll
  WHERE id = COALESCE(NEW."crewPayrollId", OLD."crewPayrollId");

  IF estado IN ('PAID', 'RECONCILED', 'CLOSED') THEN
    RAISE EXCEPTION
      'El desglose de una liquidación % no se puede cambiar: es el soporte de un pago ya hecho. Corrígelo con un ajuste.',
      lower(estado);
  END IF;

  -- En un BEFORE ... FOR EACH ROW, un DELETE tiene que devolver OLD:
  -- devolver NEW (que es NULL) cancelaría el borrado sin avisar.
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER crew_payroll_member_frozen_when_paid_trg
  BEFORE INSERT OR UPDATE OR DELETE ON "crew_payroll_member"
  FOR EACH ROW EXECUTE FUNCTION crew_payroll_member_frozen_when_paid();
