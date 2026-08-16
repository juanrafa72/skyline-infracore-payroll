# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Sistema central de **payroll, contractor settlements y control financiero** de
**Skyline Advance Tech** e **Infracore Systems LLC**.

Código y comentarios en español: el negocio los lee. Las especificaciones largas
viven en `/docs`; este archivo es corto a propósito.

---

## Reglas que NUNCA se rompen

1. **Dinero jamás en `float`.** Se almacena en `Decimal(18,2)` y se calcula en
   **enteros de centavos** (`bigint`) dentro del motor. Redondeo `ROUND_HALF_UP`
   una sola vez por concepto, nunca en cadena.
2. **Toda la matemática de dinero vive en `src/lib/payroll/engine/`.** Ningún
   componente, acción, reporte ni migración recalcula montos por su cuenta.
3. **Aislamiento por compañía.** Toda tabla transaccional lleva `companyId` y
   toda consulta lo filtra. La compañía activa sale de la sesión del servidor,
   nunca de algo que mande el navegador.
4. **Segregación de funciones por PERSONA, no por rol.** Quien prepara no
   aprueba; quien aprueba no paga. Tener el permiso no basta si uno hizo el paso
   anterior. Se puede levantar con el modo de una sola persona, pero entonces
   queda marcado (`selfApproved`) y anotado en la auditoría.
5. **Cambio después de aprobar invalida la aprobación.** La huella
   (`calculationHash`) se calcula sobre las ENTRADAS, no sobre el resultado: si
   alguien cambia un día y el neto queda igual, la aprobación se cae igual.
6. **Nómina pagada es inmutable.** Corrección = `Adjustment` / `Reversal` /
   `AdditionalPayment` / `Credit`. Nunca se edita ni se borra el pago original.
7. **Audit log append-only.** Sin `UPDATE`, sin `DELETE`, impuesto por trigger.
   Se escribe en la misma transacción que el cambio que registra.
8. **Snapshot de tarifas, las dos.** Cada línea guarda la tarifa de COSTO
   aplicada y la de VENTA. Cambiar cualquiera hoy no puede alterar una nómina
   histórica. Venta − costo = margen; son los dos lados del mismo día.
9. **Persona ≠ equipo ≠ cuadrilla.** `Worker`, `Equipment` y `Crew` son
   entidades distintas. Los Excel los mezclaban; aquí no.
10. **Las diferencias nunca desaparecen.** Si dos fuentes discrepan se registra
    `Variance` y se muestra. Prohibido "cuadrar" en silencio.
11. **Lo desconocido NO es cero.** Sin tarifa de venta la venta es «no se sabe»,
    y el margen sale marcado como incompleto sin porcentaje. Poner cero
    convertiría una venta desconocida en una pérdida inventada.
12. **Importar dos veces el mismo archivo no duplica.** Idempotencia por
    `(companyId, fileHash, naturalKey)`.
13. **No adivinar reglas de dinero.** Si no se puede verificar: documentarla en
    `docs/BUSINESS_RULES.md` como `NEEDS BUSINESS CONFIRMATION`, hacerla
    configurable en `CompanySetting`, y usar el valor más conservador.
14. **Todo lo que bloquea tiene que tener salida.** Si el sistema levanta una
    barrera —un aviso, un error, una puerta— hay que poder cerrarla desde una
    pantalla, con nota y autor. Un candado sin llave no protege: tranca. Y todo
    proceso se tiene que poder repetir desde cero, o nadie puede ensayarlo.
15. **`CrewPayroll` y `EquipmentPayroll` son vehículos de PAGO, no de margen.**
    El margen lee `Production` y los costos directos; **jamás** se emiten
    líneas `BASE_PRODUCTION`/`BASE_PIECE` — cada pie se contaría dos veces.
    Y los días de control (`WorkEntry.isControlOnly`) anotan, **no pagan**: no
    entran al motor, al roster, al dashboard ni a las huellas de aprobación.

---

## Comandos

```bash
npm run dev                  # http://localhost:3100 (puerto fijo: el 3000 lo usa otro proyecto)
npm run build && npm run start   # el mismo 3100, pero compilado: es lo que se le deja al negocio
npm run check                # typecheck + lint + test + build — antes de cerrar cualquier módulo
npm run smoke                # abre TODAS las pantallas + el PDF (necesita el servidor arriba, dev o start)
npm run flow                 # recorre el proceso completo contra la base real

npm run test                 # Vitest
npx vitest run tests/engine/money.test.ts          # un archivo
npx vitest run -t "medio día paga exactamente"     # una prueba por nombre
npm run test:watch

npm run db:migrate           # prisma migrate dev
npm run db:seed              # compañías, roles, permisos, reglas sin confirmar
npm run user:create "Nombre" correo@x.com PAYROLL_PREPARER SKYLINE,INFRACORE
npm run clean                # borra los duplicados que crea iCloud ("archivo 2.ts")
```

