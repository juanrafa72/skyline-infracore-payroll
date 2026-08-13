# CLAUDE.md — Memoria operativa del proyecto

Sistema central de **payroll, contractor settlements y control financiero** de
**Skyline Advance Tech** e **Infracore Systems LLC**.

Este archivo es corto a propósito. Las especificaciones largas viven en `/docs`.

---

## Reglas que NUNCA se rompen

1. **Dinero jamás en `float`.** Se almacena en `Decimal(18,2)` (Postgres/Prisma) y se
   calcula en **enteros de centavos** dentro del `PayrollEngine`. Redondeo explícito
   `ROUND_HALF_UP` a 2 decimales, una sola vez, al final de cada concepto.
2. **Toda la matemática de dinero vive en `src/lib/payroll/engine/`.** Ningún componente,
   endpoint, reporte ni migración puede recalcular montos por su cuenta.
3. **Aislamiento por compañía.** Cada tabla transaccional lleva `companyId` y toda query
   pasa por el helper de scope. Nunca un `findMany` sin `companyId` sobre datos de negocio.
4. **Segregación de funciones.** Quien prepara no aprueba. Quien aprueba no paga.
   Se valida en el backend, no en la UI.
5. **Cambio después de aprobar → invalida la aprobación.** Ver `docs/PAYROLL_FLOW.md` §
   "Campos materiales". La nómina vuelve a `PENDING_APPROVAL` automáticamente.
6. **Nómina pagada es inmutable.** Corrección = `Adjustment` / `Reversal` /
   `AdditionalPayment` / `Credit`. Nunca se edita ni se borra el pago original.
7. **Audit log append-only.** Sin `UPDATE`, sin `DELETE`. Se escribe dentro de la misma
   transacción que el cambio que registra.
8. **Snapshot de tarifas.** Cada línea de nómina guarda la tarifa aplicada. Cambiar una
   tarifa hoy nunca puede alterar una nómina histórica.
9. **Persona ≠ equipo.** `Worker` y `Equipment` son entidades distintas. Nunca se mezclan.
10. **Diferencias nunca desaparecen.** Si dos fuentes discrepan se registra `Variance`
    y se muestra. Prohibido "cuadrar" silenciosamente.
11. **Importar dos veces el mismo archivo no duplica.** Idempotencia por
    `(companyId, sourceHash, naturalKey)`.
12. **No adivinar reglas de dinero.** Si una regla no se puede verificar en los Excel o
    con el negocio: documentarla en `docs/BUSINESS_RULES.md` con la etiqueta
    `NEEDS BUSINESS CONFIRMATION` y hacerla configurable.

---

## Los tres Excel de referencia — NO MODIFICAR

Se leen. Nunca se escriben. Ubicación actual:

```
.../SKYLINE ADVANCE TECH/03 - RECURSOS HUMANOS/SEGUIMIENTO LABORAL/2026 Laboral/
    NOMINA 2026 AERIO&UG- v03-20 oct---.xlsx
.../INFRACORE SYSTEMS LLC/SEGUIMIENTO LABORAL - INFRACORE/
    NOMINA 2026 -INFRACORE-N-AGOSTO 9.xlsx
~/Downloads/FORMATO COMIS.xlsx
```

Análisis completo en `docs/EXCEL_ANALYSIS.md`. Mapeo en `docs/EXCEL_MAPPING.md`.

---

## Vocabulario (evita confusiones caras)

| Término en la app | Significado | Cómo aparecía en Excel |
|---|---|---|
| `Company` | Entidad legal: Skyline Advance Tech / Infracore Systems LLC | columna `UNIDAD DE NEGOCIO`; **NO** la columna `EMPRESA` |
| `Customer` | Cliente / general contractor que nos paga | columna `EMPRESA` / `EMPRESA2` (Bigham, Precision Fiber, GTS…) |
| `Operation` | Línea de negocio: Aerial, Underground, BlowFiber, Admin, Data Center | columna `Tipo` |
| `Crew` | Cuadrilla (MISSILES, AMPARO, CHATO, CUBO…) | columna `EQUIPO` |
| `Worker` | Persona | columna `Nombre` |
| `Equipment` | Máquina/vehículo (CAPSTAN, PLOW, COMPRESOR, INTERNACIONAL 2014) | también en `Nombre` — **hay que separarlos** |
| `Contractor` | Subcontratista que factura (FORZO, FELIPE, JESUS, JAIRO…) | hoja `week NN` de FORMATO COMIS |

**Advertencia:** en los Excel la palabra *EMPRESA* significa **cliente**, no compañía propia.
Confundirlas rompe la contabilidad.

---

## Stack

Next.js 15 (App Router) · TypeScript strict · Tailwind v4 · PostgreSQL 16 · Prisma ·
Auth.js v5 (Credentials hoy, Microsoft Entra ID después) · Zod · Vitest ·
`@react-pdf/renderer` para comprobantes · storage detrás de interfaz (local → S3/Azure).

Justificación y alternativas descartadas: `docs/ARCHITECTURE.md`.

---

## Comandos

