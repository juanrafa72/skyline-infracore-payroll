# EXCEL_MAPPING.md

`EXCEL ACTUAL → ENTIDAD EN NUEVO SISTEMA`

Notación de la columna **Acción**:
`DIRECTO` copia · `NORMALIZAR` transformar · `SEPARAR` una columna se parte en varias
entidades · `DERIVADO` se calcula, no se importa · `DESCARTAR` no se migra ·
`MANUAL` requiere decisión humana.

---

## 1. NOMINA 2026 AERIO&UG — hoja `BASE`, tabla `Principal`

| Col Excel | Contenido | → Entidad.campo | Acción | Nota |
|---|---|---|---|---|
| `Tipo` | Aereo / Underground / Admin / BlowFiber | `Operation.code` → `WorkEntry.operationId` | NORMALIZAR | `AERIAL`, `UNDERGROUND`, `ADMIN`, `BLOWFIBER` |
| `Columna1` | `CONCAT("T_",Tipo)` | — | DESCARTAR | artefacto de validación |
| `Nombre` | nombre, alias, cuadrilla o máquina | `Worker` / `Crew` / `Equipment` | **SEPARAR + MANUAL** | ver §1.1 |
| `Día` | `DAY(Fecha)` | — | DERIVADO | |
| `Fecha` | fecha | `WorkEntry.workDate` | DIRECTO | rechazar vacías |
| `Día trabajados` | `Si` / `No` / `0.5` (+ variantes) | `WorkEntry.dayType` | NORMALIZAR | `Si|SI|si → FULL_DAY`, `0.5 → HALF_DAY`, `No|NO|no → NO_WORK` |
| `Observ Trabaj` | Lluvia, Vacaciones, Mantenimiento, Descanso | `WorkEntry.status` + `reasonCode` | NORMALIZAR | |
| `Adicionales` | categoría del adicional | `Addition.category` | NORMALIZAR | Lavar Carros→`OTHER`, Emergencia→`EMERGENCY`, Bono por cumplimiento→`COMPLETION_BONUS`, Prestamo a compañia→**no es adicional**, es `Advance` |
| `Corte` | `"Semana N"` | `PayrollWeek.weekNumber` | NORMALIZAR | extraer entero; verificar contra `workDate` |
| `Valor Día` | `VLOOKUP` a lista Aéreo | `WorkerRate.amount` + `PayrollLine.appliedRate` | **MANUAL** | ⚠️ bug C3: el lookup ignora la operación. **Cada tarifa se revalida antes de migrar.** |
| `Valor adicional` | monto | `Addition.amount` | DIRECTO | categoría desde `Adicionales`; si no hay → `OTHER` con descripción obligatoria |
| `Dctos` | monto | `Deduction.amount` | DIRECTO | categoría desde `Observación Dctos` |
| `Observación Dctos` | 264 textos libres | `Deduction.category` + `.description` | **MANUAL** | ver §1.2 |
| `PAGO TOTAL` | fórmula | `WorkerPayroll.netPay` | DERIVADO | se importa solo como **valor esperado** para generar `Variance` contra el recálculo |
| `Mes`, `Día semana`, `AÑO` | fórmulas | — | DERIVADO | |
| `PROYECTOS` | proyecto/ubicación | `Project.code` | NORMALIZAR | unificar `TUSCALOOSA`→`Tuscaloosa_AL`, `SKYLINE ADMIN`→`SKYLINE_ADMIN`; `NO WORK`→`WorkEntry.status = NO_WORK` |
| `EMPRESA` | ⚠️ **cliente**, no compañía | `Customer.name` vía `Project.customerId` | NORMALIZAR | `SKYLINE ASSET`→no es cliente; marca días sin proyecto |
| `EQUIPO` | cuadrilla | `Crew.code` → `WorkEntry.crewId` | NORMALIZAR | |
| `HORAS` | `IFS(Si→8, 0.5→4, No→0)` | — | **DESCARTAR** | no son horas reales. En el sistema `hoursWorked` solo se llena si `dayType = HOURLY` |
| `PAYROLL` | "Payroll" o 0 | `Worker.isOnFormalPayroll` | NORMALIZAR | ⚠️ mismo bug de lookup: revalidar |
| `DÍAS DEL AÑO`, `DÍAS TRABAJADOS`, `% DÍAS ACTIVOS` | usan `TODAY()` | — | DESCARTAR | se calculan como reporte |
| `NOMBRES UNICOS` | copia parcial | — | DESCARTAR | |

