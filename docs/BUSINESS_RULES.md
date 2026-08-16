# BUSINESS_RULES.md

Reglas de negocio del sistema. Cada regla tiene ID estable (`BR-xxx`) que se cita en el
código y en los tests.

Estados de una regla:
- **CONFIRMED** — verificable en los Excel o inequívoca.
- **DEFAULT** — decidida por el sistema con un valor por defecto seguro y configurable.
- **NEEDS BUSINESS CONFIRMATION** — puede cambiar dinero. Configurable, bloqueada con
  valor conservador hasta que el negocio confirme.

---

## 1. Compañías y aislamiento

| ID | Regla | Estado |
|---|---|---|
| BR-001 | Existen dos compañías legales: `SKYLINE` (Skyline Advance Tech) e `INFRACORE` (Infracore Systems LLC). | CONFIRMED |
| BR-002 | Todo registro transaccional pertenece a **exactamente una** compañía. No existe registro compartido. | CONFIRMED |
| BR-003 | Ninguna consulta de negocio se ejecuta sin filtro de compañía. Se aplica en el backend. | CONFIRMED |
| BR-004 | El dashboard consolidado es solo agregación de lectura. Nunca crea ni modifica registros. | CONFIRMED |
| BR-005 | Un usuario con permiso puede cambiar de compañía activa; el cambio queda en el audit log. | CONFIRMED |
| BR-006 | Si Infracore factura a Skyline, es una transacción intercompañía: dos registros espejo, no uno compartido. | NEEDS BUSINESS CONFIRMATION (A11) |

## 2. Semana de nómina

| ID | Regla | Estado |
|---|---|---|
| BR-010 | La semana de nómina va de **domingo a sábado**, igual que `WEEKNUM` de Excel (sistema US). | NEEDS BUSINESS CONFIRMATION (A12) |
| BR-011 | Una `PayrollWeek` se identifica por `(companyId, year, weekNumber)`. Único. | CONFIRMED |
| BR-012 | El número de semana se calcula y se **almacena**; nunca se recalcula sobre datos históricos. | CONFIRMED |
| BR-013 | Una fecha sin semana asignada no puede entrar a una nómina. | CONFIRMED |

## 3. Días trabajados

| ID | Regla | Estado |
|---|---|---|
| BR-020 | Los días se normalizan a: `FULL_DAY`, `HALF_DAY`, `NO_WORK`, `HOURLY`, `OTHER`. Nunca se guarda "Si"/"No" como lógica financiera. | CONFIRMED |
| BR-021 | `FULL_DAY` paga 1,0 × tarifa diaria. | CONFIRMED |
| BR-022 | `HALF_DAY` paga 0,5 × tarifa diaria. | NEEDS BUSINESS CONFIRMATION (A8) |
| BR-023 | `NO_WORK` paga 0. Puede llevar motivo (Lluvia, Vacaciones, Mantenimiento, Descanso). | CONFIRMED |
| BR-024 | `HOURLY` paga `horas × tarifa horaria`. Las horas se **capturan**, nunca se derivan del tipo de día. | CONFIRMED |
| BR-025 | Un `WorkEntry` es único por `(companyId, workerId, workDate)`. Un segundo intento es una excepción `DUPLICATE_WORK_ENTRY`, no un insert. | CONFIRMED |
| BR-026 | Un día `NO_WORK` con motivo `Vacaciones` o `Descanso` puede tener regla de pago propia por compañía. Por defecto: 0. | DEFAULT |

## 4. Tarifas

| ID | Regla | Estado |
|---|---|---|
| BR-030 | Una tarifa vive en `WorkerRate` con `effectiveFrom` / `effectiveTo`, opcionalmente por `projectId`, `operationId` y `shift` (DAY/NIGHT). | CONFIRMED |
| BR-031 | La tarifa aplicable a un día es la vigente en `workDate`, resuelta de más específica a más general: proyecto+turno → proyecto → turno → general. | DEFAULT |
| BR-032 | Al crear una línea de nómina se guarda un **snapshot** de la tarifa aplicada (`appliedRate`, `rateSourceId`). Cambiar la tarifa después no altera la nómina. | CONFIRMED |
| BR-033 | Si no hay tarifa vigente el día **no se paga en cero silenciosamente**: se genera excepción `MISSING_RATE` de nivel `CRITICAL` y la nómina no puede enviarse a aprobación. | CONFIRMED (corrige bug C3) |
| BR-034 | Toda tarifa nueva o modificada registra `approvedBy` y queda en el audit log. | CONFIRMED |
| BR-035 | Los rangos de vigencia de tarifas del mismo alcance no pueden solaparse. | CONFIRMED |
| BR-036 | La tarifa nocturna es una tarifa distinta con `shift = NIGHT`, no un porcentaje sobre la diurna. Evidencia: `$400 DAY RATE / $440 NIGHT RATE`. | NEEDS BUSINESS CONFIRMATION (A1, A9) |

## 5. Sistemas de compensación

| ID | Regla | Estado |
|---|---|---|
| BR-040 | Un `Worker` tiene un `compensationType`: `DAILY_RATE`, `HOURLY`, `FIXED_WEEKLY`, `PRODUCTION`, `PIECE_RATE`, `PERCENTAGE`, `CONTRACTOR_SETTLEMENT`, `MANUAL`. | CONFIRMED |
| BR-041 | `FIXED_WEEKLY` no depende de días trabajados; se prorratea solo si hay regla explícita de prorrateo. Por defecto: no se prorratea. | DEFAULT |
| BR-042 | `PRODUCTION` y `PIECE_RATE` requieren registros de producción (Phase 2). Hasta entonces no se pueden seleccionar. | CONFIRMED |
| BR-043 | `PERCENTAGE` calcula sobre una base explícita (invoice, venta o producción), nunca sobre "lo que quede". | CONFIRMED |

## 6. Motor de cálculo

| ID | Regla | Estado |
|---|---|---|
| BR-050 | Orden de cálculo, sin excepciones:<br>`basePay → additions → grossPay → deductions(prioridad) → netPay` | CONFIRMED |
| BR-051 | `grossPay = basePay + Σ additions` | CONFIRMED |
| BR-052 | `netPay = grossPay − Σ deductions` | CONFIRMED |
| BR-053 | Todo cálculo se hace en centavos enteros. El redondeo `ROUND_HALF_UP` se aplica una sola vez por concepto, no en cadena. | CONFIRMED |
| BR-054 | La misma entrada produce siempre la misma salida. El motor es puro: no lee la hora, no lee `TODAY()`, no consulta estado mutable. | CONFIRMED (corrige bug C11) |
| BR-055 | `netPay` negativo **no se paga**. Se genera excepción `NEGATIVE_PAYROLL` de nivel `CRITICAL`. Comportamiento por defecto: la nómina se limita a 0 y el excedente de descuento queda como saldo pendiente para la siguiente semana. | NEEDS BUSINESS CONFIRMATION (A10) |
| BR-056 | Prioridad de descuentos cuando el neto no alcanza: 1) recuperación de anticipos, 2) recuperación de deuda, 3) los demás. Configurable por compañía. | DEFAULT |

## 7. Adicionales

| ID | Regla | Estado |
|---|---|---|
| BR-060 | Categorías: `BONUS`, `REIMBURSEMENT`, `TRAVEL`, `PER_DIEM`, `COMPLETION_BONUS`, `EMERGENCY`, `MANUAL_ADJUSTMENT`, `OTHER`. Administrables desde Settings. | CONFIRMED |
| BR-061 | Todo adicional lleva categoría, monto, descripción y quién lo creó. La descripción es obligatoria. | CONFIRMED |
| BR-062 | Un adicional se asocia a una semana de nómina y opcionalmente a un día concreto. | CONFIRMED |

## 8. Descuentos

| ID | Regla | Estado |
|---|---|---|
| BR-070 | Categorías: `ADVANCE_RECOVERY`, `DEBT_RECOVERY`, `EQUIPMENT`, `HOTEL`, `VEHICLE`, `LOAN`, `DAMAGE`, `PPE`, `RENT`, `CASH_ADVANCE`, `OTHER`. | CONFIRMED |
| BR-071 | Todo descuento requiere explicación obligatoria. Sin texto no se guarda. | CONFIRMED (corrige C? — hoy 264 textos libres sin categoría) |
| BR-072 | `ADVANCE_RECOVERY` y `DEBT_RECOVERY` **no se capturan a mano**: los genera el motor a partir del anticipo o la deuda. Un usuario no puede inventar una recuperación. | CONFIRMED |
| BR-073 | Un descuento sobre un contratista **nunca** se distribuye automáticamente entre sus trabajadores. Requiere una `DistributionRule` explícita y aprobada. | NEEDS BUSINESS CONFIRMATION (A7) |
| BR-074 | El "descuento pronto pago" que aplica el cliente es una **reducción de ingreso**, no un descuento al trabajador. Van en entidades distintas. | NEEDS BUSINESS CONFIRMATION (A4) |
| BR-075 | El `-30` fijo restado a las consignaciones se modela como `TransferFee` configurable por compañía y método de pago. Por defecto lo asume la compañía, no el trabajador. | NEEDS BUSINESS CONFIRMATION (A3) |

## 9. Anticipos (Advances)

| ID | Regla | Estado |
|---|---|---|
| BR-080 | Estados: `PENDING → APPROVED → ACTIVE → PARTIALLY_RECOVERED → PAID`, o `CANCELLED`. | CONFIRMED |
| BR-081 | El monto original de un anticipo aprobado es **inmutable**. | CONFIRMED |
| BR-082 | Las recuperaciones son movimientos separados (`AdvanceRecovery`), nunca ediciones del anticipo. | CONFIRMED |
| BR-083 | `balance = originalAmount − Σ recoveries`. Se calcula, no se edita. | CONFIRMED |
| BR-084 | Un anticipo requiere aprobador distinto del solicitante. | CONFIRMED |
| BR-085 | Métodos de recuperación: `FIXED_WEEKLY`, `PERCENTAGE_OF_NET`, `PERCENTAGE_WITH_CAP`, `MANUAL`, `LUMP_SUM`. | CONFIRMED |
| BR-086 | Un anticipo puede pausarse o excluirse de una semana concreta, con motivo y usuario registrados. | CONFIRMED |
| BR-087 | La recuperación nunca puede exceder el saldo pendiente. | CONFIRMED |

