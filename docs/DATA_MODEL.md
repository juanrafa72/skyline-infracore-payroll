# DATA_MODEL.md

Modelo de datos inicial. Convenciones:

- Id: `uuid v7` en todas las tablas.
- Dinero: `Decimal(18,2)`. Nunca `Float`.
- Toda tabla transaccional lleva `companyId` **obligatorio**.
- Toda tabla lleva `createdAt`, `updatedAt`, `createdById`.
- Borrado lógico (`deletedAt`) solo en catálogos. **Nunca** en dinero ni en auditoría.

---

## 1. Mapa general

```
Company ──┬── Project ── Customer
          ├── Worker ──── WorkerRate (historial)
          │      └─ WorkerAlias        (resuelve los sufijos del Excel)
          ├── Crew ────── CrewMembership (historial)
          ├── Contractor
          ├── Equipment / Vehicle
          ├── PayrollWeek
          │      ├── WorkerPayroll ── PayrollLine ── Addition / Deduction
          │      └── ContractorSettlement ── SettlementLine
          ├── Advance ── AdvanceRecovery
          ├── Debt ───── DebtTransaction
          ├── Payment ── PaymentProof ── Receipt
          ├── Production   (Phase 2/3)
          ├── SalesInvoice (Phase 3)
          ├── ImportBatch ── ImportRow
          ├── Exception
          ├── Variance
          └── AuditLog
```

---

## 2. Organización y seguridad

### Company
```
id, code ('SKYLINE' | 'INFRACORE'), legalName, displayName,
ein, address, logoUrl, currency ('USD'), timezone,
weekStartDay (default 0 = domingo),   // BR-010
active, createdAt
```

### User
```
id, email (único), name, passwordHash (nullable si entra por Microsoft),
entraObjectId (nullable), mfaSecret, status (ACTIVE|SUSPENDED),
lastLoginAt, mustChangePassword
```

### Role
```
id, code, name, description, isSystem
```
Roles iniciales: `SUPER_ADMIN`, `PAYROLL_PREPARER`, `PAYROLL_APPROVER`, `TREASURY`,
`AUDITOR`, `EMPLOYEE_PORTAL`, `CONTRACTOR_PORTAL`, `CREW_PORTAL`.
**No se hardcodea ninguna persona.** Leo, Rafael y quien pague se asignan desde Settings.

### Permission / RolePermission
```
Permission: id, code ('payroll:prepare', 'payroll:approve', 'payment:execute', ...), description
RolePermission: roleId, permissionId
```

### UserCompanyRole
```
id, userId, companyId, roleId, active, assignedById, assignedAt, revokedAt
```
Un usuario puede tener roles distintos en cada compañía.

### UserSession
```
id, userId, activeCompanyId, ip, userAgent, createdAt, expiresAt, revokedAt
```

---

## 3. Catálogos

### Customer
```
id, companyId, name, code, contactName, contactEmail, contactPhone,
paymentTerms, earlyPaymentDiscountPct (nullable),   // "descuento pronto pago" — BR-074
active
```
Origen: columna `EMPRESA` del Excel (Bigham, Precision Fiber, GTS, K2C, Theo, Souther Fiber,
Blue Streak, JNA, FICOA, VG Tech).

### Operation
```
id, companyId, code, name, active, sortOrder
```
Skyline: `AERIAL`, `UNDERGROUND`, `BLOWFIBER`, `ADMIN`.
Infracore: `BLOWFIBER`, `DATA_CENTER`. Administrable desde Settings (BR-113).

### Project
```
id, companyId, code (único por compañía), name, customerId, operationId,
location, state, projectManagerId, startDate, endDate, active, notes
```
`NO WORK` y `WAITING PROYECT` **no** son proyectos (BR-114): son `WorkEntry.status`.

