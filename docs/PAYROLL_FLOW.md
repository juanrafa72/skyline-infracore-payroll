# PAYROLL_FLOW.md

---

## 1. Flujo completo

```
        LEO (Preparer)                RAFAEL (Approver)           TESORERÍA (Payer)
              │                              │                           │
   ┌──────────▼──────────┐                   │                           │
   │       DRAFT         │                   │                           │
   │  captura días,      │                   │                           │
   │  tarifas, adic.,    │                   │                           │
   │  descuentos         │                   │                           │
   └──────────┬──────────┘                   │                           │
              │ calcular                     │                           │
   ┌──────────▼──────────┐                   │                           │
   │      PREPARED       │  ← excepciones CRITICAL bloquean aquí         │
   └──────────┬──────────┘                   │                           │
              │ enviar a aprobación          │                           │
   ┌──────────▼──────────┐                   │                           │
   │  PENDING_APPROVAL   ├───────────────────►                           │
   └─────────────────────┘                   │                           │
              ▲                    ┌─────────┴─────────┐                 │
              │                    │                   │                 │
              │              ┌─────▼─────┐      ┌──────▼──────┐          │
              └──────────────┤ REJECTED  │      │  APPROVED   │          │
                 devuelto    └───────────┘      └──────┬──────┘          │
                 con comentario                        │                 │
                                              ┌────────▼────────┐        │
                                              │  READY_TO_PAY   ├────────►
                                              └─────────────────┘        │
                                                                ┌────────▼────────┐
                                                                │ PAYMENT_IN_     │
                                                                │ PROCESS         │
                                                                └────────┬────────┘
                                                                         │ + comprobante
                                                                ┌────────▼────────┐
                                                                │      PAID       │
                                                                └────────┬────────┘
                                                                         │ recibo generado
                                                                ┌────────▼────────┐
                                                                │   RECONCILED    │
                                                                └────────┬────────┘
                                                                ┌────────▼────────┐
                                                                │     CLOSED      │
                                                                └─────────────────┘
```

---

## 2. Estados y quién puede moverlos

| Estado | Significado | Transición permitida | Rol |
|---|---|---|---|
| `DRAFT` | En captura. Editable. | → `PREPARED` | Preparer |
| `PREPARED` | Calculada y revisada por quien prepara. | → `PENDING_APPROVAL`, → `DRAFT` | Preparer |
| `PENDING_APPROVAL` | Esperando a Rafael. **No editable** por el preparer. | → `APPROVED`, → `REJECTED` | Approver |
| `REJECTED` | Devuelta con comentario obligatorio. | → `DRAFT` | Preparer |
| `APPROVED` | Aprobada. Montos congelados. | → `READY_TO_PAY` (automático) | sistema |
| `READY_TO_PAY` | Visible en el Payment Center. | → `PAYMENT_IN_PROCESS`, → `PENDING_APPROVAL` (devolución) | Treasury |
| `PAYMENT_IN_PROCESS` | Pago iniciado, sin comprobante todavía. | → `PAID`, → `READY_TO_PAY` | Treasury |
| `PAID` | Pagada, con comprobante cargado. **Inmutable.** | → `RECONCILED` | Treasury / Approver |
| `RECONCILED` | Conciliada contra el banco. | → `CLOSED` | Approver |
| `CLOSED` | Cerrada contablemente. Solo lectura absoluta. | — | — |

Reglas duras:
- **No existe transición que salte estados.** La máquina se valida en el backend.
- **Nadie aprueba lo que preparó** (BR: segregación). Si el preparador y el aprobador
  son la misma persona, la transición se rechaza, aunque tenga ambos roles.
- **Tesorería solo ve `READY_TO_PAY` en adelante.** No puede ver ni tocar borradores.

---

## 3. Regla crítica de invalidación de aprobación

### Campos materiales

Si **cualquiera** de estos cambia en una nómina ya `APPROVED` o `READY_TO_PAY`,
la aprobación se invalida y la nómina vuelve a `PENDING_APPROVAL`:

```
trabajador          días (completos / medios / no trabajados)
horas               tarifa aplicada
producción          adicionales (alta, baja, monto, categoría)
descuentos          anticipos y sus recuperaciones
deudas y sus recuperaciones                proyecto
contratista         cuadrilla
gross pay           net pay
```

### Cómo se detecta

Cada `WorkerPayroll` guarda `calculationHash`: un SHA-256 sobre la lista ordenada y
canónica de todas las entradas materiales (no sobre el resultado). Al aprobar se congela
el hash junto con el resultado.