## 10. Deudas (Debts)

| ID | Regla | Estado |
|---|---|---|
| BR-090 | Una deuda es un libro mayor, no un número: `Debt` + `DebtTransaction`. | CONFIRMED |
| BR-091 | `balance = originalAmount + Σ charges − Σ payments − Σ payrollRecoveries − Σ forgiveness`. Calculado, nunca editable. | CONFIRMED |
| BR-092 | Tipos de movimiento: `ORIGINAL`, `CHARGE`, `PAYMENT`, `PAYROLL_RECOVERY`, `FORGIVENESS`, `ADJUSTMENT`. Cada uno con fecha, monto, motivo y usuario. | CONFIRMED |
| BR-093 | La condonación (`FORGIVENESS`) requiere aprobación explícita de un rol autorizado. | CONFIRMED (hoy: *"se le regala 1 semana de renta"* sin autorización — A13) |
| BR-094 | Reglas de recuperación: monto fijo semanal, porcentaje del neto, porcentaje con tope, pausa, exclusión de semana, pago manual. | CONFIRMED |
| BR-095 | Un movimiento de deuda registrado no se borra. Se corrige con un movimiento de signo contrario. | CONFIRMED |

## 11. Contratistas

| ID | Regla | Estado |
|---|---|---|
| BR-100 | `WorkerPayroll` (nómina de personas) y `ContractorSettlement` (liquidación de contratistas) son entidades **separadas**, con flujos y documentos distintos. | CONFIRMED |
| BR-101 | Un `ContractorSettlement` parte de `invoiceAmount` y aplica sus propios adicionales, descuentos y recuperaciones. | CONFIRMED |
| BR-102 | Los descuentos de un settlement afectan solo al contratista. Ver BR-073. | CONFIRMED |
| BR-103 | La comisión sobre invoice (hoy 2 % "COMI JRC") se modela como `CommissionRule` por cliente/proyecto, con vigencia. No es global. | NEEDS BUSINESS CONFIRMATION (A2) |
| BR-104 | Los adelantos a contratistas se restan del settlement. El signo es siempre negativo. | NEEDS BUSINESS CONFIRMATION (A5) — hoy los Excel lo hacen de las dos formas |

## 12. Cuadrillas y proyectos

| ID | Regla | Estado |
|---|---|---|
| BR-110 | Un `Crew` es una entidad propia. Nunca un `Worker`. | CONFIRMED (corrige C8) |
| BR-111 | La pertenencia a una cuadrilla es histórica: `CrewMembership` con `from`/`to`. Un reporte de una semana pasada usa la composición de esa semana. | CONFIRMED |
| BR-112 | Una cuadrilla tiene a lo sumo un líder vigente a la vez. | CONFIRMED |
| BR-113 | Un `Project` pertenece a una compañía y a un cliente. Las operaciones (Aerial, Underground, BlowFiber, Admin, Data Center) son administrables desde Settings. | CONFIRMED |
| BR-114 | `NO WORK` y `WAITING PROYECT` **no son proyectos**: son estados del `WorkEntry`. | CONFIRMED (corrige el dato actual — A15) |
| BR-115 | El proyecto es de **cada día**, no de la semana. La misma persona puede estar lunes, martes y viernes en un proyecto y miércoles y jueves en otro; la rejilla lo permite por fila («cambió de proyecto entre semana») y el día manda sobre la semana. De ahí sale el cliente al que se le factura ese día. | CONFIRMED (Rafael, 2026-08-15) |
| BR-116 | Una semana ya repartida entre proyectos **no se aplana en silencio**: la fila arranca en modo por día y, si alguien vuelve al selector único, se avisa que al guardar todos los días quedarán en ese proyecto. | CONFIRMED |

## 13. Equipos

| ID | Regla | Estado |
|---|---|---|
| BR-120 | `Equipment` y `Vehicle` son entidades distintas de `Worker`. Su costo diario es costo operativo, no costo laboral. | CONFIRMED |
| BR-121 | Un equipo no recibe pagos. Si hay un pago asociado a un equipo (renta, arreglo), el beneficiario es un `Vendor` o un `Worker`, nunca el equipo. | CONFIRMED |
| BR-122 | El costo de equipo se puede asignar a proyecto y cuadrilla para el margen. | CONFIRMED |

## 14. Precisión financiera

| ID | Regla | Estado |
|---|---|---|
| BR-130 | Todo importe se almacena `Decimal(18,2)` y se opera en centavos enteros. Prohibido `float`. | CONFIRMED |
| BR-131 | Si dos fuentes discrepan se crea un registro `Variance` con las dos cifras y la diferencia. Nunca se ajusta a la fuerza. | CONFIRMED |
| BR-132 | Una diferencia solo se cierra con un movimiento explícito (ajuste, nota de crédito) autorizado y auditado. | CONFIRMED |
| BR-133 | Los totales se recalculan desde las líneas; no se guardan totales que puedan quedar desincronizados sin verificación. | CONFIRMED (corrige C1) |

## 15. Auditoría

| ID | Regla | Estado |
|---|---|---|
| BR-140 | `AuditLog` es append-only: sin `UPDATE`, sin `DELETE`, aplicado con permisos de base de datos. | CONFIRMED |
| BR-141 | Registra: usuario, acción, timestamp, compañía, entidad, id de registro, valor anterior, valor nuevo, razón, semana de nómina. | CONFIRMED |
| BR-142 | La escritura del audit log ocurre en la **misma transacción** que el cambio. Si falla el log, falla el cambio. | CONFIRMED |
| BR-143 | Todo cambio de estado de una nómina, todo pago y todo movimiento de dinero se auditan sin excepción. | CONFIRMED |

## 16. Importación

| ID | Regla | Estado |
|---|---|---|
| BR-150 | Importar es idempotente: clave natural `(companyId, entity, naturalKey)` + hash del archivo. Reimportar no duplica. | CONFIRMED |
| BR-151 | Cada importación registra archivo, hash, lote, usuario, fecha, filas leídas, aceptadas, rechazadas y duplicadas. | CONFIRMED |
| BR-152 | Un lote de importación se puede revertir completo mientras nada de él haya sido aprobado o pagado. | CONFIRMED |
| BR-153 | Los datos importados del histórico **nunca** entran como `PAID`. Entran como `IMPORTED_HISTORICAL`. | CONFIRMED |
| BR-154 | Filas de totales, filas vacías y filas sin fecha o sin persona se rechazan y se reportan. | CONFIRMED (corrige C1) |

## 17. Excepciones

| ID | Regla | Estado |
|---|---|---|
| BR-160 | Niveles: `WARNING`, `REVIEW_REQUIRED`, `CRITICAL`. | CONFIRMED |
| BR-161 | Una nómina con excepciones `CRITICAL` abiertas **no puede** enviarse a aprobación. | CONFIRMED |
| BR-162 | Una nómina con `REVIEW_REQUIRED` abiertas puede enviarse, pero el aprobador las ve destacadas y debe reconocerlas. | CONFIRMED |
| BR-163 | Toda excepción resuelta guarda quién, cuándo y por qué. | CONFIRMED |
| BR-164 | Excepciones mínimas detectadas: `DUPLICATE_WORKER`, `UNKNOWN_WORKER`, `MISSING_RATE`, `DUPLICATE_WORK_ENTRY`, `DUPLICATE_PAYMENT`, `NEGATIVE_PAYROLL`, `UNUSUAL_DEDUCTION`, `UNUSUAL_ADDITION`, `MISSING_PROJECT`, `MISSING_CONTRACTOR`, `AMOUNT_MISMATCH`, `PRODUCTION_MISMATCH`, `CHANGED_AFTER_APPROVAL`, `PAYMENT_EXCEEDS_APPROVED`, `CLOSED_PAYROLL_MODIFIED`, `CROSS_COMPANY_DUPLICATE`. | CONFIRMED |
| BR-165 | `CROSS_COMPANY_DUPLICATE`: la misma persona con el mismo día en las dos compañías. Nivel `CRITICAL`. Existe hoy 448 veces en los Excel. | CONFIRMED (corrige C2) |

## 18. Producción y margen (diseño para Phase 3)

| ID | Regla | Estado |
|---|---|---|
| BR-170 | `Production` se registra por proyecto, cuadrilla, semana y unidad de medida. | CONFIRMED |
| BR-171 | El margen se calcula: `venta − costo contratista − costo nómina − costo equipo − otros costos operativos`. | CONFIRMED |
| BR-172 | El modelo debe permitir margen por compañía, semana, proyecto, cuadrilla, contratista y operación. | CONFIRMED |
| BR-173 | El margen es un reporte derivado. Nunca se almacena como cifra editable. | CONFIRMED |

## 19. Desembolsos: a quién se le transfiere el dinero

La **empresa receptora** es a quién se le manda el dinero para cubrir el pago de
una o varias personas. **No** es la compañía dueña de la nómina: un trabajador
de Skyline puede pagarse enviando fondos a un subcontratista, a una agencia o a
él mismo. Confundirlas rompe la contabilidad, igual que confundir `Company` con
`Customer`.