### Worker
```
id, companyId, code, firstName, lastName, displayName,
personType (EMPLOYEE | CONTRACTOR_MEMBER | ADMINISTRATIVE | SUBCONTRACTOR),
compensationType (DAILY_RATE|HALF_DAY|HOURLY|FIXED_WEEKLY|PRODUCTION|PIECE_RATE|PERCENTAGE|CONTRACTOR_SETTLEMENT|MANUAL),
isOnFormalPayroll (bool),        // columna PAYROLL del Excel
defaultOperationId, defaultCrewId, defaultProjectId,
contractorId (nullable),          // si trabaja bajo un contratista
hireDate, terminationDate, status (ACTIVE|INACTIVE|TERMINATED),
email, phone, portalUserId (nullable),
bankAccountLast4, paymentMethodDefault,
documentsFolderRef, notes
```
**Nunca** contiene equipos ni cuadrillas.

### WorkerAlias
```
id, workerId, alias, sourceFile, sourceSheet, resolvedById, resolvedAt, confidence
```
Resuelve los nombres del Excel (`JAIRO MEJIA1`, `ALEJANDRO APONTE-N`, `ISAAC CEBALLOS-UG3`)
hacia una sola persona. **Cada alias requiere confirmación humana**; nada se une automáticamente.

### WorkerRate  (RateHistory)
```
id, companyId, workerId,
rateType (DAILY|HOURLY|WEEKLY|PIECE|PERCENTAGE),
amount Decimal(18,2),
shift (DAY|NIGHT|ANY),
projectId (nullable), operationId (nullable),
effectiveFrom (date), effectiveTo (date, nullable),
approvedById, approvedAt, sourceNote, active
```
Restricción: no se solapan rangos con el mismo `(workerId, shift, projectId, operationId)`.
Resolución: más específica gana (BR-031).

### Contractor
```
id, companyId, name, legalName, ein, contactName, email, phone,
commissionPct (nullable),          // "COMI JRC" — BR-103
paymentTerms, portalUserId, active
```

### Crew
```
id, companyId, code, name, operationId, contractorId (nullable),
projectId (nullable), leaderWorkerId (nullable), active
```
Origen: columna `EQUIPO` (MISSILES, AMPARO, CHATO, CUBO, DINO, HERBY, MATEO, PALMICHE,
CACIQUE, CAMION, ADMIN, DIRECCIONAL DRILL).

### CrewMembership
```
id, crewId, workerId, role (LEADER|MEMBER), from (date), to (date, nullable)
```
Un solo `LEADER` vigente por cuadrilla (BR-112).

### Equipment
```
id, companyId, code, name,
kind (MACHINE|VEHICLE|TOOL),
ownership (OWNED|RENTED|SUBCONTRACTED),
dailyCost Decimal(18,2), vendorId (nullable),
assignedCrewId, assignedProjectId, status, notes
```
Origen: CAPSTAN, PLOW-Rent, COMPRESOR 400CC, TORNADO, MINI ESCAVADORA, INTERNACIONAL 2014.
**No recibe pagos** (BR-121).

### Vendor
```
id, companyId, name, taxId, contact, category, active
```

---

## 4. Trabajo y nómina

### PayrollWeek
```
id, companyId, year, weekNumber, startDate, endDate,
status (OPEN|CLOSED),
label,                             // "Semana 30"
createdById, closedById, closedAt
UNIQUE (companyId, year, weekNumber)
```

### WorkEntry
```
id, companyId, payrollWeekId, workerId, workDate,
dayType (FULL_DAY|HALF_DAY|NO_WORK|HOURLY|OTHER),   // BR-020
hoursWorked Decimal(6,2) nullable,   // solo si dayType = HOURLY. Nunca derivado.
shift (DAY|NIGHT),
projectId, crewId, operationId,
status (WORKED|NO_WORK|WAITING_PROJECT|RAIN|VACATION|MAINTENANCE|REST|OTHER),
reasonCode, notes,
sourceType (MANUAL|IMPORT|SHAREPOINT), importRowId (nullable),
createdById
UNIQUE (companyId, workerId, workDate)     // BR-025
```
Detector adicional: mismo `(workerId, workDate)` en la **otra** compañía →
excepción `CROSS_COMPANY_DUPLICATE` (BR-165).