Contra producción: anteponer `DATABASE_URL=...` (Neon) a cualquier script, y
`SMOKE_BASE=https://... SESSION_SECRET=...` para `smoke`.

### Los tres niveles de verificación, y para qué sirve cada uno

Los errores que llegaron al negocio pasaron `check` sin problema. Por eso hay tres:

| | Qué atrapa | Qué NO atrapa |
|---|---|---|
| `check` | tipos, lint, lógica pura | consultas mal escritas, botones que no hacen nada |
| `smoke` | pantallas que revientan al consultar la base, formularios anidados, códigos en inglés visibles, PDF ilegible | que los botones hagan lo correcto |
| `flow` | el proceso de punta a punta y lo que NO debe poder hacerse | lo visual |

`smoke` prueba a propósito **una semana con gente**: una vacía muestra el paso 1
y deja sin revisar la rejilla, el botón de quitar y el de enviar a aprobación —
justo donde estuvieron los errores. También pide el PDF de una orden real y
comprueba que los bytes sean un PDF de verdad: es un archivo, no una pantalla, y
si el generador se rompe ninguna otra revisión se entera.

**Un servidor viejo miente.** Si `npm run dev` ya estaba corriendo desde antes de
regenerar el cliente de Prisma, guarda el cliente viejo en memoria y las
pantallas nuevas dan 500 aunque el código esté bien. Ante un 500 raro tras tocar
el esquema: matar el proceso del 3100 y volver a levantarlo antes de investigar.

---

## Arquitectura

### Capas, de adentro hacia afuera

```
src/lib/payroll/engine/     PURO. Sin Prisma, sin React, sin reloj, sin azar.
                            Recibe datos planos, devuelve datos planos.
src/lib/payroll/*.ts        Servicios con base de datos (roster, dashboard, period).
                            Devuelven resultados; NO lanzan por errores de uso.
src/app/(app)/*/actions.ts  Server Actions: validan con Zod, llaman al servicio,
                            devuelven un mensaje para la pantalla.
src/app/(app)/*/page.tsx    Server Components. Consultan y muestran.
```

**Por qué importa:** lo que decide reglas vive en el nivel puro y se prueba
exhaustivamente sin base de datos. `workflow/index.ts` (puro, 46 pruebas) decide
si una transición es válida; `workflow/service.ts` solo la ejecuta y deja rastro.
Al agregar una regla, va en el nivel puro.

### Piezas centrales

- **`engine/money.ts`** — tipo `Cents` marcado para que el compilador impida
  mezclarlo con cantidades. Todo importe pasa por aquí.
- **`engine/rates.ts`** — resuelve la tarifa vigente. Precedencia: proyecto+turno
  → proyecto → turno → operación → general. Si el día no trae operación ni
  proyecto y queda **una sola** tarifa vigente, la usa; si quedan varias, **no
  adivina** y reporta. Nunca paga cero en silencio.
- **`engine/index.ts`** — `calculateWorkerPayroll`. Orden fijo:
  `basePay → additions → gross → deductions(prioridad) → net`.
- **`payroll/workflow/`** — máquina de estados + huellas de campos materiales
  (persona, cuadrilla y equipo). **`payables.ts` es el único motor de
  transiciones**: un delegado por tipo de pagable aporta tabla, nombre, huella
  y detach; la segregación, BR-180, los errores críticos y las puertas propias
  (cuadrilla sin contratista, equipo sin proveedor) viven UNA sola vez ahí.
  `service.ts` conserva `applyTransition` como puerta compatible para personas.
- **`payroll/crews/`** y **`payroll/equipment/`** — liquidaciones semanales:
  `syncCrewPayrolls` vuelve la producción deuda con el contratista y
  `syncEquipmentPayrolls` vuelve los días deuda con el proveedor (días × costo
  congelado), SOLO en estados editables; `reconcile*Week` invalida con rastro
  lo aprobado cuando algo cambia. También los días de control y las vistas de
  los bloques de la semana.
- **`payroll/contractors/`** — la semana de un contratista: producción × tarifa
  editable (hasta 4 decimales — `unitPriceTotal`), el desglose de su gente con
  la tarifa que él pactó, y la **conciliación** contra lo que dice SharePoint.
  Muestra la diferencia; jamás la ajusta. El pago sigue saliendo COMPLETO al
  contratista (BR-242): el desglose existe para hacer verificable el total —
  BR-260…266.
