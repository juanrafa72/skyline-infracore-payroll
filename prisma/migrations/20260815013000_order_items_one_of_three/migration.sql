-- Un renglón de orden de desembolso pasa de "siempre una persona" a
-- "exactamente UNO de tres pagables": persona, cuadrilla o equipo.
-- Las columnas "workerNameSnapshot" y "workerCount" NO se renombran: en Prisma
-- se leen como itemNameSnapshot/itemCount vía @map, y los CHECKs y triggers
-- existentes siguen intactos.

ALTER TABLE disbursement_order_item ALTER COLUMN "workerPayrollId" DROP NOT NULL;
ALTER TABLE disbursement_order_item ALTER COLUMN "workerId" DROP NOT NULL;

ALTER TABLE disbursement_order_item ADD COLUMN "crewPayrollId" TEXT;
ALTER TABLE disbursement_order_item ADD COLUMN "equipmentPayrollId" TEXT;
ALTER TABLE disbursement_order_item ADD COLUMN "crewLabelSnapshot" TEXT;

CREATE UNIQUE INDEX "disbursement_order_item_crewPayrollId_key"
  ON "disbursement_order_item"("crewPayrollId");
CREATE UNIQUE INDEX "disbursement_order_item_equipmentPayrollId_key"
  ON "disbursement_order_item"("equipmentPayrollId");

-- RESTRICT igual que la FK original de worker_payroll: un pagable que está en
-- una orden no se puede borrar por debajo.
ALTER TABLE disbursement_order_item
  ADD CONSTRAINT "disbursement_order_item_crewPayrollId_fkey"
  FOREIGN KEY ("crewPayrollId") REFERENCES "crew_payroll"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE disbursement_order_item
  ADD CONSTRAINT "disbursement_order_item_equipmentPayrollId_fkey"
  FOREIGN KEY ("equipmentPayrollId") REFERENCES "equipment_payroll"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- Exactamente un pagable por renglón. Cero o dos son un error de programa.
ALTER TABLE disbursement_order_item
  ADD CONSTRAINT disbursement_order_item_one_payable CHECK (
    (CASE WHEN "workerPayrollId"    IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN "crewPayrollId"      IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN "equipmentPayrollId" IS NOT NULL THEN 1 ELSE 0 END) = 1
  );

-- El par worker/workerPayroll va junto o no va.
ALTER TABLE disbursement_order_item
  ADD CONSTRAINT disbursement_order_item_worker_pair CHECK (
    ("workerPayrollId" IS NULL) = ("workerId" IS NULL)
  );