### WorkerPayroll
```
id, companyId, payrollWeekId, workerId,
status (DRAFT|PREPARED|PENDING_APPROVAL|REJECTED|APPROVED|READY_TO_PAY
        |PAYMENT_IN_PROCESS|PAID|RECONCILED|CLOSED),
daysFull Int, daysHalf Int, daysNoWork Int, hoursTotal Decimal(6,2),
basePay, additionsTotal, grossPay, deductionsTotal, netPay   // todos Decimal(18,2)
calculationVersion Int,
calculationHash String,           // huella de las entradas materiales — ver PAYROLL_FLOW
preparedById, preparedAt,
approvedById, approvedAt, approvalInvalidatedAt, approvalInvalidatedReason,
rejectedById, rejectedAt, rejectionReason,
paymentId (nullable),
notes
UNIQUE (companyId, payrollWeekId, workerId)
```

### PayrollLine
```
id, workerPayrollId, workEntryId (nullable),
lineType (BASE_DAY|BASE_HALF_DAY|BASE_HOURLY|BASE_WEEKLY|BASE_PRODUCTION|BASE_PIECE|BASE_PERCENTAGE),
workDate, quantity Decimal(10,2),
appliedRate Decimal(18,2),        // SNAPSHOT — BR-032
rateSourceId,                     // WorkerRate del que salió
amount Decimal(18,2),
projectId, crewId, shift, description
```

### Addition
```
id, companyId, workerPayrollId (nullable), contractorSettlementId (nullable),
category (BONUS|REIMBURSEMENT|TRAVEL|PER_DIEM|COMPLETION_BONUS|EMERGENCY|MANUAL_ADJUSTMENT|OTHER),
amount Decimal(18,2), description (obligatorio), workDate (nullable),
createdById, approvedById (nullable)
```

### Deduction
```
id, companyId, workerPayrollId (nullable), contractorSettlementId (nullable),
category (ADVANCE_RECOVERY|DEBT_RECOVERY|EQUIPMENT|HOTEL|VEHICLE|LOAN|DAMAGE|PPE|RENT|CASH_ADVANCE|OTHER),
amount Decimal(18,2), description (obligatorio),
sourceType (MANUAL|ADVANCE_ENGINE|DEBT_ENGINE),     // BR-072
advanceRecoveryId (nullable), debtTransactionId (nullable),
workDate (nullable), createdById, approvedById (nullable)
```

### ContractorSettlement
```
id, companyId, payrollWeekId, contractorId, projectId (nullable),
invoiceNumber, invoiceAmount Decimal(18,2),
additionsTotal, deductionsTotal, advanceRecoveryTotal,
commissionPct, commissionAmount,                    // BR-103
earlyPaymentDiscount Decimal(18,2),                 // BR-074 — reduce ingreso, no pago
netSettlement Decimal(18,2),
status  (mismos estados que WorkerPayroll),
preparedById, approvedById, approvedAt, approvalInvalidatedAt,
paymentId, notes
```
**Separado de `WorkerPayroll`** (BR-100). Sus descuentos no bajan a los trabajadores
salvo una `DistributionRule` explícita y aprobada (BR-073).

### SettlementLine
```
id, contractorSettlementId, lineType, description,
quantity, unitAmount, amount, projectId, crewId, productionId (nullable)
```

---

## 5. Anticipos y deudas

### Advance
```
id, companyId, beneficiaryType (WORKER|CONTRACTOR), workerId, contractorId,
requestDate, amount Decimal(18,2),          // INMUTABLE tras aprobar — BR-081
reason (obligatorio),
recoveryMethod (FIXED_WEEKLY|PERCENTAGE_OF_NET|PERCENTAGE_WITH_CAP|MANUAL|LUMP_SUM),
recoveryAmount, recoveryPct, recoveryCap, recoveryStartWeek,
status (PENDING|APPROVED|ACTIVE|PARTIALLY_RECOVERED|PAID|CANCELLED),
requestedById, approvedById, approvedAt,
paidPaymentId (nullable), notes
```
`balance` no es columna: se deriva de `amount − Σ AdvanceRecovery.amount` (BR-083).

