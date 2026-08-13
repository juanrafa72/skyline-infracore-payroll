# PERMISSIONS.md

---

## 1. Principios

1. **Los permisos se verifican en el servidor.** Ocultar un botón no es seguridad.
2. **Ninguna persona está en el código.** Leo, Rafael y quien pague son asignaciones de rol
   modificables desde Settings.
3. **Roles por compañía.** El mismo usuario puede ser aprobador en Skyline y solo lector
   en Infracore.
4. **Segregación de funciones**: preparar, aprobar y pagar son excluyentes en una misma
   nómina, aunque una persona tenga varios roles.
5. **Mínimo privilegio.** Un rol nuevo empieza sin permisos.

---

## 2. Roles iniciales

| Rol | Quién (hoy) | Resumen |
|---|---|---|
| `SUPER_ADMIN` | administrador del sistema | todo, incluido usuarios y ajustes. **No puede** aprobar ni pagar nóminas que preparó. |
| `PAYROLL_PREPARER` | Leo | prepara y envía a aprobación. No aprueba, no paga. |
| `PAYROLL_APPROVER` | Rafael | aprueba, rechaza, devuelve. No prepara, no paga. |
| `TREASURY` | tercera persona | paga y carga comprobantes. No modifica montos. |
| `AUDITOR` | — | lectura total + audit log. Sin escritura. |
| `EMPLOYEE_PORTAL` | trabajadores | solo lo propio. |
| `CONTRACTOR_PORTAL` | contratistas | solo lo propio. |
| `CREW_PORTAL` | líderes de cuadrilla | solo su cuadrilla. |

---

## 3. Matriz de permisos

Leyenda: ✅ permitido · ❌ denegado · 👁 solo lectura · ⚠️ con restricción

| Permiso | SUPER_ADMIN | PREPARER | APPROVER | TREASURY | AUDITOR | EMPLOYEE | CONTRACTOR | CREW |
|---|---|---|---|---|---|---|---|---|
| `company:switch` | ✅ | ⚠️ asignadas | ⚠️ asignadas | ⚠️ asignadas | ⚠️ | ❌ | ❌ | ❌ |
| `dashboard:view` | ✅ | ✅ | ✅ | 👁 pagos | 👁 | ❌ | ❌ | ❌ |
| `dashboard:consolidated` | ✅ | ❌ | ✅ | ❌ | 👁 | ❌ | ❌ | ❌ |
| **Nómina** |
| `payroll:view` | ✅ | ✅ | ✅ | 👁 aprobadas | 👁 | 👁 propia | ❌ | 👁 su crew |
| `payroll:create` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `payroll:edit` | ⚠️ | ✅ draft | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `payroll:submit` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `payroll:approve` | ⚠️ no propias | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `payroll:reject` | ⚠️ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `payroll:return` | ✅ | ❌ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| `payroll:close` | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Pagos** |
| `payment:view` | ✅ | 👁 | ✅ | ✅ | 👁 | 👁 propios | 👁 propios | ❌ |
| `payment:execute` | ⚠️ no propias | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ |
| `payment:proof:upload` | ✅ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ |
| `payment:reverse` | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `payment:adjust` | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Maestros** |
| `worker:view` | ✅ | ✅ | ✅ | 👁 | 👁 | 👁 propio | ❌ | 👁 su crew |
| `worker:manage` | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `rate:view` | ✅ | ✅ | ✅ | ❌ | 👁 | 👁 propia | ❌ | ❌ |
| `rate:manage` | ✅ | ⚠️ propone | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `contractor:manage` | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `crew:manage` | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `project:manage` | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `equipment:manage` | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Anticipos y deudas** |
| `advance:view` | ✅ | ✅ | ✅ | 👁 | 👁 | 👁 propios | 👁 propios | ❌ |
| `advance:create` | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `advance:approve` | ⚠️ no propias | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `debt:view` | ✅ | ✅ | ✅ | 👁 | 👁 | 👁 propia | 👁 propia | ❌ |
| `debt:create` | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `debt:forgive` | ⚠️ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Otros** |
| `receipt:view` | ✅ | ✅ | ✅ | ✅ | 👁 | 👁 propios | 👁 propios | ❌ |
| `receipt:send` | ✅ | ❌ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| `import:execute` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `import:revert` | ✅ | ⚠️ no importado | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `exception:resolve` | ✅ | ⚠️ WARNING | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `audit:view` | ✅ | 👁 propias | ✅ | 👁 propias | ✅ | ❌ | ❌ | ❌ |
| `user:manage` | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `settings:manage` | ✅ | ❌ | ⚠️ reglas de negocio | ❌ | ❌ | ❌ | ❌ | ❌ |
| `rule:confirm` | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |

