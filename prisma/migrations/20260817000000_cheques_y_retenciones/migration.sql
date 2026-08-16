-- Los cheques que nos pagan, y lo que nos descuentan de ellos.
--
-- Se carga lo que dice el soporte, después lo que DE VERDAD entró al banco, y
-- cada descuento con su motivo. La diferencia entre lo uno y lo otro es el
-- punto: sin explicarla, la plata retenida —que vuelve— se confunde con plata
-- perdida y nadie la reclama.
CREATE TYPE "DeductionKind" AS ENUM ('RETENTION', 'MATERIAL', 'DAMAGE', 'ADVANCE', 'OTHER');

CREATE TABLE "customer_check" (
  "id"             TEXT NOT NULL,
  "companyId"      TEXT NOT NULL,
  "customerId"     TEXT NOT NULL,
  "reference"      TEXT,
  "expectedAmount" DECIMAL(18,2) NOT NULL,
  "receivedAmount" DECIMAL(18,2),
  "receivedDate"   DATE,
  "notes"          TEXT,
  "createdById"    TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,
  CONSTRAINT "customer_check_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "customer_check_week" (
  "id"            TEXT NOT NULL,
  "checkId"       TEXT NOT NULL,
  "payrollWeekId" TEXT NOT NULL,
  CONSTRAINT "customer_check_week_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "check_deduction" (
  "id"             TEXT NOT NULL,
  "checkId"        TEXT NOT NULL,
  "kind"           "DeductionKind" NOT NULL,
  "amount"         DECIMAL(18,2) NOT NULL,
  "reason"         TEXT NOT NULL,
  "projectId"      TEXT,
  "releasedAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "releasedAt"     DATE,
  "releaseNote"    TEXT,
  "createdById"    TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "check_deduction_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "customer_check_companyId_customerId_idx" ON "customer_check" ("companyId", "customerId");
CREATE UNIQUE INDEX "customer_check_week_checkId_payrollWeekId_key" ON "customer_check_week" ("checkId", "payrollWeekId");
CREATE INDEX "check_deduction_checkId_idx" ON "check_deduction" ("checkId");

ALTER TABLE "customer_check" ADD CONSTRAINT "customer_check_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "customer_check" ADD CONSTRAINT "customer_check_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "customer_check_week" ADD CONSTRAINT "customer_check_week_checkId_fkey"
  FOREIGN KEY ("checkId") REFERENCES "customer_check"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "customer_check_week" ADD CONSTRAINT "customer_check_week_payrollWeekId_fkey"
  FOREIGN KEY ("payrollWeekId") REFERENCES "payroll_week"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "check_deduction" ADD CONSTRAINT "check_deduction_checkId_fkey"
  FOREIGN KEY ("checkId") REFERENCES "customer_check"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "check_deduction" ADD CONSTRAINT "check_deduction_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Montos con sentido: un cheque de cero o un descuento negativo son errores de
-- captura que después nadie entiende mirando el saldo.
ALTER TABLE "customer_check" ADD CONSTRAINT "customer_check_expected_positive"
  CHECK ("expectedAmount" > 0);
ALTER TABLE "customer_check" ADD CONSTRAINT "customer_check_received_not_negative"
  CHECK ("receivedAmount" IS NULL OR "receivedAmount" >= 0);
ALTER TABLE "check_deduction" ADD CONSTRAINT "check_deduction_amount_positive"
  CHECK ("amount" > 0);

-- No se puede devolver más de lo que se retuvo.
ALTER TABLE "check_deduction" ADD CONSTRAINT "check_deduction_released_within_amount"
  CHECK ("releasedAmount" >= 0 AND "releasedAmount" <= "amount");

-- Un descuento sin motivo no se puede reclamar.
ALTER TABLE "check_deduction" ADD CONSTRAINT "check_deduction_reason_not_empty"
  CHECK (length(btrim("reason")) > 0);
