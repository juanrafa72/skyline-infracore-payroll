-- Qué cuadrillas se liquidan en ESTA semana.
--
-- Antes solo aparecían las que ya tenían producción capturada: no había forma
-- de decir «esta semana voy a liquidar a Jesús» y empezar a armarle la cuenta.
-- Y pueden ser varias a la vez.
CREATE TABLE "crew_week_member" (
  "id"            TEXT NOT NULL,
  "companyId"     TEXT NOT NULL,
  "payrollWeekId" TEXT NOT NULL,
  "crewId"        TEXT NOT NULL,
  "addedById"     TEXT,
  "addedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "crew_week_member_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "crew_week_member_payrollWeekId_crewId_key"
  ON "crew_week_member" ("payrollWeekId", "crewId");
CREATE INDEX "crew_week_member_companyId_payrollWeekId_idx"
  ON "crew_week_member" ("companyId", "payrollWeekId");

ALTER TABLE "crew_week_member"
  ADD CONSTRAINT "crew_week_member_payrollWeekId_fkey"
  FOREIGN KEY ("payrollWeekId") REFERENCES "payroll_week"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "crew_week_member"
  ADD CONSTRAINT "crew_week_member_crewId_fkey"
  FOREIGN KEY ("crewId") REFERENCES "crew"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Las que ya se estaban liquidando siguen en su semana: si no, una semana con
-- trabajo hecho se abriría vacía y parecería que se perdió.
INSERT INTO "crew_week_member" ("id", "companyId", "payrollWeekId", "crewId")
SELECT gen_random_uuid()::text, "companyId", "payrollWeekId", "crewId"
  FROM (
    SELECT DISTINCT "companyId", "payrollWeekId", "crewId" FROM "production" WHERE "crewId" IS NOT NULL
    UNION
    SELECT DISTINCT "companyId", "payrollWeekId", "crewId" FROM "crew_payroll"
    UNION
    SELECT DISTINCT "companyId", "payrollWeekId", "crewId" FROM "crew_day_entry"
  ) AS ya_liquidaban
ON CONFLICT DO NOTHING;