| ID | Regla | Estado |
|---|---|---|
| BR-180 | Toda nómina debe tener empresa receptora asignada **antes** de aprobarse. Sin ella no se puede saber a quién transferirle. Se impone en `applyTransition`, el único punto por donde pasan todas las aprobaciones. | CONFIRMED |
| BR-181 | La empresa receptora la asigna quien **aprueba**, no quien prepara: preparar es decidir cuánto, aprobar es decidir a dónde. | CONFIRMED |
| BR-182 | La asignación se puede hacer de a uno o a varios a la vez. Solo mientras la nómina no esté aprobada; después hay que devolverla, y eso queda registrado. | CONFIRMED |
| BR-183 | Las nóminas aprobadas se agrupan automáticamente por **(semana + empresa receptora)**. Cada grupo es una `DisbursementOrder`. | CONFIRMED |
| BR-184 | La suma de todas las órdenes debe dar **exactamente** el total aprobado, comparado en centavos enteros y sin tolerancia. Un centavo de diferencia bloquea. | CONFIRMED |
| BR-185 | Cada orden lleva un consecutivo único por compañía y año (`OD-<COMPAÑÍA>-<AÑO>-<NNNN>`), generado con una instrucción atómica para que dos personas aprobando a la vez no saquen el mismo número. | CONFIRMED |
| BR-186 | La orden congela snapshots: nombre de la compañía, de la empresa receptora, de cada trabajador, su monto y la semana. Renombrar algo después no altera un documento ya emitido. | CONFIRMED |
| BR-187 | Una orden puede tener muchos trabajadores; una nómina puede generar muchas órdenes; una orden corresponde a **una sola** empresa receptora. | CONFIRMED |
| BR-188 | Lo transferido tiene que ser **exactamente** la suma de las personas marcadas. Si no coincide, no se registra nada: un número que no cuadra con nadie hace imposible saber a quién le llegó. | CONFIRMED |
| BR-189 | Un giro que no cubre a toda la orden exige explicación por escrito. La orden queda `PARTIALLY_PAID` y el resto sigue pendiente en ella. | CONFIRMED |
| BR-190 | Una orden pagada o anulada es inmutable: montos, receptora, semana, referencia y snapshots quedan congelados por trigger. Solo se pueden agregar comprobantes y el registro de envío a contabilidad. | CONFIRMED |
| BR-191 | Devolver una nómina que ya está en una orden **sin pagar** la saca de la orden y recalcula el total; si la orden queda vacía se anula con el motivo. Si la orden ya movió dinero, la nómina **no** se devuelve: se corrige con un ajuste. | CONFIRMED |
| BR-192 | Una empresa receptora con historial no se borra: se desactiva. Impuesto por trigger, para que el historial contable no quede apuntando a nada. | CONFIRMED |
| BR-193 | El PDF de la orden debe traer el detalle completo por trabajador, no solo el total. Un soporte que solo diga «empresa + monto» no explica por qué salió el dinero. | CONFIRMED |
| BR-194 | Se registra quién asignó la receptora, quién la creó, quién aprobó, quién pagó, cuándo, con qué referencia y a quién se le envió el soporte. | CONFIRMED |
| BR-195 | Cada renglón dice **contra qué** se paga —días de la persona, registros de producción de la cuadrilla, días × costo del equipo— junto al monto: en el resumen previo a aprobar, en el centro de pagos y en el PDF de contabilidad. Aprobar un número sin saber a cuántos días equivale es aprobar a ciegas. El texto se **congela** en el renglón de la orden (`itemDetailSnapshot`, BR-186); las órdenes emitidas antes de que existiera salen sin él — no se inventa. | CONFIRMED (Rafael, 2026-08-15) |
| BR-196 | El pago se registra **únicamente desde la orden de desembolso**. Existía una segunda puerta que pagaba persona por persona sin tocar la orden: el dinero salía y la orden seguía abierta, invitando a pagar dos veces. Una sola puerta, y la orden siempre refleja lo transferido. | CONFIRMED (Rafael, 2026-08-15) |
| BR-197 | Tesorería puede **devolver a aprobación** renglones que todavía no se han pagado —persona, cuadrilla o equipo— con motivo escrito: el renglón sale de la orden, el total se recalcula y la orden que queda vacía se anula (BR-191). Lo pagado no se devuelve: se corrige con un ajuste. | CONFIRMED |
| BR-198 | Lo que quedó **aprobado sin orden** se agrupa desde la pantalla de pago, pero lo hace quien **aprueba**, no quien paga: agrupar es la última parte del acto de aprobar y quien paga no decide a qué empresa receptora va nada (extiende BR-181). | CONFIRMED |

---

## Cómo se resuelve un `NEEDS BUSINESS CONFIRMATION`

1. Vive como fila en `CompanySetting` con `key`, `value`, `confirmed = false`.
2. La UI muestra una insignia **"Regla sin confirmar"** en cada pantalla donde influye.
3. Mientras `confirmed = false` el motor usa el valor por defecto conservador
   (el que menos dinero mueve) y lo indica en el detalle del cálculo.
4. Al confirmarla queda registrado quién y cuándo, en el audit log.
5. Confirmar una regla **no recalcula nóminas ya aprobadas o pagadas**.

## 20. Venta y margen

El sistema conocía solo el costo. Estas reglas agregan el otro lado: lo que el
cliente nos paga, y la diferencia entre ambos.

| ID | Regla | Estado |
|---|---|---|
| BR-200 | La tarifa de VENTA (`BillingRate`) se congela en cada línea igual que la de costo. Renegociar el contrato hoy no altera una semana ya calculada. | CONFIRMED |
| BR-201 | Un día solo se factura si su proyecto tiene cliente. Sin cliente no hay a quién cobrarle, y eso se dice: **no se asigna el cliente más probable**. | CONFIRMED |
| BR-202 | El costo del margen es el **bruto**, no el neto. Descontar un préstamo no abarata la mano de obra: solo recupera plata ya entregada. Con el neto, prestarle a alguien "subiría" el margen. | CONFIRMED |
| BR-203 | Una venta desconocida **no es cero**. Los días sin tarifa se cuentan aparte, la venta se muestra como parcial y el porcentaje no se calcula. Un margen sobre información incompleta tiene que decirlo. | CONFIRMED |
| BR-204 | Precedencia de la tarifa de venta: proyecto+turno → proyecto → cuadrilla → operación → turno → general. Lo que no encaja se descarta; nunca se aproxima. | CONFIRMED |
| BR-205 | Dos tarifas de venta del mismo alcance no pueden solaparse en el tiempo (`EXCLUDE USING gist`). Si no, un día se facturaría a dos precios según cuál leyera primero la consulta. | CONFIRMED |
| BR-206 | Cambiar un precio es **cerrar la vigente y abrir una nueva** desde la fecha del cambio. No existe editar una tarifa vigente. | CONFIRMED |
| BR-207 | Solo las líneas de trabajo se facturan. Adicionales y descuentos son acuerdos internos y no se le cobran al cliente. | CONFIRMED |
| BR-208 | El margen porcentual se calcula sobre la venta, en enteros, redondeando una sola vez. Venta en cero devuelve "sin respuesta", no 0%. | CONFIRMED |

**Valores vigentes** (configurables, con fecha de vigencia — no están en código):
Infracore → SOUTHER FIBER SOLUTIONS: día $600, noche $660. Costo Infracore →
Novasite: día $400, noche $440, que vive en `WorkerRate` como siempre.

## 21. Producción: los dos precios

| ID | Regla | Estado |
|---|---|---|
| BR-210 | Una negociación por unidad lleva **dos** precios: `pricePerUnit` (lo que le pagamos a la cuadrilla) y `salePricePerUnit` (lo que el cliente nos paga). Viven juntos porque son una sola negociación. | CONFIRMED |
| BR-211 | Un precio de venta sin cliente no se le puede cobrar a nadie: si se pone venta, el cliente es obligatorio. Lo impide también la base. | CONFIRMED |
| BR-212 | El precio de venta es **opcional**: muchas veces se pacta el costo antes de cerrar la venta. Sin él la unidad se paga igual, pero no suma margen — y se dice. | CONFIRMED |
| BR-213 | Al registrar producción se congelan los dos precios (`appliedPrice`, `appliedSalePrice`). Renegociar después no altera lo ya registrado. | CONFIRMED |
| BR-214 | Una negociación que deja pérdida **no se bloquea** —a veces se hace a propósito— pero se avisa con el monto exacto por unidad antes y después de guardar. | CONFIRMED |
| BR-215 | Un mismo corte semanal puede tener días pagados por jornal **y** producción pagada por unidad, incluso de la misma cuadrilla. El margen los suma juntos; mostrarlos por separado daría una cifra que no existe. | CONFIRMED |

## 22. Préstamos y financiaciones

| ID | Regla | Estado |
|---|---|---|
| BR-220 | Un préstamo puede ser a una **persona, una cuadrilla, un contratista o una empresa receptora**. Exactamente uno; la base lo hace cumplir. | CONFIRMED |
| BR-221 | El saldo **no es una columna**: sale de lo prestado menos los abonos. Una columna se desincroniza el día que alguien inserte un movimiento sin actualizarla, y el sistema cobra de más sin que nadie lo note. | CONFIRMED |
| BR-222 | **Nunca se descuenta más de lo que se debe.** Aunque el plan diga $200 y el saldo sea $50, se descuentan $50. | CONFIRMED |
| BR-223 | Quien aprueba un préstamo tiene que ser distinto de quien lo pidió. Misma separación que en la nómina. | CONFIRMED |
| BR-224 | Sin aprobar no se descuenta ni admite abonos. | CONFIRMED |
| BR-225 | Un préstamo sin motivo no se guarda: es plata que salió sin explicación. | CONFIRMED |
| BR-226 | Con método **manual** el sistema NO propone monto: lo decide una persona cada vez, y solo se le avisa el saldo. | CONFIRMED |
| BR-227 | Un préstamo con abonos aplicados no se anula: la plata ya se movió. | CONFIRMED |
| BR-228 | El estado se **calcula** del saldo, no se escribe a mano: uno escrito a mano puede decir «pagado» con saldo pendiente. | CONFIRMED |