```
antes de cualquier escritura sobre una nómina aprobada:
  nuevoHash = hash(entradasMateriales)
  si nuevoHash ≠ hashAprobado:
      estado          → PENDING_APPROVAL
      approvedById    → null
      approvedAt      → null
      approvalInvalidatedAt / Reason → registrados
      Exception CHANGED_AFTER_APPROVAL nivel CRITICAL
      AuditLog con valor anterior, valor nuevo y campos cambiados
      notificación al aprobador
```

- Se hace en la misma transacción que el cambio. No hay ventana en la que la nómina esté
  aprobada con datos distintos.
- **Nunca hay cambios silenciosos.** Si el sistema no puede invalidar (por ejemplo,
  la nómina ya está `PAID`), rechaza el cambio y exige un ajuste formal.

### Después de pagada

Una nómina `PAID`, `RECONCILED` o `CLOSED` **no se edita nunca**. Corrección solo por:

| Instrumento | Cuándo |
|---|---|
| `ADJUSTMENT` | Corrección de monto hacia arriba o abajo, con nuevo pago o cargo |
| `REVERSAL` | El pago no debió existir. Se anula con contrapartida, no se borra |
| `ADDITIONAL_PAYMENT` | Faltó pagar una parte |
| `CREDIT` | Se pagó de más y queda a favor de la compañía |

El pago original permanece intacto y visible siempre.

---

## 4. Preparación (Leo)

Pantalla `Payroll → Current Week`.

1. **Selección de semana y compañía.** La compañía viene de la sesión.
2. **Carga de días.** Manual, o importada (Phase 2), o desde SharePoint (Phase 2).
3. **Revisión de producción** (Phase 2) contra los días capturados.
4. **Tarifas.** El sistema resuelve la tarifa vigente. Si falta → `MISSING_RATE` `CRITICAL`.
   Leo no puede escribir una tarifa suelta en la nómina: se crea/corrige en el maestro
   con vigencia, y queda auditado.
5. **Adicionales y descuentos.** Categoría + descripción obligatorias.
6. **Anticipos y deudas.** El motor propone la recuperación según la regla de cada uno.
   Leo puede pausar o excluir con motivo; no puede cambiar el monto a mano.
7. **Cálculo.** Botón "Calcular". Se generan las líneas con snapshot de tarifa.
8. **Excepciones.** Panel lateral con todas las detectadas.
9. **Guardar borrador** cuantas veces quiera.
10. **Enviar a aprobación.** Bloqueado si hay `CRITICAL` abiertas.

Leo **no** ve el botón de pagar y el backend rechaza la acción aunque la invoque.

---

## 5. Approval Center (Rafael)

Pantalla dedicada `/approvals`. Diseñada para revisar rápido y decidir.

**Resumen de la semana**
```
Semana 30 · Skyline · 47 trabajadores
Bruto 68.420,00   Descuentos 6.310,50   Neto 62.109,50
Preparada por Leo · 09 ago 2026 14:22
```

**Lo que muestra por trabajador**
- días, horas, tarifa aplicada y de dónde salió
- adicionales y descuentos con su explicación
- anticipos y deudas: saldo antes, recuperación de esta semana, saldo después
- bruto, descuentos, neto
- **variación contra la semana anterior**, con la diferencia en dinero y en %
- comparación contra producción (Phase 2)

**Lo que se destaca automáticamente**
- excepciones `REVIEW_REQUIRED` y `CRITICAL`
- variación por encima del umbral configurable (por defecto ±25 %)
- trabajadores nuevos esta semana
- descuentos o adicionales inusuales respecto al histórico de esa persona
- días duplicados entre compañías

**Acciones**
| Acción | Requiere |
|---|---|
| Aprobar todo | ninguna excepción `CRITICAL`; confirmación explícita |
| Aprobar por trabajador | igual, por línea |
| Rechazar | motivo obligatorio |
| Devolver a Leo con comentarios | comentario obligatorio |

Toda acción queda auditada con el detalle de lo aprobado.

---

## 6. Payment Center (Tesorería)

Pantalla dedicada `/payments`. Solo muestra `READY_TO_PAY` en adelante.

**Lo que NO puede hacer** (bloqueado en el backend, no solo oculto en la UI):
días · horas · tarifa · bruto · descuentos · adicionales · neto.

**Lo que hace**
1. Selecciona los pagos de la semana.
2. Si detecta un error → **Devolver** con motivo obligatorio. Vuelve a `PENDING_APPROVAL`.
3. Marca `PAYMENT_IN_PROCESS`.
4. Registra el pago:

| Campo | Obligatorio |
|---|---|
| Fecha de pago | sí |
| Método (Zelle, ACH, wire, cheque, efectivo) | sí |
| Monto pagado | sí |
| Referencia / número de transacción | sí |
| Notas | no |
| Comprobante bancario (archivo) | **sí para pasar a `PAID`** |