- **`equipment/records*`** — hoja de vida de cada equipo (seguros, títulos,
  mantenimientos) y el aviso ANTES del vencimiento. La fecha se teclea, no se
  deduce del PDF: un aviso que dependa de leer un escaneado falla justo cuando
  importa. `records.ts` es puro y recibe la fecha de hoy como dato — BR-300…304.
- **`disbursement/history*`** — el histórico de todo lo pagado: qué, a quién,
  cuándo y cómo. Sale de los SNAPSHOTS de la orden, no de consultas vivas.
  `history.ts` puro (totales), `history-service.ts` con Prisma — BR-310…313.
- **`disbursement/approval-groups.ts`** — agrupa lo que se va a aprobar por la
  empresa que paga, con su total. Es el orden en que tesorería mueve el dinero
  — BR-280…282.
- **`mail/`** — envío de reportes con consecutivo único. `reports.ts` decide
  quién recibe qué (un destinatario atado a una receptora **solo** ve SUS
  órdenes); `transport.ts` elige la salida y, **sin cuenta configurada, NO dice
  que envió**: registra y avisa. `dispatch-service.ts` toca la base —
  BR-320…325.
- **`payroll/exceptions/`** — qué avisos frenan un pago y cuáles no, y cómo se
  cierran. `index.ts` es puro: `bloquea()` es la única definición de «esto
  detiene el trabajo», y la usan por igual el motor de flujo, la pantalla de la
  semana y el tablero de inicio. `service.ts` cierra con nota y autor.
  **Nació de un callejón sin salida real**: el sistema creaba avisos y no había
  NINGUNA pantalla para cerrarlos, así que quien corregía el problema seguía
  bloqueado. Peor: los avisos que trajo el Excel contaban como bloqueo, y como
  la importación no crea nóminas (BR-153) frenaban semanas con las que no
  tenían nada que ver — BR-250…254.
- **`payroll/reset.ts`** — «empezar esta semana de cero». Sin esto no se puede
  ENSAYAR: un cálculo mal hecho dejaba la semana a medias para siempre. Borra
  las liquidaciones, **conserva los días marcados** y se niega en seco si algo
  ya se pagó — BR-255, BR-256.
- **`payroll/rates-status/`** — LA única respuesta a «¿quién tiene tarifa?»,
  con el mismo `resolveRate` del motor. Antes convivían tres definiciones que
  se contradecían; dashboard, paso 1 de la semana y `/worker-rates` usan esta.
- **`margin/`** — el otro lado del negocio. `rates.ts` resuelve la tarifa de
  VENTA con la misma precedencia que la de costo; `index.ts` calcula
  venta − costo = margen, y devuelve `null` en el porcentaje cuando la venta
  está incompleta. El costo del margen es el **bruto**, no el neto: descontar un
  préstamo no abarata la mano de obra — BR-202.
- **`advances/`** — préstamos a persona, cuadrilla, contratista o empresa
  receptora. El saldo NO es columna: se deriva de los movimientos. Nunca se
  descuenta más de lo que se debe, aunque el plan diga una cifra mayor.
- **`payroll/extras/`** — descuentos y adicionales de la semana (hotel, equipo,
  bonos). `index.ts` es puro y lo importa el navegador; `service.ts` toca la base.
  Las recuperaciones de préstamo NO se capturan a mano — BR-232.
- **`payroll/estimate.ts`** — lo que va sumando la rejilla mientras se marca.
  Puro y en centavos aunque solo alimente una barra: es dinero que alguien mira
  para decidir.
- **`payroll/home.ts`** — lo que responde «¿qué hago ahora?». `weekFocus` elige
  la semana donde ESTÁ el trabajo (la última con días propios o liquidaciones),
  no la del calendario, y jamás una de las 149 del Excel (sus días son
  `sourceType: IMPORT`); `pendingBoard` junta en un solo sitio todo lo que
  espera a alguien. Los pasos cuentan los TRES pagables.
- **`components/shell/FlowSteps.tsx`** — la tira «marcar días · calcular ·
  aprobar · pagar» que llevan Nómina, Aprobar y Pagar, y el bloque «lo que
  sigue». Un paso sin permiso se ve pero no enlaza.
- **`payroll/grid.ts`** — qué proyecto le toca a cada día: `proyecto:<id>` para
  toda la semana, `proyectodia:<id>:<fecha>` para un día suelto, y el día manda
  (BR-115). El proyecto de un día decide a quién se le factura, así que la
  precedencia se prueba sola, sin base ni pantalla. La fila arranca en modo por
  día cuando la semana ya viene repartida — con un solo selector, el siguiente
  guardado la aplanaría en silencio (BR-116).
