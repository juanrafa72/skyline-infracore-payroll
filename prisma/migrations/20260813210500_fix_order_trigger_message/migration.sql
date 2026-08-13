-- El trigger que protege una orden pagada sí bloqueaba el cambio, pero se caía
-- al armar el mensaje: lower() no acepta un tipo enumerado, hay que pasarlo a
-- texto. El resultado era que la operación fallaba con un error de Postgres
-- ("function lower(DisbursementOrderStatus) does not exist") en vez de decir
-- qué pasó. La protección funcionaba; la explicación no.

CREATE OR REPLACE FUNCTION disbursement_order_immutable_when_settled()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status IN ('PAID', 'PARTIALLY_PAID') THEN
      RAISE EXCEPTION 'La orden % ya tiene dinero desembolsado y no se puede borrar. Anulala con motivo.', OLD."orderNumber";
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.status NOT IN ('PAID', 'CANCELLED') THEN
    RETURN NEW;
  END IF;

  IF NEW."totalAmount"       IS DISTINCT FROM OLD."totalAmount"
  OR NEW."amountPaid"        IS DISTINCT FROM OLD."amountPaid"
  OR NEW."workerCount"       IS DISTINCT FROM OLD."workerCount"
  OR NEW."recipientId"       IS DISTINCT FROM OLD."recipientId"
  OR NEW."payrollWeekId"     IS DISTINCT FROM OLD."payrollWeekId"
  OR NEW."orderNumber"       IS DISTINCT FROM OLD."orderNumber"
  OR NEW."companyId"         IS DISTINCT FROM OLD."companyId"
  OR NEW.status              IS DISTINCT FROM OLD.status
  OR NEW.reference           IS DISTINCT FROM OLD.reference
  OR NEW.method              IS DISTINCT FROM OLD.method
  OR NEW."paymentDate"       IS DISTINCT FROM OLD."paymentDate"
  OR NEW."paidById"          IS DISTINCT FROM OLD."paidById"
  OR NEW."paidAt"            IS DISTINCT FROM OLD."paidAt"
  OR NEW."companyNameSnapshot"   IS DISTINCT FROM OLD."companyNameSnapshot"
  OR NEW."recipientNameSnapshot" IS DISTINCT FROM OLD."recipientNameSnapshot"
  OR NEW."weekLabelSnapshot"     IS DISTINCT FROM OLD."weekLabelSnapshot"
  THEN
    RAISE EXCEPTION 'La orden % ya esta % y no se puede modificar. Usa un ajuste o una reversion, que quedan registrados.',
      OLD."orderNumber", lower(OLD.status::text);
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