## 23. Descuentos y adicionales de la semana

| ID | Regla | Estado |
|---|---|---|
| BR-230 | Todo descuento y todo adicional lleva explicación escrita. Sin ella no se guarda: meses después nadie recuerda por qué se descontó. | CONFIRMED |
| BR-231 | Monto siempre mayor que cero. Un descuento de $0 no es un descuento. | CONFIRMED |
| BR-232 | Las recuperaciones de préstamo (`ADVANCE_RECOVERY`, `DEBT_RECOVERY`) **no se capturan a mano**: las genera el motor desde el préstamo, para que el saldo y el descuento nunca digan cosas distintas. Impuesto por CHECK en la base. | CONFIRMED |
| BR-233 | Anotar un extra a alguien sin nómina en esa semana le abre una en borrador. Si no, habría que calcular antes de poder anotarle el hotel, y nadie trabaja en ese orden. | CONFIRMED |
| BR-234 | Agregar o quitar un extra son campos **materiales**: si la nómina estaba aprobada, la aprobación se cae en el acto y se avisa. Permitir agregar pero bloquear quitar sería incoherente. | CONFIRMED |
| BR-235 | Una nómina **pagada** no admite extras ni quitarlos. Se corrige con un ajuste. | CONFIRMED |
| BR-236 | Un extra con fecha fuera de la semana se rechaza. | CONFIRMED |

## 24. Cuadrillas y equipos como pagables (BR-240 – BR-249)

| # | Regla | Estado |
|---|-------|--------|
| BR-240 | La liquidación de una cuadrilla (`CrewPayroll`) es la Σ de su `Production` en la semana, sumada en centavos. Es un **vehículo de pago**: el margen sigue leyendo `Production` directo. Jamás se emiten líneas `BASE_PRODUCTION` — sería contar cada pie dos veces. | CONFIRMED |
| BR-241 | `syncCrewPayrolls`/`syncEquipmentPayrolls` solo recalculan liquidaciones en estado editable (DRAFT/PREPARED/REJECTED). Lo enviado, aprobado o pagado jamás se recalcula en silencio: se invalida con rastro o se devuelve. | CONFIRMED |
| BR-242 | Aprobar la liquidación de una cuadrilla exige **contratista** además de empresa receptora: a él se le paga (`Payment` tipo CONTRACTOR). La receptora es el conducto; el contratista, el beneficiario legal. | CONFIRMED |
| BR-243 | Los días de la gente de una cuadrilla que cobra por producción son **control interno** (`WorkEntry.isControlOnly`): se anotan, NO generan pago individual, no entran al motor, al roster, al dashboard ni a las huellas de aprobación, y jamás pisan un día pagado. | CONFIRMED (Rafael, 2026-08-14) |
| BR-244 | La producción de una (cuadrilla, semana) cuya liquidación ya movió dinero no se agrega ni se borra: se corrige con ajuste. Sobre una aprobada se permite, pero la aprobación se cae en el acto con rastro. `deleteProduction` estuvo sin guarda alguna; ya no. | CONFIRMED |
| BR-245 | La liquidación de un equipo es días marcados × `dailyCost` **congelado al calcular**. Solo los `RENTED` liquidan; los `OWNED` son costo interno (A14). Sin costo diario: error CRÍTICO — jamás se paga $0.00 en silencio. | CONFIRMED |
| BR-246 | Aprobar la liquidación de un equipo exige **proveedor** (BR-121: un equipo jamás recibe pagos). `Payment` tipo VENDOR. | CONFIRMED |
| BR-247 | Un renglón de orden de desembolso referencia **exactamente un** pagable — persona, cuadrilla o equipo (CHECK `disbursement_order_item_one_payable`) — con nombre y cuadrilla congelados (`itemNameSnapshot`, `crewLabelSnapshot`). | CONFIRMED |
| BR-248 | El desglose por cuadrilla del centro de pagos y del PDF sale SOLO de los snapshots del renglón, nunca de joins vivos: el desglose de una orden pagada dice lo que decía el día del pago (extiende BR-186). | CONFIRMED |
| BR-249 | Préstamos vivos del crew o su contratista se AVISAN en la aprobación de su liquidación. El descuento automático dentro de `CrewPayroll` queda para diseño posterior; mientras tanto la recuperación se registra a mano en Préstamos. | CONFIRMED (alcance MVP) |

## 25. Avisos y reinicio de semana (BR-250 – BR-256)

Nacieron de un callejón sin salida encontrado probando la aplicación como
usuario: el sistema creaba avisos y **no existía ninguna pantalla para
cerrarlos**. La tabla tiene cuatro estados y el código solo escribía `OPEN`.
Quien corregía el problema seguía bloqueado para siempre.

| # | Regla | Estado |
|---|-------|--------|
| BR-250 | Un aviso se cierra como `RESOLVED` («lo revisé y quedó bien») o `DISMISSED` («no aplica»), **siempre con nota** y con autor. Sin nota no se cierra: un aviso cerrado sin explicación deja el mismo hueco que no poder cerrarlo — dentro de un mes nadie sabe si se corrigió o si alguien lo tapó para poder seguir. | CONFIRMED |
| BR-251 | Cerrar un aviso escribe en el audit log (`EXCEPTION_RESOLVED` / `EXCEPTION_DISMISSED`) en la MISMA transacción, con el motivo. | CONFIRMED |
| BR-252 | Un aviso **frena un pago** solo si es `CRITICAL` **y** está `OPEN` **y** salió del trabajo de la semana **y** apunta a un pagable concreto. La regla vive en `payroll/exceptions/index.ts` (puro) y la usan por igual el motor de flujo, la pantalla de la semana y el tablero de inicio. | CONFIRMED |
| BR-253 | Los avisos que trajo la importación del Excel (`entityType: ImportBatch`, o los códigos `DUPLICATE_WORK_ENTRY`, `CROSS_COMPANY_DUPLICATE`, `DUPLICATE_WORKER`, `REVIEW_ENTITY_TYPE`) **NUNCA frenan una semana nueva**: la importación no crea nóminas (BR-153), así que esos días ya se pagaron por fuera. Antes sí frenaban, y como no había dónde cerrarlos, importar el histórico dejaba la aplicación trancada para siempre. Se archivan en bloque. | CONFIRMED |
| BR-254 | Cada aviso se muestra con **qué pasó** y **qué hacer** en palabras del negocio, nunca el código en inglés. Un código sin texto propio cae en un texto genérico, jamás en el código crudo. | CONFIRMED |
| BR-255 | «Empezar de cero» borra las liquidaciones de los tres pagables y sus avisos, y **conserva** los días marcados, la producción capturada y los descuentos y adicionales manuales. Deshace el CÁLCULO, no el trabajo: volver a teclear lo capturado es lo que hace odiosa una aplicación. | CONFIRMED |
| BR-256 | «Empezar de cero» se **niega por completo** si algún pagable de la semana está `PAID`, `RECONCILED` o `CLOSED` — no borra nada y lo explica (regla 6: lo pagado se corrige con un ajuste). Antes de borrar, cada pagable sale de su orden por `detachPayable`, que recalcula el total y anula la orden que se quede vacía (BR-191). Exige motivo y queda en el audit log como `WEEK_RESET`. | CONFIRMED |

## 26. Contratistas: calculadora y conciliación (BR-260 – BR-266)

El ejemplo que dio el negocio: **Hugo** trabajó un proyecto a **$0.30 por pie**,
construyó **10.000 pies** → se le deben **$3.000**. Hugo tiene gente a cargo
(Francisco, Juan, Eduardo) con la tarifa que él pactó con cada uno. Le pagamos
a Hugo un solo cheque y él le paga a los suyos, pero llevamos el desglose para
poder verificar contra lo que dice SharePoint.

| # | Regla | Estado |
|---|-------|--------|
| BR-260 | Lo que se le paga a un contratista por una semana es **Σ (cantidad × tarifa)** de su producción. La tarifa se puede editar en cualquier momento mientras la liquidación sea editable, y la cuenta se rehace. | CONFIRMED (Rafael, 2026-08-15) |
| BR-261 | Un **precio unitario** admite hasta **4 decimales** y viaja en diezmilésimas hasta multiplicarse por la cantidad (`unitPriceTotal`); el redondeo a centavos ocurre UNA vez, sobre el resultado. `toCents` sigue rechazando más de 2 decimales para IMPORTES, y hace bien: son cosas distintas. Redondear $0.3025 a $0.30 sobre 10.000 pies se lleva $25. | CONFIRMED |
| BR-262 | El desglose de una cuadrilla (`CrewPayrollMember`) NO genera pagos ni entra al motor: el pago sale completo al contratista (BR-242). Existe para hacer **verificable** el total. El contratista lleva su propio renglón (`isContractor`) porque su parte también cuenta en la suma. | CONFIRMED (Rafael, 2026-08-15) |
| BR-263 | Cada renglón del desglose lleva su tarifa, su unidad (semana/día/pie/unidad/fijo) y su cantidad, **editables al montar la nómina** sin tocar el catálogo: lo pactado con la gente de un contratista cambia de semana a semana. El nombre queda congelado en el renglón. | CONFIRMED (Rafael, 2026-08-15) |
| BR-264 | Lo que dice la fuente externa (`expectedTotal`) se **teclea**: Microsoft rechaza extraer la base de SharePoint (406, etiqueta de confidencialidad). Vacío = sin conciliar, que NO es cero — regla 11. Queda quién concilió y cuándo. | CONFIRMED |
| BR-265 | La conciliación **muestra la diferencia**, jamás la ajusta — regla 10. Cuatro estados: cuadra, no cuadra, falta el desglose, sin conciliar. Con desglose se compara contra la suma del desglose; sin él, contra la producción, y se avisa que falta. | CONFIRMED |
| BR-266 | El desglose de una liquidación **pagada** es intocable (trigger `crew_payroll_member_frozen_when_paid`): es el soporte de por qué salió esa plata. Guardar el desglose invalida la aprobación si ya la había — quien aprobó vio otra tabla. | CONFIRMED |