### AdvanceRecovery
```
id, advanceId, payrollWeekId, workerPayrollId (nullable),
contractorSettlementId (nullable), deductionId,
amount Decimal(18,2), recoveredAt, createdById, notes
```

### AdvancePause
```
id, advanceId, payrollWeekId (nullable), from, to, reason, createdById
```

### Debt
```
id, companyId, debtorType (WORKER|CONTRACTOR|VENDOR), workerId, contractorId, vendorId,
originalAmount Decimal(18,2), originDate, reason (obligatorio),
recoveryRule (FIXED_WEEKLY|PERCENTAGE_OF_NET|PERCENTAGE_WITH_CAP|MANUAL|PAUSED),
recoveryAmount, recoveryPct, recoveryCap,
status (ACTIVE|PARTIALLY_RECOVERED|SETTLED|WRITTEN_OFF|PAUSED),
createdById, approvedById
```

### DebtTransaction
```
id, debtId, companyId,
type (ORIGINAL|CHARGE|PAYMENT|PAYROLL_RECOVERY|FORGIVENESS|ADJUSTMENT),
amount Decimal(18,2),      // signo según type
transactionDate, description (obligatorio),
payrollWeekId (nullable), deductionId (nullable), paymentId (nullable),
createdById, approvedById (obligatorio para FORGIVENESS — BR-093)
```
Saldo = suma de movimientos (BR-091). Nunca columna editable.

---

## 6. Pagos y comprobantes

### Payment
```
id, companyId, paymentNumber ('PAY-00321'), payeeType (WORKER|CONTRACTOR|VENDOR),
workerId, contractorId, vendorId,
payrollWeekId, workerPayrollId (nullable), contractorSettlementId (nullable),
approvedAmount Decimal(18,2),     // congelado al aprobar
amountPaid Decimal(18,2),
paymentDate, method (ZELLE|ACH|WIRE|CHECK|CASH|OTHER),
reference, bankAccountLast4, notes,
status (PENDING|IN_PROCESS|PAID|FAILED|REVERSED),
paidById, paidAt, reversedById, reversedAt, reversalReason
UNIQUE (companyId, paymentNumber)
```
Si `amountPaid > approvedAmount` → excepción `PAYMENT_EXCEEDS_APPROVED` nivel `CRITICAL`;
la operación se bloquea.

### PaymentProof
```
id, paymentId, companyId, fileKey, fileName, mimeType, sizeBytes,
sha256, uploadedById, uploadedAt
```
Se sirve solo por endpoint con verificación de permisos y enlace firmado temporal.

### Receipt
```
id, companyId, paymentId, receiptNumber, pdfFileKey,
generatedAt, generatedById, snapshotJson,   // contenido congelado del comprobante
sentEmailAt, sentWhatsappAt, downloadCount
```
`snapshotJson` congela lo mostrado: si algo cambia después, el comprobante emitido no cambia.

### PaymentAdjustment
```
id, companyId, originalPaymentId,
type (ADJUSTMENT|REVERSAL|ADDITIONAL_PAYMENT|CREDIT),   // BR — nómina pagada es inmutable
amount Decimal(18,2), reason (obligatorio),
newPaymentId (nullable), createdById, approvedById, approvedAt
```

---

## 7. Producción, ventas y margen (estructura desde ahora)

### Production
```
id, companyId, payrollWeekId, projectId, crewId, contractorId (nullable),
productionDate, unitType (FEET|EACH|HOUR|LOT), quantity Decimal(14,2),
unitPrice Decimal(18,4), amount Decimal(18,2),
sourceType (MANUAL|IMPORT|SHAREPOINT), externalRef, notes
```

### SalesInvoice / SalesInvoiceLine
```
SalesInvoice: id, companyId, customerId, projectId, invoiceNumber, invoiceDate,
              amount, earlyPaymentDiscount, netAmount, status, paidDate, checkNumber
SalesInvoiceLine: id, salesInvoiceId, productionId (nullable), description, quantity, unitPrice, amount
```

