-- Protecciones que NO dependen del código de la aplicación.
-- Si alguien se salta la app y escribe directo en la base, estas reglas siguen vigentes.

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ─────────────────────────────────────────────────────────────
-- BR-140 · audit_log es APPEND-ONLY
-- ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION audit_log_append_only()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION
    'audit_log es append-only: % no esta permitido (BR-140)', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_log_no_update
  BEFORE UPDATE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_append_only();

CREATE TRIGGER audit_log_no_delete
  BEFORE DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_append_only();

CREATE TRIGGER audit_log_no_truncate
  BEFORE TRUNCATE ON audit_log
  EXECUTE FUNCTION audit_log_append_only();

-- ─────────────────────────────────────────────────────────────
-- Una nómina PAID / RECONCILED / CLOSED no se edita nunca.
-- Corrección solo por Adjustment / Reversal / AdditionalPayment / Credit.
-- ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION worker_payroll_immutable_when_paid()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.status IN ('PAID', 'RECONCILED', 'CLOSED') THEN
    -- Solo se permite avanzar en el cierre contable: PAID → RECONCILED → CLOSED.
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'No se puede borrar una nomina en estado %', OLD.status
        USING ERRCODE = 'insufficient_privilege';
    END IF;

    IF NEW.status IS DISTINCT FROM OLD.status
       AND NOT (
         (OLD.status = 'PAID'       AND NEW.status = 'RECONCILED') OR
         (OLD.status = 'RECONCILED' AND NEW.status = 'CLOSED')
       ) THEN
      RAISE EXCEPTION 'Transicion no permitida desde % hacia %', OLD.status, NEW.status
        USING ERRCODE = 'insufficient_privilege';
    END IF;

    IF NEW."basePay"         IS DISTINCT FROM OLD."basePay"
    OR NEW."additionsTotal"  IS DISTINCT FROM OLD."additionsTotal"
    OR NEW."grossPay"        IS DISTINCT FROM OLD."grossPay"
    OR NEW."deductionsTotal" IS DISTINCT FROM OLD."deductionsTotal"
    OR NEW."netPay"          IS DISTINCT FROM OLD."netPay"
    OR NEW."daysFull"        IS DISTINCT FROM OLD."daysFull"
    OR NEW."daysHalf"        IS DISTINCT FROM OLD."daysHalf"
    OR NEW."hoursTotal"      IS DISTINCT FROM OLD."hoursTotal"
    OR NEW."workerId"        IS DISTINCT FROM OLD."workerId"
    OR NEW."payrollWeekId"   IS DISTINCT FROM OLD."payrollWeekId"
    THEN
      RAISE EXCEPTION
        'Una nomina en estado % es inmutable. Usar Adjustment, Reversal, AdditionalPayment o Credit.',
        OLD.status
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER worker_payroll_immutable
  BEFORE UPDATE OR DELETE ON worker_payroll
  FOR EACH ROW EXECUTE FUNCTION worker_payroll_immutable_when_paid();

-- Las líneas, adicionales y descuentos de una nómina pagada tampoco se tocan.
CREATE OR REPLACE FUNCTION child_immutable_when_payroll_paid()
RETURNS TRIGGER AS $$
DECLARE
  parent_id     TEXT;
  parent_status TEXT;
BEGIN
  parent_id := COALESCE(
    CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE NEW."workerPayrollId" END,
    OLD."workerPayrollId"
  );
  IF parent_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT status INTO parent_status FROM worker_payroll WHERE id = parent_id;

  IF parent_status IN ('PAID', 'RECONCILED', 'CLOSED') THEN
    RAISE EXCEPTION
      'La nomina esta en estado % : sus lineas son inmutables (%)', parent_status, TG_TABLE_NAME
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER payroll_line_immutable
  BEFORE INSERT OR UPDATE OR DELETE ON payroll_line
  FOR EACH ROW EXECUTE FUNCTION child_immutable_when_payroll_paid();

CREATE TRIGGER addition_immutable
  BEFORE INSERT OR UPDATE OR DELETE ON addition
  FOR EACH ROW EXECUTE FUNCTION child_immutable_when_payroll_paid();

CREATE TRIGGER deduction_immutable
  BEFORE INSERT OR UPDATE OR DELETE ON deduction
  FOR EACH ROW EXECUTE FUNCTION child_immutable_when_payroll_paid();

