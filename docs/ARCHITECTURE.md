# ARCHITECTURE.md

---

## 1. Decisiones de stack

| Capa | Elección | Razón |
|---|---|---|
| Framework | **Next.js 15 (App Router) + TypeScript strict** | Un solo despliegue para UI y API. Server Components permiten que el filtro de compañía y los permisos se apliquen del lado servidor: la UI no puede saltárselos. Server Actions eliminan endpoints sueltos sin validar. |
| UI | **Tailwind CSS v4 + componentes propios** | Se descartaron librerías pesadas (MUI, Ant): imponen estética y peso. Se necesita una tabla financiera densa en desktop y tarjetas legibles en móvil; eso se controla mejor con componentes propios sobre primitivas Radix. |
| Base de datos | **PostgreSQL 16** | `NUMERIC(18,2)` exacto, transacciones serias, RLS disponible como segunda barrera de aislamiento, y `CHECK`/triggers para hacer el audit log realmente append-only. |
| ORM | **Prisma** | Tipos generados, migraciones versionadas, `Decimal` nativo. Se acepta su límite en SQL complejo: los reportes pesados van en SQL crudo tipado. |
| Auth | **Auth.js v5 (NextAuth)** | Credentials + TOTP ahora; el proveedor **Microsoft Entra ID** se activa cambiando configuración, sin tocar el modelo de usuarios. Encaja con el SharePoint que ya usan. |
| Validación | **Zod** | Un esquema por operación, compartido entre cliente y servidor. La validación del servidor es la que manda. |
| Dinero | **`Decimal(18,2)` en BD + centavos enteros (`bigint`) en el motor** | Ver §4. |
| Tests | **Vitest** | Rápido, mismo transpilador que la app. Los tests financieros corren en cada `npm run check`. |
| PDF | **`@react-pdf/renderer`** | Generación real en servidor, sin navegador headless. Los comprobantes son documentos, no capturas de pantalla. |
| Storage | **Interfaz `FileStorage`** con adaptador local hoy, S3/Azure Blob después | Los comprobantes bancarios son evidencia; nunca se sirven como archivo estático público. Se descargan por endpoint que verifica permisos. |
| Colas / jobs | **Ninguna al inicio** | Phase 1 no lo necesita. Cuando entren SharePoint y notificaciones, se añade una cola simple sobre Postgres antes que introducir Redis. |

### Alternativas descartadas

- **Convertir los Excel a una web**: no resuelve nada. El problema no es la interfaz,
  son las reglas sin control (ver `EXCEL_ANALYSIS.md`).
- **MySQL / SQLite**: aritmética decimal y control de concurrencia insuficientes.
- **Almacenar dinero en `float`**: prohibido por `CLAUDE.md`.
- **Multi-tenant con base de datos por compañía**: complica el dashboard consolidado y las
  migraciones. Se elige una base con `companyId` obligatorio + Row Level Security.

---

## 2. Estructura de carpetas

```
payroll-system/
├── CLAUDE.md
├── docs/
├── prisma/
│   ├── schema.prisma
│   ├── migrations/
│   └── seed.ts
├── src/
│   ├── app/
│   │   ├── (auth)/                  login, selección de compañía
│   │   ├── (admin)/                 shell administrativo
│   │   │   ├── dashboard/
│   │   │   ├── payroll/
│   │   │   ├── approvals/           Approval Center
│   │   │   ├── payments/            Payment Center
│   │   │   ├── workers/ contractors/ crews/ projects/ equipment/
│   │   │   ├── advances/ debts/ adjustments/
│   │   │   ├── receipts/ reconciliation/ reports/ imports/
│   │   │   ├── audit/ users/ settings/
│   │   ├── (portal)/                portales de empleado / contratista / crew
│   │   └── api/
│   ├── lib/
│   │   ├── payroll/
│   │   │   ├── engine/              ← TODA la matemática de dinero
│   │   │   │   ├── money.ts
│   │   │   │   ├── base-pay.ts
│   │   │   │   ├── additions.ts
│   │   │   │   ├── deductions.ts
│   │   │   │   ├── advances.ts
│   │   │   │   ├── debts.ts
│   │   │   │   ├── settlement.ts
│   │   │   │   ├── variance.ts
│   │   │   │   └── index.ts
│   │   │   ├── workflow/            máquina de estados + invalidación
│   │   │   ├── exceptions/          detectores
│   │   │   └── rates/               resolución de tarifa vigente
│   │   ├── auth/                    sesión, RBAC, scope de compañía
│   │   ├── audit/                   escritura del audit log
│   │   ├── db/                      cliente Prisma + helpers con scope
│   │   ├── storage/                 interfaz FileStorage
│   │   ├── pdf/                     plantillas de comprobante
│   │   └── integrations/            SharePoint/Graph (Phase 2), email/WhatsApp (Phase 4)
│   ├── components/
│   └── schemas/                     Zod
└── tests/
    ├── engine/                      tests financieros — prioridad alta
    ├── workflow/
    └── security/                    IDOR, aislamiento de compañía
```