## 27. Equipos en la semana (BR-270 – BR-273)

| # | Regla | Estado |
|---|-------|--------|
| BR-270 | El bloque de equipos de la semana muestra los **propios Y los rentados**, con filtro para separarlos. El negocio decide semana a semana cuál estuvo en obra; esconder los propios obligaba a llevar esa cuenta por fuera. | CONFIRMED (Rafael, 2026-08-15) |
| BR-271 | Un equipo **PROPIO se marca pero NUNCA genera liquidación de pago**: no hay proveedor a quién pagarle y crearla pondría una transferencia por una máquina que ya es nuestra. Solo RENTED liquida (A14, BR-245). Si un equipo pasa de rentado a propio, su liquidación editable sobrante se retira. | CONFIRMED |
| BR-272 | El alquiler se paga **por día** y se le carga a un **proyecto**: sin proyecto no se sabe a qué obra cargarle el costo. El proyecto se elige por equipo en la semana; si el equipo se mueve de obra, los días existentes se reasignan sin borrarse ni recrearse. | CONFIRMED (Rafael, 2026-08-15) |
| BR-273 | El proyecto que se propone sale del primer día ya marcado, y si no hay ninguno, del asignado en la ficha del equipo. Propone; el usuario confirma. | CONFIRMED |

## 28. Aprobación agrupada (BR-280 – BR-282)

| # | Regla | Estado |
|---|-------|--------|
| BR-280 | La pantalla de aprobar agrupa **por defecto** por empresa receptora, con el **total de cada grupo siempre visible**, antes de aprobar. Es el orden en que tesorería mueve el dinero: una transferencia por receptora. El ejemplo del negocio: Juan Rafael y Juan José a FORZO, Federico a Quintero → los dos de FORZO quedan juntos con su total. | CONFIRMED (Rafael, 2026-08-15) |
| BR-281 | Los que aún **no tienen receptora van todos en UN solo grupo y de primeros**: son los que frenan la aprobación (BR-180), y repartirlos o dejarlos al final los esconde. | CONFIRMED |
| BR-282 | Los totales de grupo se suman en **centavos enteros** con la misma aritmética del motor: sumar pesos con decimales en el navegador puede dar un centavo distinto al del servidor, y ese centavo sería una diferencia sin explicar. Se muestra el total del grupo y, si difiere, el de lo marcado. | CONFIRMED |

## 29. Guía visual del paso siguiente (BR-290)

| # | Regla | Estado |
|---|-------|--------|
| BR-290 | Al guardar los días, el botón **«Calcular nómina» late** y la página baja hasta él; al calcular, late **«Enviar a aprobación»**. La aplicación señala sola dónde seguir. El pulso es lento y se **detiene solo** tras unos segundos —una animación eterna se vuelve ruido que el ojo ignora— y se apaga por completo para quien pidió menos movimiento en su sistema (`prefers-reduced-motion`), dejando en su lugar un borde marcado. La marca viaja en la URL (`?guardado=`), no en un estado del navegador: tiene que sobrevivir a la recarga que hace el servidor al guardar. | CONFIRMED (Rafael, 2026-08-15) |

## 30. Hoja de vida de equipos (BR-300 – BR-304)

| # | Regla | Estado |
|---|-------|--------|
| BR-300 | Cada equipo tiene una **hoja de vida**: seguros, títulos, matrículas, revisiones, mantenimientos y garantías, con su número, fechas, costo y quién lo expidió. El archivo vive en SharePoint; la base guarda la referencia (fronteras de proveedores). | CONFIRMED (Rafael, 2026-08-15) |
| BR-301 | La fecha de vencimiento se **teclea**, no se deduce del PDF. El aviso tiene que ser infalible: uno que dependa de que un robot lea bien un documento escaneado falla justo cuando importa, y uno se entera cuando ya venció. | CONFIRMED (Rafael, 2026-08-15) |
| BR-302 | El plazo de aviso es **por documento** (un seguro con 30 días, un cambio de aceite con 7), entre 0 y 365. Un documento **sin** fecha de vencimiento —un título de propiedad— NO está vencido: es `SIN_VENCIMIENTO`, la misma regla 11 de siempre. | CONFIRMED |
| BR-303 | Lo vencido y lo por vencer aparecen en el **tablero de inicio**, no solo dentro de la ficha: nadie entra equipo por equipo a revisar fechas. Lo vencido es crítico —esa máquina está trabajando sin cobertura—, lo por vencer es advertencia. | CONFIRMED |
| BR-304 | Un documento reemplazado por su renovación se **archiva, no se borra**: la historia de pólizas de una máquina es parte de su hoja de vida. Archivado deja de avisar — si no, cada póliza vieja avisaría para siempre. | CONFIRMED |

## 31. Histórico de pagos (BR-310 – BR-313)

| # | Regla | Estado |
|---|-------|--------|
| BR-310 | Existe un **histórico de todo lo pagado**: qué se pagó, a quién, cuándo, cómo (medio, banco, referencia) y **contra qué** (cada renglón con su detalle). Con filtros por fecha, empresa receptora, tipo de pagable y texto libre, todos en la URL para poder guardar o compartir una consulta. | CONFIRMED (Rafael, 2026-08-15) |
| BR-311 | El histórico se arma con los **snapshots de la orden**, nunca con consultas vivas: si mañana cambia el nombre de una empresa receptora o de un trabajador, el histórico sigue diciendo lo que decía el día del pago (extiende BR-186, BR-248). | CONFIRMED |
| BR-312 | «Falta por pagar» es **lo que falta de cada orden**, no su total: una orden pagada a medias ya movió parte del dinero. Una orden **anulada no cuenta como pendiente** — ya no va a salir. | CONFIRMED |
| BR-313 | El rango de fechas se mide por la **fecha de pago** cuando existe, y por el período de la semana cuando no: una orden sin pagar todavía no tiene fecha de pago, y dejarla fuera del filtro la escondería justo cuando hay que perseguirla. | CONFIRMED |

## 32. Envío de reportes por correo (BR-320 – BR-325)

| # | Regla | Estado |
|---|-------|--------|
| BR-320 | **Cada reporte enviado lleva un consecutivo único** (`RP-SKYLINE-2026-0012`), sacado con la misma instrucción atómica de las órdenes. Sirve para reclamar el que falta: con un asunto de correo repetido eso es imposible. | CONFIRMED (Rafael, 2026-08-15) |
| BR-321 | Los destinatarios son una **lista configurable**, no dos campos fijos: el negocio pidió la auxiliar contable y la empresa receptora «y las que sean necesarias». Cada uno puede recibir todos los reportes o solo ciertos tipos, y en copia oculta si se marca. | CONFIRMED (Rafael, 2026-08-15) |
| BR-322 | Un destinatario atado a una empresa receptora recibe **SOLO las órdenes de esa empresa**. Mandarle a un contratista el desprendible de otro le expone lo que se le paga a un tercero. | CONFIRMED |
| BR-323 | El registro del envío se crea **siempre**, incluso si el correo falla: queda el consecutivo, a quién iba (con el correo **congelado**) y el motivo del fallo. Un envío fallido sin rastro se repite sin que nadie se entere. | CONFIRMED |
| BR-324 | Un envío **ya realizado es inmutable** (trigger `report_dispatch_sent_is_immutable`): es la prueba de que el soporte salió. Para volver a mandarlo se hace un envío nuevo, con su propio consecutivo. | CONFIRMED |
| BR-325 | **Sin cuenta de correo configurada, la aplicación NO dice que envió.** Queda en modo registro: numera, guarda a quién iba y avisa en pantalla que falta conectar la cuenta y que hay que mandar el PDF a mano. Marcar como enviado algo que no salió haría que contabilidad diera por recibido lo que nunca llegó. Las credenciales van en el entorno (`SMTP_*`), nunca en la base: una clave en la base termina copiada a un respaldo. | CONFIRMED |

## 33. Que se vea simple (BR-330 – BR-333)

Salieron de recorrer la aplicación como usuario, no de una especificación.

| # | Regla | Estado |
|---|-------|--------|
| BR-330 | La lista de Nómina muestra **solo las semanas trabajadas aquí**; las 137 del archivo del Excel quedan detrás de «ver el archivo completo». La condición vive una sola vez (`week-scope.ts`) y la comparten la pantalla de entrada y la lista: si cada una la escribiera aparte, una podría considerar «con trabajo» lo que la otra manda al archivo. | CONFIRMED (Rafael, 2026-08-16) |
| BR-331 | El bloque de equipos **abre en Rentados**, que es lo que se paga — salvo que no haya ninguno, porque una lista vacía sería peor. Con «Todos» de entrada había que pasar por encima de siete máquinas propias antes de llegar a la que genera una transferencia. | CONFIRMED |
| BR-332 | El selector de proyecto pone arriba **los que ya se usan en la semana**, separados de los demás. Son 21 y el selector sale en cada fila: en una semana de 40 personas son 40 listas de 21 pueblos. Dentro de cada grupo el orden es alfabético y no cambia con cada marca — si cambiara, la posición dejaría de ser memoria muscular. | CONFIRMED |
| BR-333 | Una liquidación **VACÍA** —cero días marcados, cero producción— no sale a aprobación ni se aprueba: aprobar la nada no ordena ningún pago y hace más fácil aprobar de corrido algo que sí importa. **VACÍA no es EN CERO**: a quien un préstamo le come todo el neto sí trabajó y su nómina recorre el flujo completo; y un equipo con días pero sin costo diario sí llega a aprobación, para frenarse ahí con su error crítico (BR-245). Cada tipo de pagable define qué es vacío para él (`isEmpty`). | CONFIRMED |

