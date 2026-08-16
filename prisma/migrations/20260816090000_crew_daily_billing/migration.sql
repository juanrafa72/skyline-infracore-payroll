-- Una cuadrilla puede cobrar por PRODUCCIÓN (pies construidos) o un precio
-- FIJO POR DÍA. Lo pidió el negocio: pasa de verdad y no se podía registrar
-- —había que inventarle una producción falsa para que el sistema liquidara.
--
-- En los dos casos se le paga al CONTRATISTA (BR-242) y se le lleva su nómina
-- interna igual: cambia de dónde sale el total, no a quién se le paga.

CREATE TYPE "CrewBillingMode" AS ENUM ('PRODUCTION', 'DAILY');

ALTER TABLE "crew"
  ADD COLUMN "billingMode" "CrewBillingMode" NOT NULL DEFAULT 'PRODUCTION',
  ADD COLUMN "dailyRate"   DECIMAL(18,2);

-- Cómo se calculó, congelado: sin esto, cambiar mañana el modo de cobro haría
-- que una liquidación vieja se leyera con la regla nueva (regla 8).
ALTER TABLE "crew_payroll"
  ADD COLUMN "billingModeSnapshot" "CrewBillingMode" NOT NULL DEFAULT 'PRODUCTION',
  ADD COLUMN "appliedDailyRate"    DECIMAL(18,2);

-- Una tarifa diaria negativa le cobraría a la cuadrilla por trabajar.
ALTER TABLE "crew"
  ADD CONSTRAINT "crew_daily_rate_not_negative"
  CHECK ("dailyRate" IS NULL OR "dailyRate" >= 0);

ALTER TABLE "crew_payroll"
  ADD CONSTRAINT "crew_payroll_applied_daily_rate_not_negative"
  CHECK ("appliedDailyRate" IS NULL OR "appliedDailyRate" >= 0);

/*
 * Los días de una cuadrilla que cobra POR DÍA.
 *
 * Es el equivalente del día de un equipo rentado. NO confundir con los días de
 * control de su gente (`work_entry.isControlOnly`), que anotan y no pagan
 * (BR-243): estos sí pagan, y le pagan al contratista.
 */
CREATE TABLE "crew_day_entry" (
  "id"            TEXT NOT NULL,
  "companyId"     TEXT NOT NULL,
  "payrollWeekId" TEXT NOT NULL,
  "crewId"        TEXT NOT NULL,
  "workDate"      DATE NOT NULL,
  "projectId"     TEXT,
  "notes"         TEXT,
  "createdById"   TEXT,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "crew_day_entry_pkey" PRIMARY KEY ("id")
);

-- Una cuadrilla trabaja un día o no lo trabaja: no puede cobrarlo dos veces.
CREATE UNIQUE INDEX "crew_day_entry_companyId_crewId_workDate_key"
  ON "crew_day_entry"("companyId", "crewId", "workDate");
CREATE INDEX "crew_day_entry_companyId_payrollWeekId_idx"
  ON "crew_day_entry"("companyId", "payrollWeekId");

ALTER TABLE "crew_day_entry"
  ADD CONSTRAINT "crew_day_entry_payrollWeekId_fkey"
  FOREIGN KEY ("payrollWeekId") REFERENCES "payroll_week"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "crew_day_entry"
  ADD CONSTRAINT "crew_day_entry_crewId_fkey"
  FOREIGN KEY ("crewId") REFERENCES "crew"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "crew_day_entry"
  ADD CONSTRAINT "crew_day_entry_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "project"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

/*
 * Los días de una liquidación PAGADA son intocables.
 *
 * Son el soporte de por qué salió esa plata: si alguien pudiera agregar o
 * quitar un día después, el pago hecho quedaría respaldado por un documento
 * que dice otra cosa. Mismo principio que la regla 6 y que el desglose del
 * contratista.
 */
CREATE OR REPLACE FUNCTION crew_day_entry_frozen_when_paid()
RETURNS TRIGGER AS $$
DECLARE
  estado TEXT;
BEGIN
  SELECT status::text INTO estado
  FROM crew_payroll
  WHERE "crewId" = COALESCE(NEW."crewId", OLD."crewId")
    AND "payrollWeekId" = COALESCE(NEW."payrollWeekId", OLD."payrollWeekId");

  IF estado IN ('PAID', 'RECONCILED', 'CLOSED') THEN
    RAISE EXCEPTION
      'Los días de una liquidación % no se pueden cambiar: son el soporte de un pago ya hecho. Corrígelo con un ajuste.',
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

CREATE TRIGGER crew_day_entry_frozen_when_paid_trg
  BEFORE INSERT OR UPDATE OR DELETE ON "crew_day_entry"
  FOR EACH ROW EXECUTE FUNCTION crew_day_entry_frozen_when_paid();