- **`brand/`** — la identidad de cada compañía como DATO, no código: colores,
  logo y **tipografía**. Infracore titula en mayúscula pesada con Saira y rotula
  en monoespaciada; Skyline titula en minúscula con Inter. Con un estilo fijo,
  una se vería como la otra. Sale de la compañía de la sesión, nunca de la URL.
- **`disbursement/`** — a dónde va el dinero. `grouping.ts` (puro) agrupa
  pagables de los TRES tipos por semana y empresa receptora, lleva pegado a cada
  renglón **contra qué** se paga (`detail`: días, producción, alquiler — BR-195)
  y exige que las órdenes sumen **exactamente** lo aprobado; cada renglón de orden referencia
  exactamente UN pagable (CHECK uno-de-tres) con nombre y cuadrilla congelados.
  `orders.ts` genera órdenes mixtas al aprobar y registra el pago con su
  beneficiario legal (persona / CONTRATISTA / PROVEEDOR — `payment_single_payee`
  lo respalda); la selección de pago parcial va por RENGLÓN (`itemIds`).
  **`payOrder` es el ÚNICO camino por el que sale dinero** (BR-196): la
  pantalla que pagaba persona por persona se retiró porque no tocaba la orden
  —el dinero salía y la orden seguía abierta—. Como cada renglón se paga
  completo, ya no se generan `Variance`: una diferencia hoy es una orden
  `PARTIALLY_PAID` con su motivo.
  `detach.ts` (`detachPayable`) saca cualquier pagable de una orden sin pagar
  cuando se devuelve, y lo impide si el dinero ya salió.
- **`pdf/`** — generador de PDF propio, sin dependencias. El desprendible de
  contabilidad lleva el detalle por renglón **agrupado por cuadrilla con
  subtotales** (desde snapshots), nunca solo el total, y una columna «contra
  qué» con los días o la producción de cada renglón (BR-195).
- **`disbursement/detail.ts`** — la frase «contra qué se paga» («5 días», «3
  registros de producción», «4 días × $450.00») se escribe UNA vez: la usan el
  resumen de aprobación, el centro de pagos y el PDF. Si cada pantalla la
  armara aparte, la orden y su soporte dirían cosas distintas.
- **`payroll/period.ts`** — diario, semanal, catorcenal, quincenal, mensual, y
  cortes fuera de calendario para liquidar a quien se retira.
- **`payroll/week.ts`** — la semana va domingo a sábado y se numera como
  `WEEKNUM` de Excel, para que los números coincidan con los que el equipo usa.

### Protecciones en la base, no en el código

Trece triggers y ~30 restricciones, en cuatro migraciones:
`20260812233000_guardrails` (audit log append-only, nómina pagada inmutable,
tarifas sin solape, condonación con aprobador, adicional sin nota, pago mayor al
aprobado, `payment_single_payee`), `20260813202556_disbursement_orders` (orden
pagada inmutable, renglones congelados, receptora con historial no se borra,
diferencia sin explicar rechazada), `20260815010700_crew_equipment_payables`
(liquidaciones de cuadrilla y equipo pagadas inmutables, nombres congelados no
vacíos, montos ≥ 0) y `20260815013000_order_items_one_of_three` (un renglón =
exactamente UN pagable; FKs RESTRICT).

Se verifican con SQL crudo, saltándose la aplicación:
`tests/security/db-guardrails.test.ts`, `tests/security/disbursement.test.ts` y
`tests/security/payables-db.test.ts`. Para limpiar datos de prueba hay que
desactivar los triggers un momento — `ALTER TABLE ... DISABLE TRIGGER` dentro de
un `try/finally`. Es un privilegio que la aplicación nunca tiene; si un
`cleanup` empieza a fallar, casi siempre es un trigger nuevo que falta
desactivar ahí. Las suites corren **en secuencia** (`fileParallelism: false` en
`vitest.config.mts`): dos archivos contra la base real chocaban al apagar
candados en paralelo y fallaban "a veces" — no volver a paralelizarlas.

### Fronteras entre proveedores — no cruzarlas

- **Netlify** = solo hosting. Nunca datos ni archivos.
- **Neon** = todos los datos. Nunca archivos.
- **SharePoint** = todos los archivos (comprobantes, evidencias). La base guarda
  solo la referencia.

---

## Trampas que ya costaron errores en producción