### CostAllocation
```
id, companyId, payrollWeekId, projectId, crewId, contractorId, operationId,
costType (PAYROLL|CONTRACTOR|EQUIPMENT|OTHER_OPERATIONAL), amount
```
Permite el margen por compañía / semana / proyecto / cuadrilla / contratista / operación
(BR-172) sin recorrer todas las tablas.

### CashMovement  (Phase 3)
```
id, companyId, movementDate,
direction (IN|OUT),
category (CUSTOMER_PAYMENT|PAYROLL_PAYMENT|CONTRACTOR_PAYMENT|ADVANCE|OTHER_EXPENSE|PENDING),
amount, reference, relatedPaymentId, relatedInvoiceId, description, createdById
```

---

## 8. Importación, excepciones, diferencias, auditoría

### ImportBatch
```
id, companyId, fileName, fileHash (sha256), sourceType (EXCEL|SHAREPOINT|CSV),
targetEntity, importedById, startedAt, finishedAt,
rowsRead, rowsAccepted, rowsRejected, rowsDuplicated,
status (PENDING|MAPPING|PREVIEW|VALIDATED|IMPORTED|REVERTED|FAILED),
mappingJson, notes
UNIQUE (companyId, fileHash, targetEntity)     // BR-150
```

### ImportRow
```
id, importBatchId, rowNumber, rawJson, naturalKey,
status (ACCEPTED|REJECTED|DUPLICATE), rejectionReason,
createdEntityType, createdEntityId
```

### Exception
```
id, companyId, code, level (WARNING|REVIEW_REQUIRED|CRITICAL),
entityType, entityId, payrollWeekId (nullable), workerId (nullable),
title, detail, expectedValue, actualValue, difference,
status (OPEN|ACKNOWLEDGED|RESOLVED|DISMISSED),
detectedAt, resolvedById, resolvedAt, resolutionNote
```

### Variance
```
id, companyId, context, sourceAName, sourceAAmount, sourceBName, sourceBAmount,
difference Decimal(18,2), payrollWeekId, entityType, entityId,
status (OPEN|EXPLAINED|RESOLVED), explanation, resolvedById, resolvedAt
```

### AuditLog   (append-only)
```
id, companyId, userId, userEmailSnapshot,
action, entityType, entityId,
payrollWeekId (nullable),
oldValueJson, newValueJson, changedFields String[],
reason, ip, userAgent, createdAt
```
Sin `UPDATE` ni `DELETE`: revocado a nivel de base de datos + trigger (BR-140).

### CompanySetting
```
id, companyId, key, value, valueType, confirmed (bool),
confirmedById, confirmedAt, description, needsBusinessConfirmation (bool)
```
Aquí viven todas las reglas marcadas `NEEDS BUSINESS CONFIRMATION`
(medio día, comisión, `-30`, pronto pago, signo de adelantos, semana, neto negativo…).

---

## 9. Índices clave

```
work_entry            (companyId, payrollWeekId, workerId)
work_entry            (companyId, workerId, workDate)  UNIQUE
work_entry            (workerId, workDate)             ← detección cross-company
worker_payroll        (companyId, payrollWeekId, status)
worker_rate           (workerId, effectiveFrom, effectiveTo)
payment               (companyId, status, paymentDate)
audit_log             (companyId, entityType, entityId, createdAt)
audit_log             (companyId, payrollWeekId, createdAt)
exception             (companyId, status, level)
advance_recovery      (advanceId)
debt_transaction      (debtId, transactionDate)
```

## 10. Restricciones a nivel de base de datos

- `CHECK (amount >= 0)` donde el signo lo define el tipo de movimiento.
- `UNIQUE (companyId, workerId, workDate)` en `work_entry`.
- `UNIQUE (companyId, payrollWeekId, workerId)` en `worker_payroll`.
- Exclusión de solapamiento en `worker_rate` (`EXCLUDE USING gist`).
- Trigger que impide `UPDATE`/`DELETE` en `audit_log`.
- Trigger que impide modificar `worker_payroll` en estado `PAID`, `RECONCILED` o `CLOSED`.
- Row Level Security por `companyId` en todas las tablas transaccionales.