### 1.1 Separación de la columna `Nombre`

Una sola columna contiene tres tipos de entidad. La separación es **manual y confirmada**:

| Valor en Excel | Entidad destino | Ejemplos |
|---|---|---|
| Persona con nombre completo | `Worker` | JHON ROJAS BEDOYA4, ATILIO JOSE ARGUINZONES3 |
| Persona con apodo | `Worker` + `WorkerAlias` | HERBY, DINO, CUBO, CHATO, PALMICHE, MATEO, CACIQUE, AMPARO, PACO |
| Cuadrilla | `Crew` | MISSILES, DIRECCIONAL DRILL, CAMION, ADMIN |
| Máquina / vehículo | `Equipment` | CAPSTAN, Plow-Rent, COMPRESOR 400CC, TORNADO, INTERNACIONAL 2014, MINI ESCAVADORA (JAIRO MEJIA) |

⚠️ **Colisión sin resolver:** `AMPARO`, `CHATO`, `CUBO`, `DINO`, `HERBY`, `MATEO`,
`PALMICHE`, `CACIQUE` aparecen a la vez como trabajador (tarifa 143/103) y como cuadrilla
(`EQUIPO`). Cada caso se decide uno por uno con el negocio antes de migrar.
**NEEDS BUSINESS CONFIRMATION.**

### Resolución de sufijos → `WorkerAlias`

| Patrón | Significado propuesto | Estado |
|---|---|---|
| `NOMBRE` + dígito (`JAIRO MEJIA1`) | misma persona, tarifa distinta | → `WorkerAlias` + `WorkerRate` con vigencias. **Las fechas de vigencia hay que reconstruirlas de los datos: MANUAL.** |
| `-UG`, `-Blow`, `-N` (operación) | misma persona en otra operación | → `WorkerRate` con `operationId` |
| `-N` en Infracore | ¿turno nocturno? | **NEEDS BUSINESS CONFIRMATION (A1)** |
| `-2` en Infracore | ¿tarifa revisada? | **NEEDS BUSINESS CONFIRMATION (A1)** |

Regla de migración: **ningún alias se une automáticamente.** El sistema propone,
una persona confirma, y la confirmación queda auditada.

### 1.2 Los 264 textos de `Observación Dctos`

Se clasifican a mano en dos grupos:

| Grupo | Ejemplos | Destino |
|---|---|---|
| **Descuento real** | `DCTO HOTEL`, `SE LES PERDIO LLAVE`, `DAÑADO` | `Deduction.category` + `description` |
| **Nota operativa (no es dinero)** | `DESCANSO EN TX`, `Jalar fibra se paga a 130`, `ULTIMO DIA DE GRUPO UG`, `solo con infracore`, `ERROR LO DIGITE DOBLE`, `espera nuevo proyecto` | `WorkEntry.notes` o `reasonCode` |

Casos que exigen atención especial:
- `ERROR LO DIGITE DOBLE` (7 filas) → confirma duplicados conocidos: **no migrar esas filas**.
- `lo paga felipe`, `michael paga esto`, `PACO`, `FELIPE` → el costo es de un tercero:
  se modela como reintegro (`Receivable`), no como descuento al trabajador.
- `Jalar fibra se paga a 130` → tarifa distinta por actividad: `WorkerRate` con alcance.

---

## 2. NOMINA 2026 — INFRACORE

Todo lo anterior aplica, más:

| Col Excel | → Destino | Acción | Nota |
|---|---|---|---|
| `UNIDAD DE NEGOCIO` | `Company.code` | NORMALIZAR | `SKYLINE` / `INFRACORE`. **Esta es la compañía legal, no `EMPRESA2`.** |
| `NOTA` | `WorkEntry.notes` | DIRECTO | |
| `EMPRESA2` | `Customer` | NORMALIZAR | `WAITING PROYECT`→`WorkEntry.status = WAITING_PROJECT`, no cliente |
| fila 863 (`Total`) | — | **DESCARTAR** | fila de totales dentro de la tabla (C1) |

### Reglas específicas de este archivo