- **`<form>` dentro de `<form>`** es HTML inválido: el navegador descarta el de
  adentro y su botón envía el de afuera. Compila, la página abre, y el botón no
  hace nada. `smoke` lo detecta sobre el HTML servido.
- **En los cleanups de pruebas, los `payment` se borran ANTES que contratistas
  y proveedores.** Borrar al beneficiario primero dispara el FK `SET NULL`
  sobre el pago y el CHECK `payment_single_payee` revienta con "new row
  violates check" — desconcertante porque un DELETE no debería "insertar"
  nada (en Postgres, el UPDATE del FK cuenta como fila nueva para el CHECK).
  Igual: los renglones de orden ANTES que `crew_payroll`/`equipment_payroll`
  (FK RESTRICT). Los triggers nuevos de esas dos tablas van en TODOS los
  `DISABLE TRIGGER` de los cleanups.
- **`prisma migrate dev` se niega en terminal no interactiva** cuando la
  migración trae advertencias (índices únicos nuevos). La salida: escribir la
  carpeta `prisma/migrations/<timestamp>_<nombre>/migration.sql` a mano y
  aplicar con `prisma migrate deploy` — que además es como se agregan los
  CHECKs y triggers que Prisma no sabe generar.
- **`include: { relacion: false }` en Prisma** no es válido: compila, pasa el
  typecheck y revienta al abrir la página. Hay regla de lint.
- **Trigger `BEFORE ... FOR EACH ROW` en Postgres**: en un `DELETE` hay que
  `RETURN OLD`. Devolver `NEW` (que es `NULL`) cancela el borrado **sin avisar**.
- **`<Link>` precarga por defecto.** Con páginas dinámicas, cada enlace visible
  renderiza una página entera en el servidor. Una lista de 150 filas disparaba
  150 renders. Todos los enlaces llevan `prefetch={false}`.
- **Un día sin operación no encuentra una tarifa amarrada a una operación.** Los
  días heredan operación, proyecto y cuadrilla de la persona al capturarse.
- **`smoke` pide datos de la compañía de SU sesión.** Elegía la orden y la
  semana más recientes de toda la base: en cuanto Infracore tuvo una orden, la
  pantalla respondía 404 (solo sirve la compañía activa) y la revisión reportaba
  un daño que no existía. Toda consulta nueva del script va filtrada por
  `companyId`.
- **iCloud** sincroniza esta carpeta y crea copias `archivo 2.ts` que rompen la
  compilación. `npm run clean` corre antes de cada `typecheck`. `node_modules`
  vive fuera (enlace a `~/.local/`); `.next` **no** puede moverse: rompe la
  resolución de módulos de Turbopack.
- **Errores de uso NO se lanzan**, se devuelven como mensaje. Una excepción en
  una Server Action se ve como una pantalla de error del sistema, no como un
  aviso entendible.
- **`lower()` no acepta un tipo enumerado en Postgres.** Un trigger que arma su
  mensaje de error con `lower(OLD.status)` bloquea la operación —correcto— pero
  falla al explicarla, y quien la intentó ve un error del motor. Hay que
  convertirlo: `lower(OLD.status::text)`.
- **Un componente de cliente que importa un servicio arrastra Prisma al
  navegador** y rompe la compilación con «Can't resolve 'dns'». Lo puro va en
  `index.ts` y lo que toca la base en `service.ts` — por eso están separados.
- **Un componente local llamado `Date` tapa al `Date` de JavaScript.** El error
  sale como «'new' expression whose target lacks a construct signature», que no
  se parece en nada a la causa.
- **Un CHECK viejo puede sobrevivir al código que protegía.** Al abrir los
  préstamos a cuadrillas, `advance_single_beneficiary` —que solo conocía dos
  clases— los rechazaba aunque la aplicación los diera por válidos. La base tenía
  razón; el candado estaba desactualizado. Al ampliar un modelo, buscar las
  restricciones viejas de esa tabla.
- **Una prueba que se salta la interfaz no ve que la interfaz no existe.** El
  `flow` comprobaba «tras resolverlo, sí aprueba» con un `UPDATE` directo a la
  base, así que pasaba en verde mientras la aplicación no tenía **ningún** sitio
  donde cerrar un aviso y el negocio quedaba trancado. Una comprobación de un
  paso del proceso tiene que llamar al MISMO servicio que llama el botón.
- **Un candado sin llave no protege: tranca.** Cada barrera nueva (aviso,
  bloqueo, puerta de aprobación) necesita su pantalla para levantarla, con nota
  y autor, en el mismo cambio que la crea. Y todo lo que se pueda hacer mal
  necesita cómo deshacerse, o el negocio no puede ni practicar.
