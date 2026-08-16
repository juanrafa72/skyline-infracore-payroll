-- Envío de reportes por correo, con consecutivo único.
--
-- El negocio pidió poder mandar el desprendible a la auxiliar contable y a la
-- empresa receptora «y las que sean necesarias», y que cada reporte lleve su
-- consecutivo. Queda constancia de qué se mandó, a quién y cuándo: sin eso,
-- «¿ya le mandaste el soporte?» no tiene respuesta verificable.

CREATE TYPE "ReportKind" AS ENUM ('DISBURSEMENT_PDF', 'WEEKLY_SUMMARY', 'OTHER');
CREATE TYPE "ReportDispatchStatus" AS ENUM ('QUEUED', 'SENT', 'FAILED');

CREATE TABLE "report_recipient" (
  "id"                 TEXT NOT NULL,
  "companyId"          TEXT NOT NULL,
  "name"               TEXT NOT NULL,
  "email"              TEXT NOT NULL,
  "kinds"              TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "paymentRecipientId" TEXT,
  "bcc"                BOOLEAN NOT NULL DEFAULT false,
  "active"             BOOLEAN NOT NULL DEFAULT true,
  "notes"              TEXT,
  "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"          TIMESTAMP(3) NOT NULL,

  CONSTRAINT "report_recipient_pkey" PRIMARY KEY ("id")
);

-- El mismo correo puede estar dos veces si uno es general y otro atado a una
-- empresa receptora concreta; repetido para la MISMA receptora, no.
CREATE UNIQUE INDEX "report_recipient_companyId_email_paymentRecipientId_key"
  ON "report_recipient"("companyId", "email", "paymentRecipientId");
CREATE INDEX "report_recipient_companyId_active_idx"
  ON "report_recipient"("companyId", "active");

ALTER TABLE "report_recipient"
  ADD CONSTRAINT "report_recipient_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "company"("id") ON UPDATE CASCADE;

ALTER TABLE "report_recipient"
  ADD CONSTRAINT "report_recipient_paymentRecipientId_fkey"
  FOREIGN KEY ("paymentRecipientId") REFERENCES "payment_recipient"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- Un correo sin arroba no llega a ninguna parte, y mandarlo a la nada haría
-- creer que el soporte se envió.
ALTER TABLE "report_recipient"
  ADD CONSTRAINT "report_recipient_email_shape"
  CHECK ("email" ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$');

ALTER TABLE "report_recipient"
  ADD CONSTRAINT "report_recipient_name_not_blank"
  CHECK (length(btrim("name")) > 0);

CREATE TABLE "report_dispatch" (
  "id"                  TEXT NOT NULL,
  "companyId"           TEXT NOT NULL,
  "reportNumber"        TEXT NOT NULL,
  "kind"                "ReportKind" NOT NULL,
  "disbursementOrderId" TEXT,
  "subject"             TEXT NOT NULL,
  "fileName"            TEXT,
  "status"              "ReportDispatchStatus" NOT NULL DEFAULT 'QUEUED',
  "failureReason"       TEXT,
  "sentById"            TEXT,
  "sentByName"          TEXT,
  "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "sentAt"              TIMESTAMP(3),

  CONSTRAINT "report_dispatch_pkey" PRIMARY KEY ("id")
);

-- El consecutivo es único por compañía: dos reportes con el mismo número
-- hacen imposible reclamar el que falta.
CREATE UNIQUE INDEX "report_dispatch_companyId_reportNumber_key"
  ON "report_dispatch"("companyId", "reportNumber");
CREATE INDEX "report_dispatch_companyId_createdAt_idx"
  ON "report_dispatch"("companyId", "createdAt");

ALTER TABLE "report_dispatch"
  ADD CONSTRAINT "report_dispatch_disbursementOrderId_fkey"
  FOREIGN KEY ("disbursementOrderId") REFERENCES "disbursement_order"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "report_dispatch_target" (
  "id"                TEXT NOT NULL,
  "dispatchId"        TEXT NOT NULL,
  "reportRecipientId" TEXT,
  "emailSnapshot"     TEXT NOT NULL,
  "nameSnapshot"      TEXT NOT NULL,
  "bcc"               BOOLEAN NOT NULL DEFAULT false,

  CONSTRAINT "report_dispatch_target_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "report_dispatch_target_dispatchId_idx"
  ON "report_dispatch_target"("dispatchId");

ALTER TABLE "report_dispatch_target"
  ADD CONSTRAINT "report_dispatch_target_dispatchId_fkey"
  FOREIGN KEY ("dispatchId") REFERENCES "report_dispatch"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Al destinatario se le puede quitar de la lista, pero el registro de a quién
-- se le mandó no se toca: por eso el correo va congelado en el target.
ALTER TABLE "report_dispatch_target"
  ADD CONSTRAINT "report_dispatch_target_reportRecipientId_fkey"
  FOREIGN KEY ("reportRecipientId") REFERENCES "report_recipient"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "report_dispatch_target"
  ADD CONSTRAINT "report_dispatch_target_email_not_blank"
  CHECK (length(btrim("emailSnapshot")) > 0);

/*
 * Un envío YA REALIZADO es inmutable.
 *
 * Es la prueba de que el soporte salió: si se pudiera editar el destinatario o
 * la fecha después, dejaría de probar nada. Mismo principio que la nómina
 * pagada (regla 6). Un envío fallido sí se puede reintentar — eso crea un
 * registro nuevo, con su propio consecutivo.
 */
CREATE OR REPLACE FUNCTION report_dispatch_sent_is_immutable()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.status = 'SENT' THEN
    RAISE EXCEPTION
      'El envío % ya salió y no se puede modificar ni borrar. Si hay que volver a mandarlo, haz un envío nuevo.',
      OLD."reportNumber";
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER report_dispatch_sent_is_immutable_trg
  BEFORE UPDATE OR DELETE ON "report_dispatch"
  FOR EACH ROW EXECUTE FUNCTION report_dispatch_sent_is_immutable();
