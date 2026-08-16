-- Qué equipos van en ESTA semana.
--
-- La semana ofrecía todas las máquinas activas de la compañía, siempre. Con
-- ocho se aguanta; con cincuenta, quien marca los días recorre una lista donde
-- la mayoría no estuvo en obra, y marcar el equipo equivocado cuesta plata: al
-- rentado se le paga a un proveedor.
CREATE TABLE "equipment_week_member" (
  "id"            TEXT NOT NULL,
  "companyId"     TEXT NOT NULL,
  "payrollWeekId" TEXT NOT NULL,
  "equipmentId"   TEXT NOT NULL,
  "addedById"     TEXT,
  "addedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "equipment_week_member_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "equipment_week_member_payrollWeekId_equipmentId_key"
  ON "equipment_week_member" ("payrollWeekId", "equipmentId");
CREATE INDEX "equipment_week_member_companyId_payrollWeekId_idx"
  ON "equipment_week_member" ("companyId", "payrollWeekId");

ALTER TABLE "equipment_week_member"
  ADD CONSTRAINT "equipment_week_member_payrollWeekId_fkey"
  FOREIGN KEY ("payrollWeekId") REFERENCES "payroll_week"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "equipment_week_member"
  ADD CONSTRAINT "equipment_week_member_equipmentId_fkey"
  FOREIGN KEY ("equipmentId") REFERENCES "equipment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Lo que YA estaba trabajando sigue en su semana.
--
-- Sin esto, la primera vez que alguien abriera una semana vieja se
-- encontraría la lista vacía y creería que se perdieron los días marcados.
INSERT INTO "equipment_week_member" ("id", "companyId", "payrollWeekId", "equipmentId")
SELECT gen_random_uuid()::text, "companyId", "payrollWeekId", "equipmentId"
  FROM (
    SELECT DISTINCT "companyId", "payrollWeekId", "equipmentId" FROM "equipment_entry"
    UNION
    SELECT DISTINCT "companyId", "payrollWeekId", "equipmentId" FROM "equipment_payroll"
  ) AS ya_trabajaban
ON CONFLICT DO NOTHING;