- **Un cambio de estado puede dejar huérfano un documento.** Devolver una nómina
  que ya estaba dentro de una orden de desembolso dejaba la orden con el monto
  viejo, y tesorería habría transferido de más. Todo lo que saque a alguien de
  APPROVED tiene que pasar por `disbursement/detach.ts`.

---

## Vocabulario (evita confusiones caras)

| En la app | Significado | En los Excel |
|---|---|---|
| `Company` | Entidad legal: Skyline / Infracore. De quién es la nómina | columna `UNIDAD DE NEGOCIO` — **NO** `EMPRESA` |
| `Customer` | Cliente que nos paga (Bigham, Precision Fiber, GTS) | columna `EMPRESA` / `EMPRESA2` |
| `PaymentRecipient` | Empresa receptora: a quién se le **transfiere** el dinero | no existía |
| `WorkerRate` | Tarifa de COSTO: lo que NOSOTROS pagamos por un día | columnas de tarifa |
| `BillingRate` | Tarifa de VENTA: lo que el cliente NOS paga por ese mismo día | no existía |
| `Operation` | Aerial, Underground, BlowFiber, Admin, Data Center | columna `Tipo` |
| `Crew` | Cuadrilla (MISSILES, AMPARO, CHATO…) | columna `EQUIPO` |
| `Worker` | Persona | columna `Nombre` |
| `Equipment` | Máquina o vehículo (CAPSTAN, PLOW, INTERNACIONAL 2014) | también en `Nombre` |
| `Contractor` | Subcontratista que factura (FORZO, FELIPE, JAIRO) | hojas `week NN` de FORMATO COMIS |

En los Excel *EMPRESA* significa **cliente**, no compañía propia. Confundirlas
rompe la contabilidad. Y `Company` ≠ `PaymentRecipient`: la primera es de quién
es la nómina, la segunda a dónde va la plata. Un trabajador de Skyline puede
pagarse enviando fondos a un subcontratista.

---

## Los tres Excel de referencia — NO MODIFICAR

Se leen, nunca se escriben.

```
.../SKYLINE ADVANCE TECH/03 - RECURSOS HUMANOS/SEGUIMIENTO LABORAL/2026 Laboral/
    NOMINA 2026 AERIO&UG- v03-20 oct---.xlsx
.../INFRACORE SYSTEMS LLC/SEGUIMIENTO LABORAL - INFRACORE/
    NOMINA 2026 -INFRACORE-N-AGOSTO 9.xlsx
~/Downloads/FORMATO COMIS.xlsx
```

Análisis en `docs/EXCEL_ANALYSIS.md` (14 errores críticos encontrados, 15
ambigüedades abiertas A1–A15). Mapeo en `docs/EXCEL_MAPPING.md`. Scripts de
lectura en `tools/excel-analysis/`. Importación en `prisma/import-historical.ts`
(idempotente, no une nombres parecidos, retiene duplicados).

---

## Entorno

**Local:** PostgreSQL 16 por Homebrew (`brew services start postgresql@16`), base
`payroll_dev`. Variables en `.env`: `DATABASE_URL`, `SESSION_SECRET` (mínimo 32
caracteres), y `SESSION_COOKIE_SECURE=false` **solo** para servir en la red de la
oficina: `npm run start` corre con NODE_ENV=production y marca la cookie de sesión
como `secure`, que los navegadores descartan sobre `http://<ip-lan>` (únicamente
localhost se salva) — sin la variable, quien entre desde otro computador queda en
un bucle de login. En un sitio publicado con HTTPS esa variable NO va. El acceso
de otros computadores está documentado paso a paso en `docs/LAN_ACCESS.md` (el
servidor ya escucha en todas las interfaces; suele faltar solo el permiso del
firewall a `node` y usar el nombre `<mac>.local`).

**Publicado:** https://skyline-infracore-payroll.netlify.app · repositorio
privado `juanrafa72/skyline-infracore-payroll` · base en Neon. Cada despliegue
aplica migraciones y vuelve a sembrar catálogos (el seed usa upsert).

```bash
netlify deploy --prod
```