## 34. Cuadrillas que cobran por día (BR-340 – BR-344)

Lo pidió el negocio: «no solamente son por producción, también pueden ser pagos
fijos por días, pero se le paga a una cuadrilla que igual toca hacerle su
nómina interna». Antes había que inventarle una producción falsa para que el
sistema la liquidara.

| # | Regla | Estado |
|---|-------|--------|
| BR-340 | Una cuadrilla cobra **por producción** (pie construido) **o un precio fijo por día** (`Crew.billingMode`). En los dos casos se le paga al CONTRATISTA (BR-242) y se le lleva su nómina interna (BR-262): cambia de dónde sale el total, no a quién se le paga ni cómo se reparte. | CONFIRMED (Rafael, 2026-08-16) |
| BR-341 | Los días de una cuadrilla de cobro diario (`CrewDayEntry`) **SÍ pagan** — no confundir con los días de control de su gente (`WorkEntry.isControlOnly`), que anotan y no pagan (BR-243). Una cuadrilla no puede cobrar dos veces el mismo día (índice único). Los de una liquidación pagada son intocables (trigger). | CONFIRMED |
| BR-342 | Sin tarifa diaria **no se paga $0.00 en silencio**: la liquidación queda en cero y un aviso CRÍTICO frena la aprobación, igual que un equipo rentado sin costo (BR-245). | CONFIRMED |
| BR-343 | El modo de cobro, los días y la tarifa aplicada quedan **congelados** en la liquidación (`billingModeSnapshot`, `appliedDailyRate`) y entran a la **huella de aprobación**: cambiar un día o la tarifa después de aprobar la tumba, igual que cambiar producción. | CONFIRMED |
| BR-344 | El desprendible dice contra qué se paga según el modo: «3 registros de producción» o «5 días × $800.00». Decir «registros de producción» en una cuadrilla que cobra por día haría buscar una producción que no existe. | CONFIRMED |

## 35. Sacar de las listas sin borrar (BR-350 – BR-353)

Lo pidió el negocio con un caso concreto: «cuando uno incrementa el precio en
los trabajadores de nómina se crea siempre un trabajador nuevo — Jhon $100,
Jhon1 $130 — entonces uno desactivaría el de Jhon solo para no confundirme,
pero no puede borrar los registros de los que se desactiven».

| # | Regla | Estado |
|---|-------|--------|
| BR-350 | Una persona o un equipo se pueden **sacar de las listas** sin borrarse. Es un cambio de estado (`INACTIVE` / `RETIRED`), **jamás un DELETE**: borrar la ficha rompería los pagos que ya se le hicieron. Días, nóminas, pagos y hoja de vida quedan intactos, y el histórico sigue diciendo lo mismo. | CONFIRMED (Rafael, 2026-08-16) |
| BR-351 | Fuera de las listas = **no se ofrece al armar una semana nueva**. Es todo lo que cambia. Con dos JHON en la lista de escoger es cuestión de tiempo marcar el equivocado y pagarle la tarifa vieja. | CONFIRMED |
| BR-352 | **No se puede sacar a alguien con una nómina a medio camino** (preparada, esperando aprobación, aprobada o en pago). Quitarlo lo dejaría a mitad del proceso y quien aprueba lo vería sin poder encontrarlo. Primero se termina de pagarle. Igual para un equipo con liquidación abierta. | CONFIRMED |
| BR-353 | Cada activación y desactivación queda en el audit log con quién y por qué. La regla vive en `lib/catalog/availability.ts` —fuera de la Server Action— para poder probarla sin navegador. | CONFIRMED |

## 36. Tarifas provisionales de $1 (BR-360 – BR-362)

Rafael pidió poner $1 a las 63 fichas sin tarifa «para que no bote error».
Destraba, pero cambia un error ruidoso por uno callado: quien se quede así
cobra $5 por una semana en vez de $650, y eso **ningún error lo avisa**.

| # | Regla | Estado |
|---|-------|--------|
| BR-360 | Una tarifa puesta solo para destrabar se marca en su nota de origen (`NOTA_PROVISIONAL`). El motor la trata como cualquier otra —no se toca el cálculo— pero el sistema puede reconocerla y perseguirla. | CONFIRMED (Rafael, 2026-08-16) |
| BR-361 | Las provisionales se muestran **aparte y como CRÍTICO** en el tablero de inicio y en la pantalla de tarifas, diciendo el riesgo con cifras («cobran $5 por la semana»). Ya no bloquean nada, y por eso hay que gritarlas: un aviso que solo dice «revisar» se ignora. | CONFIRMED |
| BR-362 | El guion `scripts/rate-placeholder.mts` las pone (`--aplicar`), las lista en seco sin escribir nada (sin argumentos) y muestra las pendientes (`--pendientes`). La marca es la MISMA constante que usa la pantalla: si se cambia en un lado, deja de reconocerse en el otro. | CONFIRMED |

## 37. La Base (BR-370 – BR-373)

Rafael la pidió como su hoja de Excel de siempre pero legible: «week, nombre
del trabajador, día, si trabajó o no, tarifa, proyecto, y filtros como Excel,
así uno puede revisar datos entrados en semanas anteriores».

| # | Regla | Estado |
|---|-------|--------|
| BR-370 | Un renglón por día capturado, con semana, fecha, persona, si trabajó, tarifa, lo pagado, proyecto y cuadrilla. Filtros por semana, persona, proyecto, tipo de día y texto libre, todos en la URL para poder guardar o compartir una vista. | CONFIRMED (Rafael, 2026-08-16) |
| BR-371 | Abre en **la semana más reciente con trabajo nuestro**, y el selector va de la más nueva a la más vieja — «lo primero que veo es week 33 y lo último week 1». Los días del Excel son archivo y solo salen si se piden. | CONFIRMED (Rafael, 2026-08-16) |
| BR-372 | La tarifa y lo pagado salen de `PayrollLine`, **congelados al calcular** (BR-032). Un día sin calcular NO muestra la tarifa vigente hoy: haría creer que se pagó algo que nunca se pagó. Un día `NO_WORK` dice «no aplica» y uno de control «no paga» — no «sin calcular», que sugiere que falta un paso. | CONFIRMED |
| BR-373 | La pantalla corta en **800 renglones** y lo DICE; la descarga a Excel no tiene ese tope (50.000) porque ahí no hay nada que dibujar. El CSV lleva BOM —sin él Excel daña las tildes— y escapa comillas y comas: «MARTINEZ, ANGELA» partiría la fila. | CONFIRMED |

## 38. Estado en la Base (BR-380 – BR-382)

| # | Regla | Estado |
|---|-------|--------|
| BR-380 | Cada día de la Base muestra **en qué va**, con las palabras del negocio: marcado = **Activo**, enviado = **Pdt. por aprobación**, aprobado = **Pdt. por pago**, con el dinero afuera = **Pagada**. Una devuelta con comentarios dice **Devuelta** —hay que corregirla, no está esperando a nadie— y un día del Excel dice **Archivo**, porque nunca va a tener nómina (BR-153). | CONFIRMED (Rafael, 2026-08-16) |
| BR-381 | La columna que dice cuánto vale ese día se llama **«Vale el día»**, no «Se pagó». Es tarifa × jornada (día completo a $190 = $190; medio día = $95) y NO significa que el dinero salió del banco — eso lo dice el Estado. El nombre viejo confundía las dos cosas. | CONFIRMED (Rafael, 2026-08-16) |
| BR-382 | El estado sale de la nómina de esa persona en esa semana, incluso cuando el día no generó línea de cálculo (los «No trabajó» no la generan). Sin eso, un día de una semana ya pagada saldría como «Activo» y la Base diría que falta algo que ya salió. | CONFIRMED |

## 39. Dos personas en la misma semana (BR-390 – BR-395)

Rafael lo decidió así: «que avise, pero si ya alguien trabajó en ella y la va a
cambiar, tiene que pedirle poner una nota y que quede en la base la nota con el
usuario que la cambió».

El riesgo no se ve hasta que ocurre: la rejilla manda los SIETE días de cada
persona cada vez que se guarda. Si Leo abre la semana el lunes, Rafael marca el
martes a mediodía y Leo guarda a las 5 con su pantalla vieja, el martes de
Rafael desaparece **sin que nadie se entere**.

| # | Regla | Estado |
|---|-------|--------|
| BR-390 | Se avisa **solo** cuando otra persona guardó DESPUÉS de que se abrió la pantalla. Que uno mismo haya guardado dos veces no es choque: es marcar la semana día a día, y frenarlo haría inservible el guardado parcial. | CONFIRMED (Rafael, 2026-08-16) |
| BR-391 | Al detectarlo **no se guarda nada** y se pide una nota (mínimo 5 caracteres). Con la nota escrita sí se guarda, y queda un `WORK_ENTRIES_OVERWRITTEN` en la auditoría con la nota como motivo, quién cambió y a quién le cambió el trabajo. | CONFIRMED (Rafael, 2026-08-16) |
| BR-392 | El aviso **no cuesta el trabajo hecho**: aparece dentro del mismo formulario y lo marcado sigue en pantalla. Si costara volver a marcar la semana entera, el aviso saldría más caro que el choque que evita. | CONFIRMED |
| BR-393 | Los cambios sobre trabajo ajeno se muestran **en la propia semana**, con nombre, fecha y nota. Guardados en una tabla que nadie abre serían como no existir — Rafael pidió que «quede en la base». | CONFIRMED (Rafael, 2026-08-16) |
| BR-394 | Un día sin autor conocido —los 12.906 del Excel y todo lo guardado antes de esta protección— **no acusa a nadie**: sin `updatedById` no hay choque. Tratarlos como «otra persona» le pondría una pared a quien captura solo, que es el caso de casi todos los días. | CONFIRMED |
| BR-395 | Si la marca de apertura llega vacía o ilegible, **se deja pasar**. Un formulario viejo o un campo que no llegó no puede convertirse en una pared: la protección es contra un accidente entre dos personas, no un candado. | CONFIRMED |