1. Las **420 filas con `UNIDAD DE NEGOCIO = SKYLINE`** se importan a la compañía Skyline,
   no a Infracore. Antes de importarlas se cruzan contra el libro de Skyline.
2. Los **448 días duplicados entre libros** se marcan `CROSS_COMPANY_DUPLICATE` y
   **quedan retenidos**: no entran hasta que alguien decida cuál manda (A6).
3. Los **15 duplicados internos** se rechazan y se reportan.
4. De los 5 archivos de Infracore existentes se importa **solo el más reciente**
   (`AGOSTO 9`), y se comparan los otros para detectar cambios no explicados.

---

## 3. FORMATO COMIS — hojas `week NN`

**No se importa automáticamente.** El layout cambia entre semanas (§3.1 de
`EXCEL_ANALYSIS.md`). Se procesa con el Import Wizard, semana por semana, con mapeo
guardado por semana y revisión humana.

### Bloque 1 — contratistas (filas ~4–44)

| Col Excel | → Entidad.campo | Acción |
|---|---|---|
| `CONTRATISTA` | `Contractor.name` | NORMALIZAR — `X`, `EXTRA`, `PROVECION` → excepción `MISSING_CONTRACTOR` |
| `PROYECTO` | `Project` + `Customer` | NORMALIZAR — el texto mezcla proyecto, cliente y semana (`BIGHAMN-DUBLIN (WEEK 28)`) |
| `WEEK/CHEQUE` | `Payment.reference` / `SalesInvoice.checkNumber` | SEPARAR — mezcla dos cosas |
| `TOTAL` | `ContractorSettlement.invoiceAmount` | DIRECTO |
| `ADELANTOS/AJUSTE` | `Advance` + `AdvanceRecovery` | **MANUAL** — ⚠️ el signo cambia entre semanas (C5, A5) |
| `DESCUENTOS` | `Deduction` **o** `SalesInvoice.earlyPaymentDiscount` | **SEPARAR + MANUAL** — mezcla descuento al contratista con "pronto pago" del cliente (A4) |
| `TOTAL INVOICE` | `SalesInvoice.amount` | DIRECTO |
| `COMI JRC` | `ContractorSettlement.commissionAmount` | NORMALIZAR — 2 % solo en algunas filas (A2) |
| `TOTAL A CONSIGNAR FZ` | `Payment.approvedAmount` (contratista FORZO) | DIRECTO |
| `GRUPO QUINTERO` | `Payment.approvedAmount` (cuadrilla Quintero) | DIRECTO |
| `TOTAL A CONSIGNAR SKYLINE` | `Payment.approvedAmount` + estado en texto | **SEPARAR** — la columna contiene montos **y** comentarios (`YA SE PAGO`, `Ya se adelanto`). Los textos → `Payment.status` + `notes` |

### Bloques 2–4 — nómina Aéreo / UG / BlowFiber (filas ~49–74)

| Col Excel | → Destino |
|---|---|
| `CONTRATISTA` | `Contractor` o `Crew` |
| `PROYECTO` | `Project` |
| `TEAM` | `Crew` |
| `WEEK` | `PayrollWeek` |
| `TOTAL` | `WorkerPayroll.grossPay` (valor esperado → `Variance`) |
| `DESCUENTOS` | `Deduction` |
| `TOTAL CONSIGNAR` | `Payment.approvedAmount` |
| `VENTA ESTA SEMANA` (col. I) | `SalesInvoice` / `Production` por operación |

### Bloque 5 — pendientes (filas ~75–84)

`FERYLU / GRUA Y PATIOS AMPARO / 3435` → `Vendor` + `CashMovement(OUT, OTHER_EXPENSE)`
`FER RUIZ / FIANZA JESUS $1778 - ARREGLO TRAILA NEGRA $200` → **dos** movimientos, no uno
(la celda `=1778+200` los suma y pierde el detalle)
`ISAAC / PRESTAMO PARA SEGUIR OPERANDO` → `Advance` o `Debt` según A?
`Flat Rock Drilling / ARREGLO MATEO` → `Vendor` + `CashMovement`

### Bloque 6 — adelantos y financiación (filas ~86–97)