> **El despliegue está bloqueado, y no es el código ni la sesión.** `netlify
> deploy` responde `JSONHTTPError: Forbidden`. El mensaje real solo aparece
> preguntándole a la API directamente:
>
> ```
> POST /api/v1/sites/<id>/deploys
> 403 {"error":"Account credit usage exceeded - new deploys are blocked until credits are added"}
> ```
>
> Cuenta gratuita, 300 créditos por período; el período va del 12 de agosto al
> 12 de septiembre de 2026 y se agotaron. No hay medio de pago registrado.
> **Antes de diagnosticar nada, comprobar ese POST**: `netlify status` da 200 y
> el token funciona para leer, así que todo parece bien salvo el despliegue.
>
> Consecuencia: **el sitio publicado está viejo** — no tiene empresas receptoras
> ni órdenes de desembolso. Todo está en GitHub, listo para subir cuando se
> desbloquee. Mientras tanto se trabaja en local. Que el usuario pague o no es
> decisión suya: no agregar medios de pago ni comprar créditos.

---

## Estado

**443 pruebas · 58 tablas · 20 migraciones · 25+ pantallas** · `check`, `smoke`
(36) y `flow` (87) en verde. 190 reglas de negocio documentadas.

**Lo que pidió el negocio el 15/08, ya construido:** la nómina de la semana
tiene los TRES bloques con lo que de verdad se paga — personas, equipos y
**contratistas** (producción × tarifa editable, el desglose de su gente y la
conciliación contra SharePoint, que muestra la diferencia y no la ajusta);
los equipos se ven propios **y** rentados, con filtro y proyecto por equipo;
aprobar **agrupa por empresa receptora con el total al lado**; el botón del
paso siguiente **late** al guardar; cada equipo tiene **hoja de vida** con
aviso antes de que se venza un seguro; hay **histórico de todo lo pagado**; y
el desprendible se **manda por correo con consecutivo único** — eso último a
la espera de la cuenta de envío (ver Falta).

**El 15/08, probando la aplicación como usuario, apareció un callejón sin
salida** y se cerró: el sistema creaba avisos y **no había ninguna pantalla para
cerrarlos** (la tabla tiene cuatro estados; el código solo escribía `OPEN`).
Quien corregía el problema seguía bloqueado. Y los avisos que trajo el Excel
contaban como bloqueo aunque la importación no cree nóminas, así que frenaban
semanas nuevas sin relación con ellos. Ahora hay **/avisos** —con qué pasó, qué
hacer y cierre con nota— , el archivo del Excel se archiva en bloque y no frena
nada, y cada semana tiene **«empezar de cero»**, que borra el cálculo,
conserva los días marcados y se niega en seco si algo ya se pagó.

**La navegación se rehízo el 15/08** (pedido de Rafael: «visualmente lo veo
enredado»). Cuatro cosas: se entra por **«Esta semana»** —qué falta y un botón
grande— en vez de por el tablero de cifras; el menú quedó con lo de **cada
semana** arriba y todo lo demás detrás de **Catálogos**; las pantallas del
camino llevan la **tira de 4 pasos** y un «siguiente paso» que respeta el rol;
y **pagar es una sola pantalla** (antes eran dos, y la de personas no
actualizaba la orden — BR-196). La etiqueta del menú siempre es el título de
la pantalla: si dicen palabras distintas, uno cree que se equivocó de sitio.

El proceso completo, probado de punta a punta, para LOS TRES pagables (persona,
cuadrilla, equipo rentado): marcar días y proyecto → calcular → revisar →
asignar empresa receptora → aprobar → órdenes de desembolso mixtas → pagar →
PDF con desglose por cuadrilla → histórico. La semana tiene los tres bloques
que pidió el negocio (personal / equipo rentado / crews), "copiar semana
anterior" (solo QUIÉNES + proyecto sugerido, jamás días), **proyecto por día**
cuando alguien se mueve entre pueblos a mitad de semana (BR-115), receptora
sugerida de la semana pasada (propone, nunca asigna — BR-181), pantalla de
tarifas faltantes con la vara del motor, y acceso por la red de la oficina
(`docs/LAN_ACCESS.md`, `SESSION_COOKIE_SECURE`) con cambio de contraseña
forzado al primer ingreso. El resumen previo a aprobar dice contra cuántos días
va cada pago (BR-195).

**Probado por quién:** por pruebas automáticas; el negocio todavía no ha
completado una semana real en la pantalla. Solo 4 de 153 semanas tienen nómina
calculada. Las otras 149 son **archivo del Excel, no pendientes**: la
importación crea días pero jamás nóminas, a propósito (BR-153) — calcularlas
inventaría obligaciones de pago que ya se pagaron por fuera. **No "ayudar"
calculándolas.** La validación que falta es que Rafael corra la semana actual en
la interfaz y la cuadre contra su Excel. Pendiente confirmarle que ninguna
semana histórica siga sin pagar.