## 40. Guardado parcial: hasta dónde va la semana (BR-400 – BR-404)

Rafael: «si uno va a empezar a tirar la nómina día a día, pero no la va a pasar
a aprobación hasta final de la semana, ¿cómo se maneja eso?».

Guardar cuantas veces se quiera ya funcionaba. Lo que faltaba era **verlo**:
una semana a medias y una terminada se veían idénticas, y esa confusión cuesta
en las dos direcciones — o se manda a aprobación sin el jueves, o se deja
quieta una semana que ya estaba lista.

| # | Regla | Estado |
|---|-------|--------|
| BR-400 | **Los días que no han llegado no faltan.** Marcar el sábado un martes no tiene sentido, y contarlo como pendiente volvería el aviso ruido que se aprende a ignorar. Solo cuentan los días ya corridos. | CONFIRMED (Rafael, 2026-08-16) |
| BR-401 | El aviso dice **qué días** faltan por su nombre («falta registrar el martes»), no un porcentaje ni un conteo de casillas. Un número no le dice a nadie qué hacer. Solo cuando ningún día está en blanco del todo se habla de casillas sueltas. | CONFIRMED |
| BR-402 | «No trabajó» **cuenta como registrado**: es una respuesta, no un vacío. Lo que falta es la casilla en «—», que significa que nadie la ha mirado. | CONFIRMED |
| BR-403 | Con días sin registrar, el paso que propone el tablero es **seguir marcando**, no calcular. Empujar a calcular una semana a medias es empujar a pagar de menos. | CONFIRMED |
| BR-404 | Enviar a aprobación con días sin registrar **avisa pero no bloquea**: una semana puede cerrarse antes de tiempo (un corte, alguien que se retira). Lo que no puede es pasar desapercibido — «lo que no quede registrado no se paga en esta semana». | CONFIRMED |

## 41. A quién le llegan los reportes y desde dónde (BR-410 – BR-415)

Rafael, 16/08: «ese correo va a salir por predeterminado a nuestra bookkeeping,
Ana — bookkeeping@dazmarllc.com —, pero debe tener un lápiz al lado para editar
si eso llegara a cambiar, igual que un + para copiarlo a algún otro correo de la
empresa receptora. De qué correo van a salir todavía no sé; lo que sí sé es que
no va a ser el mismo de Skyline y de Infracore, cada uno tiene un dominio
diferente».

| # | Regla | Estado |
|---|-------|--------|
| BR-410 | **Ana (`bookkeeping@dazmarllc.com`) viene puesta de fábrica en las DOS compañías** y recibe todos los reportes. Va en la semilla, no como un paso manual: un sistema que arranca con la lista vacía deja los soportes sin mandar hasta que alguien se acuerde. | CONFIRMED (Rafael, 2026-08-16) |
| BR-411 | El destinatario se corrige desde la pantalla —**el lápiz**— sin borrar y volver a crear. Si el negocio le cambia el nombre o el correo, el siguiente despliegue **no** lo devuelve al valor de la semilla. | CONFIRMED (Rafael, 2026-08-16) |
| BR-412 | El lápiz **no** cambia a qué empresa receptora está atado el destinatario: eso decide qué órdenes recibe, y moverlo junto con el correo haría que alguien empiece a ver desprendibles de un tercero sin notarlo. Para eso se agrega otro y se desactiva el anterior. | CONFIRMED |
| BR-413 | Editar un destinatario **no reescribe la historia**: cada envío guardó a qué correo salió. Cambiar el de hoy no puede cambiar a dónde llegó un reporte de hace tres semanas. | CONFIRMED |
| BR-414 | **El remitente es por compañía** (`SMTP_FROM_SKYLINE`, `SMTP_FROM_INFRACORE`) y **nunca se hereda**. Un reporte de Skyline enviado desde el correo de Infracore le dice al contador que está viendo la nómina equivocada, y suele terminar en spam porque el dominio no cuadra con el servidor. Sin su propio «de», esa compañía se queda en modo registro aunque la otra ya esté enviando. El servidor (host, usuario, clave) sí puede ser compartido: un buzón con dos alias es normal. | CONFIRMED (Rafael, 2026-08-16) |
| BR-415 | El mismo correo no puede quedar dos veces como destinatario general de una compañía —recibiría todo duplicado—. Lo cuida un índice único parcial en la base, porque en Postgres dos nulos no se consideran iguales y la llave compuesta con la empresa receptora no alcanzaba. | CONFIRMED |

| BR-416 | Si la empresa receptora tiene correo en su ficha, **entra sola** a la lista de destinatarios y recibe SOLO sus órdenes. Se pone al crearla o al editarla, que es donde se teclea el correo. Se muestra marcada como «se puso solo». | CONFIRMED (Rafael, 2026-08-16) |
| BR-417 | El automatismo **se calla en cuanto una persona opina**: si el destinatario fue corregido con el lápiz, cambiar el correo de la ficha NO lo pisa; si lo desactivaron, no se vuelve a poner. Un automatismo que insiste después de que le dijeron que no devuelve un correo que alguien quitó a propósito, y el soporte de una empresa termina en la bandeja equivocada. | CONFIRMED (Rafael, 2026-08-16) |
| BR-418 | Cuando el correo de la ficha cambia y el destinatario **todavía era el automático** (dice exactamente el correo anterior), lo sigue. Sin saber cuál era el anterior no se toca nada: es preferible quedarse corto a pisar una corrección. | CONFIRMED |
| BR-419 | El destinatario automático se nombra con el **contacto** de la empresa si lo hay («Isaac Ceballos»), no repitiendo el nombre de la empresa, que ya sale en la columna de al lado. | CONFIRMED |

## 42. Los equipos de la semana se escogen (BR-420 – BR-424)

Rafael, 16/08: «cuando llegamos a equipos de la semana no deja agregar o quitar
equipos; cuando entro a administrar equipos me muestra todos pero no me deja
activarlos para la semana y tampoco volver al menú anterior».

| # | Regla | Estado |
|---|-------|--------|
| BR-420 | La semana tiene **su propia lista de equipos**, como tiene su lista de gente. Antes ofrecía todas las máquinas activas de la compañía, siempre: con cincuenta, quien marca los días recorre una lista donde la mayoría no estuvo en obra, y marcar el equipo equivocado le paga a un proveedor que no trabajó. | CONFIRMED (Rafael, 2026-08-16) |
| BR-421 | Tres pestañas: **Rentados** y **Propios** muestran los de ESTA semana; **Todos** es el catálogo y es donde se agregan o se sacan. Si la semana no tiene ningún equipo todavía, abre en «Todos» — mostrar una lista vacía sin decir dónde está el botón fue exactamente lo que dejó al negocio sin salida. | CONFIRMED (Rafael, 2026-08-16) |
| BR-422 | Un equipo está en la semana si **alguien lo escogió o si ya tiene días o liquidación**. Lo segundo no es un detalle: las semanas anteriores a esta lista no tienen a nadie escogido, y sin esa regla se abrirían vacías y parecería que se borró lo capturado. | CONFIRMED |
| BR-423 | **No se saca de la semana un equipo con trabajo encima.** Con días marcados los borraría sin rastro; con liquidación calculada dejaría plata apuntando a un equipo que ya no está. Primero se le quitan los días o se devuelve la liquidación — actos conscientes y con autor. | CONFIRMED |
| BR-424 | El botón de agregar va **fuera** del formulario de días. Un `<form>` dentro de otro es HTML inválido: el navegador descarta el de adentro y su botón termina guardando los días en vez de agregar el equipo. | CONFIRMED |

## 43. Poder devolverse, y ver el estado de un vistazo (BR-425 – BR-426)

| # | Regla | Estado |
|---|-------|--------|
| BR-425 | Las doce pantallas que cuelgan de Catálogos llevan **«← Catálogos»**. Son rutas de primer nivel, así que el menú lateral no marcaba dónde estaba uno ni ofrecía la vuelta: se entraba a Equipos y no había camino de regreso. Un botón para entrar sin botón para salir es medio camino. | CONFIRMED (Rafael, 2026-08-16) |
| BR-426 | Activar y desactivar personas y equipos es **un solo botón que muestra el ESTADO**: verde «Activo», rojo «Inactivo». Antes decía la acción («Sacar de las listas»), que obliga a leer para saber en qué estado está — al recorrer una lista de 149 personas uno mira el color, no el texto. | CONFIRMED (Rafael, 2026-08-16) |

| BR-427 | La pestaña **Rentados** se ve y se usa como la rejilla de gente: cuántos hay, botón para agregar, y **quitar** en cada fila. Rafael lo pidió así — dos partes de la misma pantalla que hacen lo mismo tienen que verse igual, o cada una se aprende por separado. | CONFIRMED (Rafael, 2026-08-16) |
| BR-428 | Las **cuadrillas de la semana también se escogen**, y pueden ser varias: antes solo aparecían las que ya tenían producción capturada, así que no había por dónde empezar a liquidar una nueva. El bloque se muestra aunque no haya ninguna — escondiéndolo, el botón para agregar quedaba adentro de algo invisible. | CONFIRMED (Rafael, 2026-08-16) |
| BR-429 | Agregar una cuadrilla **sin contratista** se permite, pero lo dice en el momento: sin él la liquidación no pasa la puerta de aprobación (BR-240), y enterarse al final es peor que enterarse al principio. | CONFIRMED |

## 44. Las cuadrillas van por SU semana (BR-430 – BR-433)

Rafael, 16/08: «en la cuadrilla uno debe poder seleccionar la semana que está
pagando, porque puede que en nómina de empleados vayamos en la semana 20 pero
en equipos vamos en la 18, y en cuadrillas podemos tener una cuadrilla en week
25 y otra en week 30».