**Regla estructural:** `src/lib/payroll/engine/` no importa nada de `src/app/`,
ni Prisma, ni React. Recibe datos planos y devuelve datos planos. Así es testeable y
no puede desviarse por contexto.

---

## 3. Capas y flujo de una operación

```
Componente (React Server Component)
   ↓  Server Action
Validación Zod
   ↓
Guard de autorización  (rol + permiso + compañía + propiedad del registro)
   ↓
Servicio de dominio    (orquesta; no calcula dinero)
   ↓
PayrollEngine          (puro; calcula dinero)
   ↓
Transacción Prisma:  escritura + AuditLog + detección de excepciones
   ↓
Revalidación de caché
```

Ninguna capa puede saltarse la anterior. El guard de autorización es un
`assertCan(user, action, resource)` que **lanza**; no devuelve booleano que se pueda ignorar.

---

## 4. Dinero

**Almacenamiento:** `Decimal(18,2)` en Postgres, `Prisma.Decimal` en TypeScript.

**Cálculo:** dentro del motor todo se convierte a `bigint` de centavos.

```ts
type Cents = bigint & { readonly __brand: 'Cents' }

toCents('4180.90')   // 418090n
multiply(418090n, 0.5)  // redondeo ROUND_HALF_UP una sola vez → 209045n
toDecimal(209045n)   // '2090.45'
```

Reglas:
- Nunca `number` para dinero. El tipo `Cents` está marcado para que el compilador
  impida mezclarlo con cantidades sueltas.
- El redondeo ocurre **una vez por concepto**, no en cadena. Sumar diez líneas ya
  redondeadas no es lo mismo que redondear la suma; se elige lo primero y se documenta.
- Los porcentajes se aplican sobre centavos y se redondean inmediatamente.
- `Variance` se calcula como `expected − actual` en centavos y se muestra siempre,
  aunque sea de 1 centavo.

---

## 5. Aislamiento por compañía — tres barreras

1. **Sesión.** La compañía activa vive en la sesión del servidor, no en la URL ni en el
   cliente. Cambiarla exige el permiso `company:switch` y queda auditado.
2. **Capa de datos.** Todo acceso pasa por `scopedDb(companyId)`, que inyecta el filtro.
   Un `prisma.workEntry.findMany()` directo está prohibido por regla de lint.
3. **Base de datos.** Row Level Security en Postgres sobre las tablas transaccionales,
   con la compañía en una variable de sesión. Si las dos primeras fallan, la BD no devuelve
   la fila.

El dashboard consolidado usa un rol de solo lectura con permiso explícito
`report:consolidated`, y consulta vistas de agregación — nunca tablas base sin filtro.

---

## 6. Prevención de IDOR

- Los identificadores públicos son **UUID v7**, nunca autoincrementales.
- Todo acceso a un registro por id verifica, además del permiso, la **propiedad**:
  compañía correcta y, en los portales, que el registro pertenezca al usuario.
- Los portales (empleado / contratista / crew) **nunca reciben un id de otra persona por
  parámetro**: derivan el sujeto de la sesión. No existe la ruta `/portal/worker/[id]`.
- Los archivos (comprobantes, evidencias) se sirven por un endpoint que valida permisos y
  entrega un enlace firmado de vida corta. Nunca hay URL pública adivinable.
- Suite de tests `tests/security/` que intenta el acceso cruzado y debe fallar.

---

## 7. Auditoría append-only

Tabla `audit_log` sin permisos de `UPDATE` ni `DELETE` para el rol de aplicación,
reforzado con un trigger que lanza excepción. Se escribe en la misma transacción que el
cambio: si el log falla, la operación se revierte.

Cada entrada guarda el valor anterior y el nuevo como JSON, más `reason` obligatorio para
las acciones sensibles (aprobar, rechazar, pagar, condonar, ajustar).

---

## 8. Responsive

- **Desktop (≥1024px):** tabla densa, columnas congeladas, edición en línea, atajos de teclado.
- **Tablet:** tabla reducida con columnas prioritarias configurables.
- **Móvil (<640px):** la tabla se sustituye por **tarjetas**, una por trabajador, con
  nombre, días, bruto, descuentos y neto; el detalle se abre en hoja deslizante.
  **Nunca** una tabla con desplazamiento horizontal.

El Approval Center y el Payment Center se diseñan primero en móvil: Rafael y quien paga
suelen aprobar desde el teléfono.

---

## 9. Rendimiento

- Los listados de nómina semanal (≈150 líneas) se sirven completos; no requieren paginación.
- Los reportes históricos van por SQL agregado, no por Prisma en memoria.
- Los cálculos del motor se hacen en una sola pasada por semana y se guardan las líneas
  resultantes con su snapshot; no se recalcula al pintar.

---

## 10. Despliegue

- **Desarrollo:** Postgres local, storage local.
- **Producción:** Postgres administrado con copias de seguridad diarias y retención de
  30 días; app en contenedor; storage en S3/Azure Blob con versionado activado.
- Variables sensibles solo por entorno; nunca en el repositorio.
- Antes de cada despliegue: `npm run check` en verde, migraciones aplicadas en un entorno
  de prueba con copia de los datos reales.
