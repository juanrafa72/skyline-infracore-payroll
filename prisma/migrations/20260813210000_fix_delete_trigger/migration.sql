-- El guardián de nóminas pagadas cancelaba en silencio el borrado de las que
-- SÍ se pueden borrar.
--
-- En PostgreSQL, un trigger BEFORE que devuelve NULL cancela la operación. La
-- función terminaba con `RETURN NEW`, y en un DELETE `NEW` es NULL: borrar una
-- nómina en borrador no hacía nada y tampoco avisaba.
--
-- Lo encontraron las pruebas de la lista de personas al no poder limpiar sus
-- propios datos.

CREATE OR REPLACE FUNCTION worker_payroll_immutable_when_paid()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.status IN ('PAID', 'RECONCILED', 'CLOSED') THEN
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

  -- En un DELETE hay que devolver OLD: devolver NEW (que es NULL) cancelaria
  -- el borrado sin decir nada.
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