5. Validaciones automáticas:
   - `montoPagado > montoAprobado` → bloqueado, excepción `PAYMENT_EXCEEDS_APPROVED`.
   - `montoPagado < montoAprobado` → permitido pero genera `Variance` abierta.
   - misma referencia repetida → excepción `DUPLICATE_PAYMENT`.
6. Al guardar comprobante → estado `PAID` y se genera el recibo automáticamente.

---

## 7. Comprobante de pago

Se genera al pasar a `PAID`, en PDF real, y se congela (`snapshotJson`).

```
──────────────────────────────────────────────
COMPANY          Skyline Advance Tech
PAYEE            Mario Aponte
PAYROLL WEEK     Semana 30 — 2026
WORK PERIOD      19 jul 2026 – 25 jul 2026
PAYMENT DATE     09 ago 2026

COMPENSATION
  Days worked            5,5
  Hours                  —
  Production             —
  Base earnings     $ 2.200,00

ADJUSTMENTS
  Additions           $   120,00   Bono por cumplimiento
  Reimbursements      $     0,00
  Deductions          $  -180,00   Hotel semana 29
  Advance recovery    $  -250,00   Anticipo 12 jul
  Debt recovery       $  -100,00   Deuda equipo

TOTALS
  Gross pay           $ 2.320,00
  Total deductions    $  -530,00
  Net pay             $ 1.790,00
  Amount paid         $ 1.790,00

PAYMENT
  Method              Zelle
  Reference           ZL-88213
  Account             ****4417

WORKFLOW
  Prepared by         Leo · 09 ago 2026 14:22
  Approved by         Rafael · 09 ago 2026 18:05
  Paid by             Tesorería · 09 ago 2026 19:40

Receipt RCP-2026-000412
──────────────────────────────────────────────
```

- La cuenta bancaria se muestra **enmascarada** siempre.
- Acciones disponibles: descargar PDF, enviar por email, compartir por WhatsApp,
  copiar resumen.
- **Email y WhatsApp permanecen deshabilitados hasta que exista integración real
  (Phase 4).** El sistema nunca dice "enviado" si no envió. Botón visible, deshabilitado,
  con la razón a la vista.

---

## 8. Conciliación y cierre

- **`RECONCILED`**: el pago cuadra con el extracto bancario. Cualquier diferencia queda
  como `Variance` abierta; no se puede conciliar con diferencias sin explicar.
- **`CLOSED`**: cierre contable de la semana. Requiere que todos los pagos de la semana
  estén `RECONCILED` y que no queden excepciones `CRITICAL` abiertas.
- Modificar algo de una semana `CLOSED` genera excepción `CLOSED_PAYROLL_MODIFIED`
  nivel `CRITICAL` y se rechaza.

---

## 9. Motor de cálculo — orden exacto

```ts
calculateWorkerPayroll(input) {
  1. resolveRates()            // tarifa vigente por día, snapshot
  2. calculateBasePay()        // según compensationType
       DAILY_RATE   → Σ (factorDía × tarifaDiaria)   factor: 1 | 0,5 | 0
       HOURLY       → Σ (horas × tarifaHoraria)
       FIXED_WEEKLY → tarifa semanal
       PRODUCTION   → Σ (cantidad × precioUnitario)
       PIECE_RATE   → Σ (piezas × precioPieza)
       PERCENTAGE   → base × porcentaje
  3. calculateAdditions()      // Σ adicionales
  4. calculateGrossPay()       // base + adicionales
  5. calculateAdvanceRecovery()// según regla de cada anticipo, tope = saldo
  6. calculateDebtRecovery()   // según regla de cada deuda, tope = saldo
  7. calculateDeductions()     // manuales + recuperaciones, por prioridad
  8. calculateNetPay()         // bruto − descuentos
  9. calculateVariance()       // contra semana anterior y contra producción
 10. detectExceptions()
}
```

Propiedades garantizadas:
- **Determinista.** Misma entrada, misma salida. No lee reloj ni estado global.
- **Puro.** No escribe en base de datos. Devuelve el resultado; el servicio persiste.
- **Auditable.** Devuelve la traza de cada concepto: de dónde salió cada centavo.
- **En centavos.** Redondeo `ROUND_HALF_UP` una sola vez por concepto.

Si el neto sale negativo: no se paga, se genera `NEGATIVE_PAYROLL` `CRITICAL`, y el
comportamiento por defecto limita el neto a 0 dejando el excedente de descuento como saldo
pendiente para la siguiente semana. **Regla configurable y sin confirmar (A10).**
