-- Hoja de vida de cada equipo: seguros, títulos, mantenimientos, con su fecha
-- de vencimiento para poder AVISAR antes de que se venza.
--
-- La fecha es un campo propio y no algo que haya que leer dentro del PDF: un
-- aviso que dependa de adivinar la fecha de un documento escaneado falla justo
-- cuando importa. El archivo vive en SharePoint; aquí solo la referencia.

CREATE TYPE "EquipmentRecordKind" AS ENUM (
  'INSURANCE', 'TITLE', 'REGISTRATION', 'INSPECTION', 'MAINTENANCE', 'WARRANTY', 'OTHER'
);

CREATE TABLE "equipment_record" (
  "id"               TEXT NOT NULL,
  "companyId"        TEXT NOT NULL,
  "equipmentId"      TEXT NOT NULL,
  "kind"             "EquipmentRecordKind" NOT NULL,
  "title"            TEXT NOT NULL,
  "reference"        TEXT,
  "issuedAt"         DATE,
  "expiresAt"        DATE,
  "alertDaysBefore"  INTEGER NOT NULL DEFAULT 30,
  "meterAtService"   INTEGER,
  "nextServiceMeter" INTEGER,
  "fileName"         TEXT,
  "fileRef"          TEXT,
  "cost"             DECIMAL(18,2),
  "vendorId"         TEXT,
  "notes"            TEXT,
  "active"           BOOLEAN NOT NULL DEFAULT true,
  "createdById"      TEXT,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL,

  CONSTRAINT "equipment_record_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "equipment_record_companyId_equipmentId_active_idx"
  ON "equipment_record"("companyId", "equipmentId", "active");

-- El barrido de vencimientos consulta por fecha sobre toda la compañía.
CREATE INDEX "equipment_record_companyId_expiresAt_idx"
  ON "equipment_record"("companyId", "expiresAt");

-- Si se borra el equipo se va su hoja de vida: no significa nada sin él.
ALTER TABLE "equipment_record"
  ADD CONSTRAINT "equipment_record_equipmentId_fkey"
  FOREIGN KEY ("equipmentId") REFERENCES "equipment"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- El proveedor que expidió la póliza o hizo el servicio NO se borra por tener
-- historial: se desactiva, igual que las empresas receptoras.
ALTER TABLE "equipment_record"
  ADD CONSTRAINT "equipment_record_vendorId_fkey"
  FOREIGN KEY ("vendorId") REFERENCES "vendor"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- Un documento sin nombre no se puede buscar ni reconocer en una lista.
ALTER TABLE "equipment_record"
  ADD CONSTRAINT "equipment_record_title_not_blank"
  CHECK (length(btrim("title")) > 0);

-- Vencer antes de expedirse es un error de captura, no un dato.
ALTER TABLE "equipment_record"
  ADD CONSTRAINT "equipment_record_dates_ordered"
  CHECK ("issuedAt" IS NULL OR "expiresAt" IS NULL OR "expiresAt" >= "issuedAt");

-- Avisar con días negativos avisaría DESPUÉS de vencido. Un año de
-- anticipación es el techo razonable para una póliza.
ALTER TABLE "equipment_record"
  ADD CONSTRAINT "equipment_record_alert_days_sane"
  CHECK ("alertDaysBefore" >= 0 AND "alertDaysBefore" <= 365);

ALTER TABLE "equipment_record"
  ADD CONSTRAINT "equipment_record_cost_not_negative"
  CHECK ("cost" IS NULL OR "cost" >= 0);
