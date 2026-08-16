-- El resumen con el que quien prepara manda la semana a aprobación.
--
-- Es el «último visto bueno» antes de que salga de sus manos, con consecutivo
-- propio (RA-SKYLINE-2026-0007) para poder citarlo por número.
CREATE TABLE "approval_summary" (
  "id"              TEXT NOT NULL,
  "companyId"       TEXT NOT NULL,
  "payrollWeekId"   TEXT NOT NULL,
  "number"          TEXT NOT NULL,
  "year"            INTEGER NOT NULL,
  "sequence"        INTEGER NOT NULL,
  "workersCount"    INTEGER NOT NULL,
  "workersTotal"    DECIMAL(18,2) NOT NULL,
  "equipmentCount"  INTEGER NOT NULL,
  "equipmentTotal"  DECIMAL(18,2) NOT NULL,
  "crewsCount"      INTEGER NOT NULL,
  "crewsTotal"      DECIMAL(18,2) NOT NULL,
  "grandTotal"      DECIMAL(18,2) NOT NULL,
  "linesJson"       JSONB NOT NULL,
  "preparedById"    TEXT,
  "preparedByName"  TEXT NOT NULL,
  "preparedByEmail" TEXT NOT NULL,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "approval_summary_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "approval_summary_companyId_number_key"
  ON "approval_summary" ("companyId", "number");
CREATE INDEX "approval_summary_companyId_payrollWeekId_idx"
  ON "approval_summary" ("companyId", "payrollWeekId");

ALTER TABLE "approval_summary"
  ADD CONSTRAINT "approval_summary_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "approval_summary"
  ADD CONSTRAINT "approval_summary_payrollWeekId_fkey"
  FOREIGN KEY ("payrollWeekId") REFERENCES "payroll_week"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Un resumen es un hecho: se emitió, con ese número y esos totales. Cambiarlo
-- después borraría la prueba de contra qué se dio el visto bueno.
CREATE OR REPLACE FUNCTION approval_summary_immutable() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'El resumen % ya se emitió: no se modifica ni se borra. Si la semana cambió, se manda otra vez y sale un resumen nuevo.', OLD."number";
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER approval_summary_immutable
  BEFORE UPDATE OR DELETE ON "approval_summary"
  FOR EACH ROW EXECUTE FUNCTION approval_summary_immutable();
