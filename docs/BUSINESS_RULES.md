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