```bash
npm run dev          # desarrollo
npm run typecheck    # tsc --noEmit
npm run lint
npm run test         # Vitest (incluye tests financieros)
npm run build
npm run db:migrate   # prisma migrate dev
npm run db:seed
npm run check        # typecheck + lint + test + build  ← correr antes de cerrar un módulo
npm run smoke        # abre TODAS las pantallas en las dos compañías (requiere `npm run dev`)
npm run clean        # borra los duplicados que crea iCloud ("archivo 2.ts")
```

**Regla de trabajo:** no se avanza al siguiente módulo con `npm run check` en rojo,
y **`npm run smoke` es obligatorio** antes de dar una pantalla por terminada.
`tsc` no detecta errores que solo aparecen al consultar la base — una relación mal
escrita compila bien y revienta al abrir la página. Ya pasó una vez.

**iCloud:** esta carpeta se sincroniza y iCloud crea copias `archivo 2.ts` que rompen la
compilación. `npm run clean` corre solo antes de cada `typecheck`. `node_modules` vive
fuera (enlace a `~/.local/`); `.next` **no puede** moverse fuera: rompe la resolución de
módulos de Turbopack.

---

## Estado actual

- [x] Análisis de los 3 Excel (`docs/EXCEL_ANALYSIS.md`, scripts en `tools/excel-analysis/`)
- [x] Documentación base (`/docs`)
- [x] Modelo de datos inicial (`docs/DATA_MODEL.md`)
- [x] **M0** — Fundación técnica: Next.js 15 + TS strict + Tailwind v4 + Vitest + Prisma
      instalado, `npm run check` en verde
- [x] **M1** — `schema.prisma` (36 tablas), migraciones aplicadas, triggers y
      restricciones verificados con pruebas contra la base real, seed de compañías,
      roles, permisos y las 16 reglas sin confirmar
- [x] **M2** — `PayrollEngine` completo: money, tarifas con vigencia, pago base
      (día/medio día/hora/semanal fijo), adicionales, descuentos, recuperación de
      anticipos y deudas, neto negativo, semanas domingo–sábado con la numeración de Excel
- [x] **M4–M5 (parcial)** — aplicación navegable: dashboard, trabajadores con historial de
      tarifas, cuadrillas, proyectos, clientes, rejilla semanal de días, cálculo y reportes
- [x] **Períodos de pago** — diario, semanal, catorcenal (14 días), quincenal
      (1–15 y 16–fin de mes) y mensual, por compañía y con excepción por trabajador.
      Cortes fuera de calendario para liquidar a quien se retira.
- [x] **Publicado** en Netlify con base en Neon, detrás de contraseña compartida
- [ ] **M3** — autenticación real por persona y rol. Hoy solo hay **una contraseña
      compartida**: todos ven todo, cualquiera puede cambiar montos y no queda
      registro de quién fue. Es lo siguiente y es bloqueante para operar de verdad.
- [ ] M6–M14 — anticipos, deudas, Approval Center, Payment Center, comprobantes,
      auditoría visible. Ver `docs/IMPLEMENTATION_PLAN.md`

**110 tests pasando** · `npm run check` en verde.

### Verificación contra el Excel

Federico Quintero, Underground, semana 30 de 2026 (19–25 jul), 7 días a $200
→ el sistema calcula **$1.400,00**, el mismo número de la hoja `DH UG` del Excel.

Fases 2–4 no se empiezan hasta que Phase 1 esté verde y validada por el negocio.

### Publicado

- **Sitio:** https://skyline-infracore-payroll.netlify.app
- **Acceso:** contraseña compartida en la variable `SITE_PASSWORD` de Netlify.
  Es un candado temporal (`src/middleware.ts`), **no** el login por persona.
- **Base de datos:** PostgreSQL administrado en Neon. La dirección vive en la
  variable `DATABASE_URL` de Netlify, nunca en el repositorio.
- **Repositorio:** `juanrafa72/skyline-infracore-payroll` (privado).
- Cada despliegue aplica migraciones y vuelve a sembrar catálogos (el seed usa
  upsert, no duplica).

```bash
netlify deploy --build --prod    # publicar
SMOKE_BASE=https://skyline-infracore-payroll.netlify.app \
  SMOKE_PASSWORD=... npm run smoke   # verificar lo publicado
```

### Base de datos local

PostgreSQL 16 vía Homebrew, servicio `postgresql@16`, base `payroll_dev`.

```bash
brew services start postgresql@16     # si no está corriendo
npm run db:migrate                    # aplicar migraciones
npm run db:seed                       # datos iniciales
npm run dev                           # http://localhost:3100
```

Puerto **3100** fijo, para no chocar con el proyecto Gallo de Oro que usa el 3000.

Las pruebas de `tests/security/db-guardrails.test.ts` corren contra esta base real:
verifican que el audit log no se pueda alterar y que una nómina pagada no se pueda
editar **aunque alguien entre directo a la base saltándose la aplicación**.

### Nota de entorno

`node_modules` es un enlace a `~/.local/payroll-system-node_modules` porque esta carpeta
se sincroniza con iCloud y cientos de miles de archivos la saturarían. Si se clona el
proyecto en otro equipo, basta con `npm install` normal.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
