# IMPLEMENTATION_PLAN.md

Plan concreto. Cada módulo termina con `npm run check` en verde: typecheck + lint + tests
+ build. **No se avanza dejando errores conocidos.**

---

## PHASE 1 — CORE

Objetivo: Leo prepara, Rafael aprueba, Tesorería paga, todo auditado, con dos compañías
separadas y comprobantes reales. Sin importaciones, sin producción, sin SharePoint.

### M0 · Fundación técnica
- Proyecto Next.js 15 + TypeScript strict + Tailwind v4
- ESLint con regla propia: prohibido `prisma.<modelo>.findMany` sin scope
- Vitest configurado
- Prisma + Postgres, primera migración
- Scripts `dev`, `typecheck`, `lint`, `test`, `build`, `check`, `db:migrate`, `db:seed`

**Terminado cuando:** `npm run check` pasa en un proyecto vacío pero completo.

### M1 · Modelo de datos y seguridad de base
- `schema.prisma` completo según `DATA_MODEL.md`
- Restricciones: únicos, `CHECK`, exclusión de solapamiento en tarifas
- Trigger append-only en `audit_log`
- Trigger de inmutabilidad en nóminas `PAID` / `RECONCILED` / `CLOSED`
- Row Level Security por `companyId`
- Seed: 2 compañías, roles, permisos, operaciones, categorías

**Terminado cuando:** un test intenta `UPDATE` sobre `audit_log` y la base lo rechaza.

### M2 · Motor de payroll ⭐ *primero el motor, antes que cualquier pantalla*
- `money.ts`: tipo `Cents`, conversión, redondeo `ROUND_HALF_UP`
- `base-pay.ts`, `additions.ts`, `deductions.ts`, `advances.ts`, `debts.ts`,
  `settlement.ts`, `variance.ts`
- Resolución de tarifa vigente con precedencia
- Función pura `calculateWorkerPayroll(input): PayrollResult` con traza de cálculo

**Tests obligatorios** (`tests/engine/`):
```
día completo · medio día · día no trabajado · pago por hora
tarifa nocturna · tarifa por proyecto · tarifa sin vigencia (debe fallar, no pagar 0)
adicionales por categoría · descuentos por categoría
recuperación de anticipo: fija, porcentaje, porcentaje con tope, pausa
recuperación de deuda con saldo insuficiente
neto negativo · neto exactamente 0
redondeo: 0,005 · 0,015 · 1/3 · centavo perdido en cadena
suma de 150 líneas sin desviación
settlement de contratista con comisión y descuentos
descuento de contratista NO se distribuye a trabajadores
variance de 0,10 se reporta, no se absorbe
determinismo: 1.000 ejecuciones, mismo resultado
```

**Terminado cuando:** todos los tests financieros pasan y la cobertura de
`lib/payroll/engine` es 100 % de ramas.

### M3 · Autenticación, RBAC y selector de compañía
- Auth.js v5, Argon2id, bloqueo por intentos, TOTP para roles sensibles
- `assertCan(user, permission, resource)` que lanza
- Scope de compañía en sesión + `scopedDb()`
- Selector de compañía en la barra superior, con auditoría del cambio
- Shell de la aplicación: navegación filtrada por permisos

**Tests** (`tests/security/`): acceso cruzado entre compañías, escalada de permisos, IDOR.

### M4 · Maestros
Trabajadores · Contratistas · Cuadrillas (con historial de miembros) · Proyectos ·
Clientes · Equipos · Operaciones · Tarifas con historial y aprobación.

**Terminado cuando:** se puede dar de alta a una persona con dos tarifas de vigencias
distintas y el sistema resuelve correctamente la de cualquier fecha.

### M5 · Registro semanal de trabajo
- Semanas de nómina generadas por compañía
- Captura de días: rejilla en desktop, tarjetas en móvil
- Normalización a `FULL_DAY` / `HALF_DAY` / `NO_WORK` / `HOURLY`
- Único por `(compañía, trabajador, fecha)`
- Detección `CROSS_COMPANY_DUPLICATE`

### M6 · Anticipos y deudas
- Módulo `Advances` con su ciclo de estados y aprobación separada
- Módulo `Debts` con libro mayor de movimientos y saldo calculado
- Reglas de recuperación configurables, pausas y exclusiones
- Condonación con aprobación obligatoria