---

## 4. Segregación de funciones — reglas duras

Se verifican en el backend en cada transición, con el permiso ya concedido:

```
SoD-1  quien preparó una nómina no puede aprobarla
SoD-2  quien aprobó una nómina no puede ejecutar su pago
SoD-3  quien solicita un anticipo no puede aprobarlo
SoD-4  quien crea una deuda no puede condonarla
SoD-5  quien ejecuta un pago no puede conciliarlo   (Phase 2)
SoD-6  quien importa un lote no puede aprobar la nómina que produjo
```

`SUPER_ADMIN` **no** es excepción. Si intenta aprobar lo que preparó, se rechaza.
El único camino es que otra persona con el rol lo haga. Si el negocio necesita una
excepción de emergencia, se implementa como *break-glass*: acción explícita, con motivo
obligatorio, notificación a todos los administradores y marca permanente en la nómina.
**No existe en Phase 1.**

---

## 5. Portales — aislamiento

### Empleado
- Ruta: `/portal` (sin id en la URL). El sujeto sale de la sesión.
- Ve: semana actual, su nómina, días, horas, adicionales, descuentos, anticipos, deuda,
  neto, estado y comprobantes propios.
- **No ve**: nóminas de otros, tarifas de otros, márgenes, costos, ningún dato de la otra
  compañía.
- Las nóminas en `DRAFT` o `PENDING_APPROVAL` **no son visibles**: solo desde `APPROVED`.

### Contratista
- Ve: sus settlements, invoices, ajustes, descuentos, pagos, comprobantes, e información
  autorizada de las cuadrillas asociadas.
- **No ve**: margen global, nóminas de otros contratistas, comisiones de la compañía,
  nada de la otra compañía.

### Cuadrilla
- Ve: solo la información de su cuadrilla, en el alcance que Settings autorice.
- Por defecto: días trabajados y producción de la cuadrilla. **Sin montos individuales**
  salvo que se active explícitamente.

### Cómo se garantiza (BR/IDOR)
```
- No existe ninguna ruta de portal que acepte un id de sujeto por parámetro.
- Toda consulta de portal pasa por un scope que fija subjectId = sesión.
- Los archivos se sirven por endpoint con verificación de propiedad.
- Tests en tests/security/ intentan el acceso cruzado y deben fallar.
```

---

## 6. Enmascaramiento de datos sensibles

| Dato | Quién ve completo | Quién ve enmascarado |
|---|---|---|
| Cuenta bancaria | nadie en la UI | todos: `****4417` |
| SSN / ITIN | `SUPER_ADMIN` bajo registro de acceso | resto: oculto |
| Documentos personales | roles con `worker:manage` | resto: sin acceso |
| Salario de terceros | roles administrativos | portales: solo lo propio |

Cada consulta de un dato sensible se registra en el audit log.

---

## 7. Autenticación

- **Phase 1:** email + contraseña con hash Argon2id, política de contraseña,
  bloqueo tras 5 intentos, sesión de 12 h, y **TOTP obligatorio** para
  `PAYROLL_APPROVER`, `TREASURY` y `SUPER_ADMIN`.
- **Después:** Microsoft Entra ID como proveedor. El modelo de usuarios ya lo contempla
  (`entraObjectId`); no hay migración de datos al activarlo.
- Los portales de trabajador y contratista se invitan por enlace de un solo uso; nunca se
  crean contraseñas por terceros.