**Hecho:** motor de cálculo · protecciones en la base · login por persona con
roles · venta, costo y margen con tarifas vigentes · producción con sus dos
precios (lo que nos pagan y lo que pagamos) · **liquidaciones de cuadrilla al
contratista y de equipo rentado al proveedor, por el mismo flujo con delegados
(`workflow/payables.ts`)** · días de control de la gente del crew
(`isControlOnly`: anotan, no pagan, no tocan hashes) · catálogo de equipos y
proveedores · préstamos con plan de recuperación (y AVISO de saldo vivo al
aprobar cuadrillas — el descuento automático dentro de `CrewPayroll` queda
para después) · descuentos y adicionales de la semana · órdenes de desembolso
mixtas con consecutivo, PDF con desglose por cuadrilla y pago parcial por
renglón · empresas receptoras · rentabilidad con filtros · marca propia de
cada compañía · períodos y cortes · importación del histórico.

**Falta**, en el orden en que conviene atacarlo:

0. **La cuenta de correo desde la que salen los reportes.** Solo el negocio la
   tiene. Todo lo demás del envío está hecho: destinatarios, consecutivo,
   registro de a quién iba. Con las variables `SMTP_*` en `.env` y la llamada
   a la librería en `lib/mail/smtp.ts`, empieza a salir. Mientras tanto la
   aplicación **no miente**: dice que quedó registrado pero que no salió.
1. Semana trabajada vs facturada, y si el cliente ya pagó.
2. Cuentas por pagar y proyección de las próximas semanas.
3. Dashboard con los KPI pedidos (ventas del año, margen acumulado, pendiente).
4. Reapertura de semanas cerradas con motivo y aprobación.
5. Costo de equipo dentro del margen (BR-171) y la inconsistencia preexistente
   de `marginForWeek`/`marginYearToDate` que excluye producción — anotadas a
   propósito para no mover números a mitad del MVP.

**No existe y no bloquea operar:** inventario · disputas · notificaciones ·
portal de contratistas · solicitud de detalle de descuento · planes de pago con
cronograma.

**Bloqueado por fuera:** la conciliación con SharePoint —la base está en
`/sites/Skyline/Documentos compartidos/BASES/` pero Microsoft rechaza extraerla
(406, etiqueta de confidencialidad)— y el despliegue en Netlify, sin créditos.

Ver `docs/IMPLEMENTATION_PLAN.md`. Reglas por tema en `docs/BUSINESS_RULES.md`:
desembolsos §19 (BR-180…194), venta y margen §20 (BR-200…208), producción §21
(BR-210…215), préstamos §22 (BR-220…228), extras de la semana §23 (BR-230…236),
cuadrillas y equipos como pagables §24 (BR-240…249).

### Datos que el negocio tiene que resolver

No son errores del sistema; son cosas que los Excel traían así y que hay que
preguntar antes de correr una nómina de verdad:

- **4.833 días sin proyecto** de 12.542 en Skyline. Sin proyecto no hay cliente,
  y sin cliente el margen de esa semana sale incompleto — a propósito.
- **63 personas activas sin tarifa** — Skyline 47 de 149, Infracore **16 de 18**:
  Infracore hoy no puede correr una semana. Una sola persona sin tarifa genera
  error CRÍTICO que bloquea el envío de la semana entera. Las importadas viejas
  además calculan en $0.00 y así entran a órdenes. Solo Rafael sabe los valores.
- 37 grupos de nombres que podrían ser la misma persona, retenidos sin unir.
  Ejemplo vivo: `ISAAC CEBALLOS-UG` y `ISSAC CEBALLOS BORRERO`, ocho registros.
- **Contratista de cada cuadrilla que se paga por producción** — la puerta de
  APPROVE lo exige (a él se le paga). Se asigna en /crews.
- **Proveedor y costo diario de cada equipo RENTADO** (PLOW-RENT, MINI
  ESCAVADORA…) — sin costo no calcula, sin proveedor no se aprueba (BR-121).
  Se llenan en /equipment, con creación inline de proveedores.
- 15 reglas en `NEEDS BUSINESS CONFIRMATION` (A1–A15). La A14 quedó respondida
  en la práctica: equipo RENTED se paga al proveedor; OWNED es costo interno.
- El histórico en Neon quedó a medias (~5.048 de 12.906 días).

### Cómo se abre

Este archivo **solo se carga si la sesión arranca dentro de esta carpeta**. Si se
abre desde `~`, Claude Code no lo ve y se empieza sin conocer nada de lo de
arriba. La memoria automática del usuario (`~/.claude/projects/…/memory/`) sí se
carga siempre, pero solo tiene el contexto del negocio, no estas reglas.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