-- ─────────────────────────────────────────────────────────────
-- BR-081 · El monto de un anticipo aprobado es inmutable
-- ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION advance_amount_immutable()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.status <> 'PENDING' AND NEW.amount IS DISTINCT FROM OLD.amount THEN
    RAISE EXCEPTION
      'El monto de un anticipo aprobado no se modifica (BR-081). Registrar un movimiento.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER advance_amount_locked
  BEFORE UPDATE ON advance
  FOR EACH ROW EXECUTE FUNCTION advance_amount_immutable();

-- ─────────────────────────────────────────────────────────────
-- BR-093 · Una condonación de deuda exige aprobador
-- ─────────────────────────────────────────────────────────────

ALTER TABLE debt_transaction
  ADD CONSTRAINT debt_forgiveness_requires_approver
  CHECK (type <> 'FORGIVENESS' OR "approvedById" IS NOT NULL);

-- ─────────────────────────────────────────────────────────────
-- BR-035 · Las tarifas del mismo alcance no pueden solaparse en el tiempo
-- ─────────────────────────────────────────────────────────────

ALTER TABLE worker_rate
  ADD CONSTRAINT worker_rate_no_overlap
  EXCLUDE USING gist (
    "workerId"    WITH =,
    "rateType"    WITH =,
    shift         WITH =,
    COALESCE("projectId",   '') WITH =,
    COALESCE("operationId", '') WITH =,
    daterange("effectiveFrom", "effectiveTo", '[)') WITH &&
  )
  WHERE (active);

-- ─────────────────────────────────────────────────────────────
-- Coherencia de importes
-- ─────────────────────────────────────────────────────────────

ALTER TABLE addition          ADD CONSTRAINT addition_amount_positive          CHECK (amount >= 0);
ALTER TABLE deduction         ADD CONSTRAINT deduction_amount_positive         CHECK (amount >= 0);
ALTER TABLE advance           ADD CONSTRAINT advance_amount_positive           CHECK (amount > 0);
ALTER TABLE advance_recovery  ADD CONSTRAINT advance_recovery_amount_positive  CHECK (amount > 0);
ALTER TABLE worker_rate       ADD CONSTRAINT worker_rate_amount_positive       CHECK (amount >= 0);

-- BR: pagar por encima de lo aprobado está bloqueado.
ALTER TABLE payment
  ADD CONSTRAINT payment_not_over_approved
  CHECK ("amountPaid" <= "approvedAmount");

-- Un pago tiene exactamente un beneficiario.
ALTER TABLE payment
  ADD CONSTRAINT payment_single_payee
  CHECK (
    (CASE WHEN "workerId"     IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN "contractorId" IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN "vendorId"     IS NOT NULL THEN 1 ELSE 0 END) = 1
  );

-- Un anticipo tiene exactamente un beneficiario.
ALTER TABLE advance
  ADD CONSTRAINT advance_single_beneficiary
  CHECK (
    (CASE WHEN "workerId"     IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN "contractorId" IS NOT NULL THEN 1 ELSE 0 END) = 1
  );

-- Las horas solo existen si el día es por horas (BR-024).
ALTER TABLE work_entry
  ADD CONSTRAINT work_entry_hours_only_when_hourly
  CHECK (
    ("dayType" = 'HOURLY' AND "hoursWorked" IS NOT NULL AND "hoursWorked" >= 0)
    OR ("dayType" <> 'HOURLY' AND "hoursWorked" IS NULL)
  );

-- Descripción obligatoria en adicionales y descuentos (BR-061, BR-071).
ALTER TABLE addition  ADD CONSTRAINT addition_description_required  CHECK (length(trim(description)) > 0);
ALTER TABLE deduction ADD CONSTRAINT deduction_description_required CHECK (length(trim(description)) > 0);

-- La semana tiene fechas coherentes.
ALTER TABLE payroll_week
  ADD CONSTRAINT payroll_week_dates_ordered
  CHECK ("endDate" >= "startDate");

ALTER TABLE worker_rate
  ADD CONSTRAINT worker_rate_dates_ordered
  CHECK ("effectiveTo" IS NULL OR "effectiveTo" > "effectiveFrom");
