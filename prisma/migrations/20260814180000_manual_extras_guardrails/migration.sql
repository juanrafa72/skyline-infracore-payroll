-- ═════════════════════════════════════════════════════════════
-- BR-072 · Una recuperación de préstamo NO se captura a mano
--
-- La genera el motor a partir del anticipo o la deuda. Si alguien pudiera
-- escribirla a mano, el saldo del préstamo diría una cosa y el descuento otra:
-- se le cobraría a la persona sin que el préstamo bajara, o al reves.
--
-- Se hace cumplir aqui porque la captura manual acaba de abrirse.
-- ═════════════════════════════════════════════════════════════

ALTER TABLE deduction
  ADD CONSTRAINT deduction_recovery_not_manual CHECK (
    category NOT IN ('ADVANCE_RECOVERY', 'DEBT_RECOVERY')
    OR "sourceType" <> 'MANUAL'
  );

-- Y al reves: lo que dice venir del motor tiene que apuntar al movimiento real.
ALTER TABLE deduction
  ADD CONSTRAINT deduction_engine_needs_source CHECK (
    "sourceType" = 'MANUAL'
    OR "advanceRecoveryId" IS NOT NULL
    OR "debtTransactionId" IS NOT NULL
  );

-- Montos coherentes en los adicionales y descuentos de la semana.
ALTER TABLE addition  ADD CONSTRAINT addition_amount_not_zero  CHECK (amount > 0);
ALTER TABLE deduction ADD CONSTRAINT deduction_amount_not_zero CHECK (amount > 0);