| Col Excel | → Destino |
|---|---|
| `TOTAL X PERSONA` | `Advance.amount` por beneficiario |
| `ADELANTOS` | `Advance` |
| `TOTAL CONSIGNAR` | `Payment.approvedAmount` |
| `MENOS 30` | ⚠️ mezcla monto y comentarios (`RETENIDO HASTA QUE MEXICO`, `YA SE PAGO TODO`) → `TransferFee` + `notes` (A3) |

### Bloque 7 — Infracore (filas ~102–122)

| Col Excel | → Destino |
|---|---|
| `CONTRATISTA` / `PROYECTO` | `Contractor` / `Project` — `NOVASITE LLC- $400 DAY RATE - $440 NIGHT RATE` → `Customer` + dos `WorkerRate` (DAY/NIGHT) |
| `DAYS` | `WorkEntry` por día — **no un contador agregado** |
| `TOTAL` / `DESCUENTOS` / `TOTAL CONSIGNAR` | igual que los bloques de nómina |
| `RENTA CARRO CON TARJETA DE NOVASITE PRESTAMO A INFRACORE (Return 8/12/2026)` | `Debt` de Infracore hacia Novasite, con vencimiento |
| `J116 = I116 - H116 = 495,77` | `Variance` **abierta** desde la migración |

---

## 4. FORMATO COMIS — hoja `descuentos`

### B:G — Deuda de Jairo Mejía

```
CHEQUE | WEEK | CONTRATISTA | CONCEPTO | VALOR | TOTAL
```
→ `Debt` (deudor: Jairo Mejía) + un `DebtTransaction` por fila:

| Concepto Excel | `DebtTransaction.type` | Categoría |
|---|---|---|
| `CASH 5000` | `CHARGE` | `CASH_ADVANCE` |
| `HOTEL WEEK 18 CUARTO 1/2/3` | `CHARGE` | `HOTEL` |
| `ADELANTO (junio 6) 10000` | `CHARGE` | `ADVANCE_RECOVERY` → en realidad es un `Advance` |
| `se descuenta 8882.4` | `PAYROLL_RECOVERY` | |
| filas `DESCONTADO HASTA AQUI PA ARRIBA` | — | DESCARTAR (marca visual, no dato) |
| `G25 = G19-G24`, `G27 = G25+G26` | — | DERIVADO (el saldo se calcula) |

### J:L — Cartera

```
RESUMEN (radicado) | DIAS EN CARTERA | VALOR
1004647600 | 21 | 1445.20
```
→ `Receivable` (nueva entidad de Phase 3) o `SalesInvoice` con `status = PENDING`.
`DIAS EN CARTERA` es DERIVADO.

### N:S — Deuda de Paco

Igual que Jairo. Casos especiales:
- `TRAILA ALQUILER(130*3)` → `CHARGE` categoría `RENT`, cantidad 3 × 130 **desglosada**
- `se le regala 1 semana de renta` → `FORGIVENESS` con `approvedById` **obligatorio** (A13)
- `CHEQUE 4 ABONO / 5 ABONO / 6 ABONO` → `PAYMENT` con referencia del cheque

---

## 5. Orden de migración

```
1. Company, Operation, Customer, Project                    ← automatizable
2. Crew                                                     ← automatizable
3. Equipment / Vehicle                                      ← MANUAL (separar de Nombre)
4. Worker + WorkerAlias                                     ← MANUAL (resolver sufijos)
5. WorkerRate  (vigencias reconstruidas)                    ← MANUAL
6. Contractor                                               ← MANUAL
7. PayrollWeek                                              ← automatizable
8. WorkEntry (Skyline + Infracore, con detección cruzada)   ← semiautomático
9. Addition / Deduction (con categorización de los 264 textos) ← MANUAL
10. Advance / Debt / DebtTransaction                        ← MANUAL
11. ContractorSettlement + Payment histórico                ← MANUAL, semana por semana
12. Variance de control: PAGO TOTAL del Excel vs recálculo del motor
```

**Paso 12 es la prueba de aceptación de la migración.** Se recalcula cada semana con el
motor y se compara con el `PAGO TOTAL` del Excel. Toda diferencia queda como `Variance`
abierta, con explicación. **No se cierra la migración con diferencias sin explicar.**

Ningún dato migrado entra como `PAID`: entra como `IMPORTED_HISTORICAL` (BR-153).
