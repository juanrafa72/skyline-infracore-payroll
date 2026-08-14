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
- **`payroll/workflow/`** — máquina de estados + huella de campos materiales.
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
- **`brand/`** — la identidad de cada compañía como DATO, no código: colores,
  logo y **tipografía**. Infracore titula en mayúscula pesada con Saira y rotula
  en monoespaciada; Skyline titula en minúscula con Inter. Con un estilo fijo,
  una se vería como la otra. Sale de la compañía de la sesión, nunca de la URL.
- **`disbursement/`** — a dónde va el dinero. `grouping.ts` (puro) agrupa por
  semana y empresa receptora y exige que las órdenes sumen **exactamente** lo
  aprobado; `orders.ts` genera las órdenes al aprobar y registra el pago;
  `detach.ts` saca a alguien de una orden sin pagar cuando se devuelve su
  nómina, y lo impide si el dinero ya salió.
- **`pdf/`** — generador de PDF propio, sin dependencias. El desprendible de
  contabilidad lleva el detalle por trabajador, nunca solo el total.
- **`payroll/period.ts`** — diario, semanal, catorcenal, quincenal, mensual, y
  cortes fuera de calendario para liquidar a quien se retira.
- **`payroll/week.ts`** — la semana va domingo a sábado y se numera como
  `WEEKNUM` de Excel, para que los números coincidan con los que el equipo usa.

### Protecciones en la base, no en el código

Once triggers y veintitrés restricciones, repartidas en dos migraciones:
`20260812233000_guardrails` (audit log append-only, nómina pagada inmutable,
tarifas sin solape, condonación con aprobador, adicional sin nota, pago mayor al
aprobado) y `20260813202556_disbursement_orders` (orden pagada inmutable,
renglones congelados, receptora con historial no se borra, diferencia sin
explicar rechazada).

Se verifican con SQL crudo, saltándose la aplicación:
`tests/security/db-guardrails.test.ts` y `tests/security/disbursement.test.ts`.
Para limpiar datos de prueba hay que desactivar los triggers un momento —
`ALTER TABLE ... DISABLE TRIGGER` dentro de un `try/finally`. Es un privilegio
que la aplicación nunca tiene; si un `cleanup` empieza a fallar, casi siempre es
un trigger nuevo que falta desactivar ahí.

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
- **`include: { relacion: false }` en Prisma** no es válido: compila, pasa el
  typecheck y revienta al abrir la página. Hay regla de lint.
- **Trigger `BEFORE ... FOR EACH ROW` en Postgres**: en un `DELETE` hay que
  `RETURN OLD`. Devolver `NEW` (que es `NULL`) cancela el borrado **sin avisar**.
- **`<Link>` precarga por defecto.** Con páginas dinámicas, cada enlace visible
  renderiza una página entera en el servidor. Una lista de 150 filas disparaba
  150 renders. Todos los enlaces llevan `prefetch={false}`.
- **Un día sin operación no encuentra una tarifa amarrada a una operación.** Los
  días heredan operación, proyecto y cuadrilla de la persona al capturarse.
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
caracteres).

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

**315 pruebas · 51 tablas · 14 migraciones · 18 pantallas** · `check`, `smoke` y
`flow` en verde. 140 reglas de negocio documentadas.

El proceso completo, probado de punta a punta: marcar días y proyecto → calcular
→ revisar → asignar empresa receptora → aprobar → órdenes de desembolso → pagar
→ comprobante en PDF → histórico.

**Hecho:** motor de cálculo · protecciones en la base · login por persona con
roles · venta, costo y margen con tarifas vigentes · producción con sus dos
precios (lo que nos pagan y lo que pagamos) · préstamos con plan de recuperación
· descuentos y adicionales de la semana · órdenes de desembolso con consecutivo,
PDF y pago parcial · empresas receptoras · rentabilidad con filtros · marca
propia de cada compañía · períodos y cortes · importación del histórico.

**Falta**, en el orden en que conviene atacarlo:

1. **Equipo rentado** — no hay dónde marcarle días al camión ni a la máquina.
   `Equipment` existe con `dailyCost`; falta el modelo de días y su pago.
2. **Cuadrillas que se pagan al contratista** — la producción se ve pero no se
   convierte en obligación de pago como sí pasa con las personas.
3. **Despliegue por crew en el centro de pagos** — el negocio lo marcó como
   crítico. Hoy la orden va empresa receptora → trabajadores, saltándose el crew.
4. Semana trabajada vs facturada, y si el cliente ya pagó.
5. Cuentas por pagar y proyección de las próximas semanas.
6. Dashboard con los KPI pedidos (ventas del año, margen acumulado, pendiente).
7. Reapertura de semanas cerradas con motivo y aprobación.

**No existe y no bloquea operar:** inventario · disputas · notificaciones ·
portal de contratistas · solicitud de detalle de descuento · planes de pago con
cronograma.

**Bloqueado por fuera:** la conciliación con SharePoint —la base está en
`/sites/Skyline/Documentos compartidos/BASES/` pero Microsoft rechaza extraerla
(406, etiqueta de confidencialidad)— y el despliegue en Netlify, sin créditos.

Ver `docs/IMPLEMENTATION_PLAN.md`. Reglas por tema en `docs/BUSINESS_RULES.md`:
desembolsos §19 (BR-180…194), venta y margen §20 (BR-200…208), producción §21
(BR-210…215), préstamos §22 (BR-220…228), extras de la semana §23 (BR-230…236).

### Datos que el negocio tiene que resolver

No son errores del sistema; son cosas que los Excel traían así y que hay que
preguntar antes de correr una nómina de verdad:

- **4.833 días sin proyecto** de 12.542 en Skyline. Sin proyecto no hay cliente,
  y sin cliente el margen de esa semana sale incompleto — a propósito.
- ~63 personas sin tarifa válida. Calculan en **$0.00** y así entran a órdenes de
  desembolso. Se muestran a propósito: no esconderlas.
- 37 grupos de nombres que podrían ser la misma persona, retenidos sin unir.
  Ejemplo vivo: `ISAAC CEBALLOS-UG` y `ISSAC CEBALLOS BORRERO`, ocho registros.
- 15 reglas en `NEEDS BUSINESS CONFIRMATION` (A1–A15).
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
