# INTEGRATIONS.md

---

## 1. SharePoint / Microsoft Graph (Phase 2)

### Fuentes

| Compañía | Enlace |
|---|---|
| Skyline | `https://skylinenext.sharepoint.com/:x:/s/Skyline/IQAkf_cmcboGRKoR1XYjwdGWAR29iVJLSzeJy4uwhD0ARMo` |
| Infracore | `https://skylinenext.sharepoint.com/:x:/s/Skyline/IQDfzcCVwymAQp7aOVdD2wCJAQG3xQoy6iq2PxL1S3h8FyM` |

Ambas son hojas de cálculo en el sitio `Skyline` del tenant `skylinenext`.
De ahí salen **producción, ventas y/o pagos a contratistas**.

> **Su estructura no se ha inspeccionado y no se inventa.** No hay acceso autenticado
> todavía. Cualquier modelo concreto de esas hojas se define después de leerlas, con el
> mismo nivel de análisis que se hizo con los Excel locales.

### Tratamiento

- **Solo lectura.** El sistema nunca escribe en SharePoint en Phase 2.
- **Fuente externa**, no fuente de verdad: los datos entran como `ExternalRecord` y
  requieren conciliación antes de afectar dinero.
- Sin acceso directo desde el navegador. Todo pasa por el servidor.

### Arquitectura de conexión

```
src/lib/integrations/
├── sharepoint/
│   ├── client.ts          autenticación Microsoft Graph
│   ├── workbook.ts        lectura de rangos/tablas vía Graph Workbook API
│   ├── sync.ts            orquestación e idempotencia
│   └── mapping.ts         mapeo columna → entidad, versionado
└── shared/
    ├── external-record.ts
    └── reconciliation.ts
```

**Autenticación:** app registration en Entra ID, flujo *client credentials*, permisos de
aplicación con consentimiento del administrador:

```
Sites.Selected          ← preferido: acceso solo al sitio Skyline, no a todo el tenant
Files.Read.All          ← solo si Sites.Selected no basta
```

Se elige `Sites.Selected` por mínimo privilegio: el permiso se concede sitio por sitio.

**Lectura:** Graph Workbook API sobre el archivo:
```
GET /sites/{siteId}/drive/items/{itemId}/workbook/worksheets
GET /sites/{siteId}/drive/items/{itemId}/workbook/tables/{name}/rows
```
Se prefieren **tablas con nombre** sobre rangos: los rangos se rompen al insertar filas.
Si las hojas no tienen tablas definidas, el primer paso de la integración es pedir que
las definan — es más barato que mantener un mapeo por coordenadas.

### Sincronización

```
1. Leer  → filas crudas
2. Hash  → sha256 por fila (clave natural + contenido)
3. Comparar contra ExternalRecord ya almacenado
4. Nuevas → crear;  cambiadas → nueva versión + Variance;  iguales → ignorar
5. Registrar SyncBatch (igual que ImportBatch)
6. Nada afecta dinero hasta que un usuario lo concilie
```

Idempotente por diseño: sincronizar dos veces no duplica (BR-150).

**Frecuencia:** manual al principio (botón "Sincronizar"), programada después.
Nunca automática hacia una nómina aprobada.

### Entidad de puente

```
ExternalRecord
  id, companyId, source ('SHAREPOINT_SKYLINE' | 'SHAREPOINT_INFRACORE'),
  externalId, entityHint (PRODUCTION|SALES|CONTRACTOR_PAYMENT),
  rawJson, contentHash, syncBatchId,
  status (NEW|MAPPED|RECONCILED|IGNORED|CONFLICT),
  mappedEntityType, mappedEntityId,
  reconciledById, reconciledAt
```

### Riesgos conocidos

| Riesgo | Mitigación |
|---|---|
| Alguien cambia columnas en SharePoint | El mapeo está versionado; si el encabezado no coincide, la sincronización **falla en vez de adivinar** |
| Datos borrados en el origen | El sistema conserva la última versión y marca `CONFLICT`; no borra nada propio |
| Permisos demasiado amplios | `Sites.Selected` sitio por sitio |
| Tokens en el repositorio | Todo por variables de entorno; secreto rotable |

---

## 2. Email (Phase 4)

- Proveedor: **Microsoft Graph `sendMail`** desde una cuenta de la organización.
  Encaja con el tenant existente y evita un tercero más.
- Alternativa si se necesita mejor entregabilidad y trazabilidad: Resend o SES.
- Uso: envío de comprobantes de pago y notificaciones de flujo (nómina esperando
  aprobación, nómina rechazada, pago realizado).
- Registro: `NotificationLog` con destinatario, plantilla, estado, id del proveedor,
  fecha de envío y de entrega.

**Hasta que exista la integración real, el botón "Send by Email" está visible y
deshabilitado, con la razón a la vista. El sistema jamás marca algo como enviado si no se
envió.**

---

## 3. WhatsApp (Phase 4)

- **WhatsApp Business Platform (Cloud API)** de Meta.
- Requisitos previos, en este orden:
  1. Cuenta de WhatsApp Business verificada
  2. Número dedicado (no puede ser un número que ya use la app normal)
  3. **Plantillas de mensaje aprobadas por Meta** — obligatorio para iniciar conversación
  4. Consentimiento explícito de cada destinatario, registrado con fecha
- Uso previsto: aviso de pago realizado con enlace al comprobante.
  **El comprobante no se envía como archivo por WhatsApp**: se envía un enlace firmado de
  vida corta que exige sesión. Los montos individuales no viajan en el mensaje.
- Registro en `NotificationLog` igual que email.

Mismo principio: deshabilitado hasta que funcione de verdad.

---

## 4. Bancos y contabilidad (futuro, sin compromiso)

Nada de esto está en el alcance. Se anota solo para que el modelo no lo impida:

- **Conciliación bancaria**: importación de extracto (CSV/OFX) → `BankTransaction` →
  emparejamiento contra `Payment` → estado `RECONCILED`.
- **QuickBooks / contabilidad**: exportación de asientos por semana y compañía.
  El modelo ya separa compañía, proyecto, cuadrilla y tipo de costo, que es lo que
  cualquier exportación necesita.

---

## 5. Reglas comunes a toda integración

1. **Nunca fuente de verdad.** Lo externo entra como propuesta, se concilia, y solo
   entonces afecta dinero.
2. **Idempotencia obligatoria.** Hash de contenido + clave natural.
3. **Fallar antes que adivinar.** Si la estructura cambió, se detiene y avisa.
4. **Todo se audita.** Cada sincronización, cada conciliación, cada envío.
5. **Credenciales fuera del código.** Variables de entorno, rotables, con el mínimo
   privilegio posible.
6. **Sin simulaciones.** Si una integración no existe, la función se muestra
   deshabilitada. Nunca se finge un resultado.