| # | Regla | Estado |
|---|-------|--------|
| BR-430 | Las cuadrillas se liquidan en **pantalla propia**, escogiendo cuadrilla y semana. Lo que manda su calendario es cuándo llega la medición de lo construido, no la semana de la gente. Antes, para liquidar la semana 25 de Hugo había que abrir la página completa de la semana 25 —con su gente y sus equipos, que no tenían nada que ver. | CONFIRMED (Rafael, 2026-08-16) |
| BR-431 | La página de **Nómina sigue mostrando solo las cuadrillas de SU semana**. Mezclar semanas distintas en una vista que se llama «semana 33» haría creer que se está viendo todo lo de esa semana cuando no es así. | CONFIRMED (Rafael, 2026-08-16) |
| BR-432 | Al cambiar de cuadrilla **no se arrastra la semana** de la anterior: se propone la última donde ESA cuadrilla tiene algo. Arrastrarla es exactamente el error que la pantalla existe para evitar. | CONFIRMED |
| BR-433 | La pantalla abre en la cuadrilla que **tiene algo que liquidar**, no en la primera del abecedario. Abrir en una sin contratista y con la vista vacía hace creer que no hay nada que hacer. | CONFIRMED |

## 45. El resumen con el que se manda la semana (BR-440 – BR-444)

Rafael, 16/08: «es importante que Leo, cuando mande lo aprobado, pueda ver un
resumen de lo que está aprobando para darle el último visto bueno, y ya llegue
a mi parte de aprobación y asignación de empresa receptora. Documento resumen
de todo con su consecutivo único».

| # | Regla | Estado |
|---|-------|--------|
| BR-440 | Antes de enviar, quien prepara ve **qué** se va a mandar y **por cuánto**: personal, equipo rentado y cuadrillas, cada uno con su cuenta y su total, y el gran total. Un botón que solo dice un número suelto no permite dar un visto bueno. | CONFIRMED (Rafael, 2026-08-16) |
| BR-441 | Al enviar, ese mismo resumen queda **congelado con un consecutivo** (`RA-SKYLINE-2026-0007`), con quién lo preparó y cuándo. Se puede citar por número entre quien prepara y quien aprueba. | CONFIRMED (Rafael, 2026-08-16) |
| BR-442 | Los totales del resumen **no se recalculan al abrirlo**. Si después cambia un día y el neto cambia, el papel sigue diciendo lo de ese momento — es contra eso que se compara para darse cuenta de que algo se movió. La base lo respalda: el resumen no se modifica ni se borra. | CONFIRMED |
| BR-443 | El resumen se arma **antes** de la transición y se congela **después**. Armarlo después daría cero (ya nada está editable) y congelarlo antes dejaría un papel de un envío que pudo no ocurrir. | CONFIRMED |
| BR-444 | Una semana devuelta y vuelta a mandar genera un resumen **nuevo**; los dos quedan. El histórico de qué se mandó y cuándo es justamente el punto. | CONFIRMED |

| BR-434 | El bloque de equipos abre en **«Activos»**: los que están en obra esta semana, rentados y propios juntos, con la rejilla de días igual que la de la gente. Rentados y Propios parten ese mismo grupo; «Todos» es el catálogo donde se activan. Pedido de Rafael: «una sección de activos para seleccionar cuáles están activos en este momento; se marcan los días igual que arriba». | CONFIRMED (Rafael, 2026-08-16) |
| BR-435 | Una cuadrilla recién agregada **se puede usar de una vez**: se captura lo que construyó en la misma semana, con la tarifa a la vista y editable, y la cuenta se ve mientras se teclea. Antes agregarla no servía de nada —sin producción no hay liquidación, sin liquidación no hay desglose— y la producción se capturaba en otra pantalla que además exigía una negociación creada de antemano. | CONFIRMED (Rafael, 2026-08-16) |
| BR-436 | Si esa cuadrilla no tenía negociación para esa unidad y ese precio, **se le crea** al capturar. Es la misma información; obligar a registrarla aparte antes de poder usarla es lo que hacía la pantalla inservible. La fecha tiene que caer dentro de la semana: fuera del corte se liquidaría en otra y nadie entendería por qué desapareció. | CONFIRMED |

## 46. Que la semana se explique sola (BR-450 – BR-452)

Rafael, 16/08: «cada vez haz lo más intuitivo».

| # | Regla | Estado |
|---|-------|--------|
| BR-450 | **Cada bloque dice en qué va**, con las mismas palabras: la gente («falta registrar el martes»), los equipos («falta el proveedor de 1 equipo») y las cuadrillas («falta capturar lo que construyó 1 cuadrilla»). Lo que frena se dice donde se puede arreglar, no cuando revienta el cálculo — enterarse al final obliga a devolverse. | CONFIRMED (Rafael, 2026-08-16) |
| BR-451 | El botón dice **qué va a calcular**: «Calcular nómina (3 personas, 4 equipos, 2 cuadrillas)». Con tres bloques en pantalla, un botón mudo obliga a devolverse a contar para saber si va a incluir lo que uno acaba de capturar. Cuenta lo mismo que el motor va a mirar; si contara otra cosa, prometería un cálculo que no ocurre. | CONFIRMED (Rafael, 2026-08-16) |
| BR-452 | El paso siguiente aparece **donde uno está mirando**. Tras capturar la producción de una cuadrilla, el botón de calcular sale ahí mismo: decir «presiona Calcular nómina» con ese botón al final de una página larga es mandar a buscar. | CONFIRMED |

## 47. Cheques y retenciones (BR-460 – BR-467)

Rafael, 16/08: «una pestaña que se llame cheques donde Leo puede cargar el
valor del cheque que tiene en la base (SharePoint), traído por una semana o
varias y amarrado a una empresa; después él digita lo que de verdad entró al
banco manualmente y explica si hay un descuento o varios y por qué. Si hay
descuento de retención, esa retención debe ir a una pestaña aparte… amarradas
al cliente que nos pagó… cuántos días, meses lleva… y a qué proyecto están
amarradas, no solo la compañía».

| # | Regla | Estado |
|---|-------|--------|
| BR-460 | Un cheque se anota con **lo que dice el soporte**; lo que de verdad entró al banco se registra después. Son dos momentos —llega el soporte, días más tarde se ve el movimiento— y juntarlos obligaría a esperar para poder anotar el primero. | CONFIRMED (Rafael, 2026-08-16) |
| BR-461 | Un cheque puede cubrir **una semana o varias**, y siempre viene de **un** cliente. | CONFIRMED (Rafael, 2026-08-16) |
| BR-462 | `esperado = entró + descuentos`. Cualquier otra cosa es **plata sin explicar**, y la pantalla dice cuánta. No se bloquea —puede faltar anotar un descuento— pero no se puede dar por bueno en silencio: la retención, que vuelve, se confundiría con plata perdida y nadie la reclamaría. Si entró de MÁS también avisa: es un error de captura. | CONFIRMED (Rafael, 2026-08-16) |
| BR-463 | Todo descuento lleva **motivo obligatorio**. Un descuento sin explicación no se puede reclamar después. Lo respalda un CHECK en la base. | CONFIRMED |
| BR-464 | Solo la **retención** vuelve. Material, daño y anticipo no se recuperan, y por eso no entran a Retenciones — mezclarlos inflaría un saldo que nadie va a cobrar. | CONFIRMED |
| BR-465 | Las retenciones se agrupan por **cliente Y proyecto**, nunca solo por cliente: a Bigham en Dublin le retienen hasta que termine la obra mientras en Chiefland ya soltaron lo suyo. Un total por cliente no se puede reclamar en ninguna parte. Una retención sin obra se muestra aparte y avisa que no se sabrá cuándo la devuelven. | CONFIRMED (Rafael, 2026-08-16) |
| BR-466 | La antigüedad se cuenta desde **la fecha del cheque**, no desde la captura: contarla desde que alguien lo digitó haría ver como nueva una retención de hace seis meses. Se dice en palabras del negocio —«3 meses y 17 días»—, porque «107 días» no sirve para decidir si ya toca reclamar. | CONFIRMED |
| BR-467 | La devolución se anota cuando ocurre, **puede ser parcial**, y nunca por más de lo retenido (CHECK en la base). Lo devuelto deja de contar como saldo vivo pero queda el rastro de cuándo lo soltaron. | CONFIRMED |

| BR-437 | El selector de cuadrillas pone **primero las que tienen contratista**, en su propio grupo, y aparte las que no. Doce de las «cuadrillas» que trajo el Excel son equipos de trabajo internos —CAMION, CUBO, DIRECCIONAL DRILL— y mezcladas alfabéticamente tapaban a los contratistas, que son los que uno viene a liquidar. | CONFIRMED (Rafael, 2026-08-16) |
| BR-438 | A quién se le paga una cuadrilla **se dice desde la semana**, sin ir a Catálogos, y se puede escribir un contratista nuevo. Descubrir que falta justo al liquidar y tener que salir a otra pantalla es lo que hacía el bloque inservible. Si ya existe uno con ese nombre se reutiliza: crear «Hugo» dos veces partiría en dos su historial de pagos. | CONFIRMED (Rafael, 2026-08-16) |

| BR-439 | Al capturar lo que construyó una cuadrilla se muestra **la semana**, no un calendario: «todo lo trabajamos sobre semana» (Rafael, 2026-08-16). No se escoge porque ya se escogió al entrar; un campo de fecha invitaba a teclear un día de otra semana, que después se liquidaría en otra parte sin que nadie entendiera por qué desapareció. En el detalle del contratista, la semana se dice una vez en el encabezado en lugar de repetir la fecha en cada renglón — toda esa producción es de la misma. | CONFIRMED (Rafael, 2026-08-16) |