### M7 · Adicionales y descuentos
- Categorías administrables
- Descripción obligatoria
- Recuperaciones generadas por el motor, no capturables a mano

### M8 · Preparación de nómina (Leo)
- Pantalla `Current Week`
- Cálculo, borrador, envío a aprobación
- Panel de excepciones; `CRITICAL` bloquea el envío
- Vista móvil en tarjetas

### M9 · Approval Center (Rafael)
- Resumen de semana y detalle por trabajador
- Variación contra semana anterior con umbral configurable
- Aprobar / rechazar / devolver con comentario obligatorio
- `calculationHash` congelado al aprobar
- **Invalidación automática** al cambiar cualquier campo material
- Segregación: no aprueba quien preparó

**Tests** (`tests/workflow/`): cada transición válida e inválida; invalidación por cada
uno de los campos materiales, uno por uno.

### M10 · Payment Center (Tesorería)
- Solo nóminas aprobadas
- Campos financieros bloqueados en el backend
- Registro de pago con evidencia obligatoria
- Validación `pagado > aprobado` y detección de referencia duplicada
- Devolución con motivo

### M11 · Comprobantes
- PDF real con `@react-pdf/renderer`
- Snapshot congelado
- Descarga por endpoint con permisos
- Cuenta bancaria enmascarada
- Email y WhatsApp visibles pero deshabilitados, con la razón a la vista

### M12 · Audit Log y Exceptions Center
- Consulta filtrable por compañía, usuario, entidad, semana, acción
- Vista de excepciones por nivel y estado
- Resolución con motivo

### M13 · Dashboard por compañía
Payroll (semana actual, anterior, pendientes, aprobadas, listas, pagadas, pendiente de
pago) · Workforce · Adjustments. Sin gráficos decorativos.

### M14 · Cierre de Phase 1
- `npm run check` verde
- Paralelo real: una semana completa capturada en el sistema y en el Excel, comparadas
  línea por línea. **Toda diferencia explicada antes de continuar.**
- Repaso de los `NEEDS BUSINESS CONFIRMATION` con el negocio

---

## PHASE 2 — Importación, producción, conciliación

- Import Wizard: subir → identificar → mapear → previsualizar → validar → excepciones →
  importar → conciliar, con idempotencia y reversión de lote
- Migración del histórico según `EXCEL_MAPPING.md` §5, incluida la resolución manual de
  alias, equipos y cuadrillas
- Módulo de Producción
- Contractor Settlements completos
- Conciliación
- Exceptions Center ampliado
- Integración SharePoint (solo lectura)

**Hito de aceptación:** recalcular con el motor cada semana histórica y comparar contra el
`PAGO TOTAL` del Excel. Diferencias documentadas como `Variance`, ninguna sin explicar.

---

## PHASE 3 — Financiero

Ventas y facturación · Dashboard financiero · Cash Management (Cash In − Cash Out) ·
Ingreso vs costo laboral · Margen por proyecto, cuadrilla, contratista y operación ·
Reportes · Dashboard consolidado Skyline + Infracore + Total.

---

## PHASE 4 — Comunicaciones

Email por Microsoft Graph · WhatsApp Business Cloud API con plantillas aprobadas ·
Notificaciones de flujo · Integraciones avanzadas.

---

## Orden y dependencias

```
M0 → M1 → M2 → M3 → M4 → M5 → M6 → M7 → M8 → M9 → M10 → M11 → M12 → M13 → M14
                      │                                    ▲
                      └─ M2 es prerequisito de todo lo que toca dinero
```

M2 va antes que cualquier pantalla a propósito: el motor y sus tests son el activo
más importante del sistema. Si el motor está bien, las pantallas son reemplazables.

---

## Riesgos del proyecto

| Riesgo | Mitigación |
|---|---|
| Los alias de trabajadores se unen mal → alguien cobra de menos | Ninguna unión automática; confirmación humana auditada |
| Los 448 días duplicados se importan | Quedan retenidos hasta decisión del negocio (A6) |
| Reglas sin confirmar se implementan adivinando | Valor por defecto conservador + insignia visible + configurable |
| El paralelo Excel/sistema no cuadra | M14 no se cierra hasta explicar cada diferencia |
| Alguien sigue usando el Excel en paralelo | Definir fecha de corte y bloqueo de escritura del Excel al terminar Phase 1 |
| Los archivos originales se dañan | Nunca se escriben. Copia de seguridad antes de la migración |
