# Cómo seguir trabajando esto en otro computador

Todo el código está en GitHub: **`juanrafa72/skyline-infracore-payroll`** (privado).
Los **datos no** — nunca van al repositorio. Se llevan aparte, y abajo se
explica cómo.

Si quien lo abre es Claude Code: **empieza leyendo `CLAUDE.md`**, que tiene las
reglas que no se rompen, la arquitectura y las trampas que ya costaron errores.
Ese archivo solo se carga si la sesión arranca **dentro de esta carpeta**.

---

## 1. Lo que tiene que haber en el computador nuevo

| | Cómo se comprueba |
|---|---|
| Node 22 o más | `node --version` |
| PostgreSQL 16 | `psql --version` |
| Git | `git --version` |

En un Mac con Homebrew:

```bash
brew install node postgresql@16 git
brew services start postgresql@16
```

---

## 2. Traerse el código

```bash
git clone https://github.com/juanrafa72/skyline-infracore-payroll.git
cd skyline-infracore-payroll
npm install
```

> **Ojo si la carpeta va a quedar dentro de iCloud.** iCloud crea copias
> «archivo 2.ts» que rompen la compilación. `npm run clean` las borra y corre
> solo antes de cada `typecheck`. Si se puede, mejor una carpeta fuera de
> iCloud.

---

## 3. La base de datos

### Crear la base vacía

```bash
createdb payroll_dev
```

### El archivo `.env`

No está en el repositorio (lleva claves). Se crea a mano en la raíz:

```bash
DATABASE_URL="postgresql://TU_USUARIO@localhost:5432/payroll_dev"
SESSION_SECRET="una-frase-larga-de-por-lo-menos-32-caracteres"

# Solo si se va a entrar desde otros computadores de la oficina por http://
# En un sitio publicado con HTTPS esta variable NO va.
SESSION_COOKIE_SECURE=false
```

`TU_USUARIO` es el del sistema; se ve con `whoami`.

### Levantar el esquema

```bash
npm run db:migrate    # crea las 64 tablas, triggers y restricciones
npm run db:seed       # compañías, roles, permisos, reglas sin confirmar, Ana
```

Con esto ya arranca, pero **vacío**: sin trabajadores, sin proyectos, sin
historia.

### Traerse los datos (opcional pero recomendado)

Los datos viven en la base del Mac donde se ha venido trabajando. Se copian con
un archivo de respaldo:

```bash
# En el computador VIEJO
pg_dump payroll_dev > payroll_dev.sql

# Se pasa el archivo por USB, AirDrop o iCloud, y en el NUEVO:
dropdb --if-exists payroll_dev && createdb payroll_dev
psql payroll_dev < payroll_dev.sql
```

Ya hay respaldos hechos en `~/respaldos-payroll/` del computador viejo.

### Crear con quién entrar

```bash
npm run user:create "Tu Nombre" tucorreo@ejemplo.com SUPER_ADMIN SKYLINE,INFRACORE
```

Muestra una contraseña temporal **una sola vez**. Para pruebas se puede fijar
una acordada como último argumento:

```bash
npm run user:create "Leo" admin@skylinenext.com PAYROLL_PREPARER SKYLINE,INFRACORE skyline123
```

Roles: `SUPER_ADMIN`, `PAYROLL_PREPARER`, `PAYROLL_APPROVER`, `TREASURY`,
`AUDITOR`.

---

## 4. Levantarlo

```bash
npm run dev      # http://localhost:3100
```

El puerto 3100 es fijo a propósito: el 3000 lo usa otro proyecto.

Para dejárselo al negocio, compilado:

```bash
npm run build && npm run start
```

Desde otro computador de la red: `http://<nombre-del-mac>.local:3100`. Está
explicado paso a paso en `docs/LAN_ACCESS.md` — casi siempre lo único que falta
es darle permiso a `node` en el firewall.

---

## 5. Comprobar que todo quedó bien

Son tres niveles y cada uno atrapa cosas distintas. **Correr los tres.**

```bash
npm run check    # tipos, lint, 585 pruebas, compilación
npm run smoke    # abre las 47 pantallas + el PDF (necesita el servidor arriba)
npm run flow     # 124 comprobaciones del proceso completo contra la base real
```

Si `smoke` o `flow` fallan por «no encuentro la semana» o parecido, casi
siempre es que la base está vacía: falta el respaldo o el `db:seed`.

**Un servidor viejo miente.** Si `npm run dev` estaba corriendo desde antes de
tocar el esquema, guarda el cliente de Prisma viejo y las pantallas dan 500
aunque el código esté bien. Ante un 500 raro: matar el proceso del 3100 y
volver a levantarlo antes de investigar.

---

## 6. Dónde está cada cosa

```
src/lib/payroll/engine/     El motor de dinero. PURO: sin base, sin React, sin reloj.
src/lib/**/index.ts         Reglas de negocio puras — se prueban sin base.
src/lib/**/service.ts       Lo mismo, pero tocando la base con Prisma.
src/app/(app)/*/actions.ts  Server Actions: validan y llaman al servicio.
src/app/(app)/*/page.tsx    Las pantallas.
prisma/schema.prisma        Las 64 tablas.
prisma/migrations/          26 migraciones, en orden.
tests/                      585 pruebas.
scripts/smoke.mts           Abre todas las pantallas.
scripts/flow-check.mts      El proceso de punta a punta.
docs/BUSINESS_RULES.md      239 reglas de negocio, con quién las confirmó.
CLAUDE.md                   Cómo trabajar aquí. Leerlo primero.
```

La separación `index.ts` / `service.ts` **no es estética**: un componente de
cliente que importe un servicio arrastra Prisma al navegador y rompe la
compilación con «Can't resolve 'dns'».

---

## 7. En qué va el proyecto

El proceso completo está construido y probado de punta a punta para los tres
pagables —persona, cuadrilla y equipo rentado—: marcar días → calcular →
resumen con consecutivo → aprobar y asignar empresa receptora → órdenes de
desembolso → pagar → PDF → histórico. Más: cheques y retenciones de lo que nos
pagan, hoja de vida de equipos, préstamos, márgenes y la pantalla Base.

**Lo que falta, en orden:**

0. **Desde qué correo salen los reportes** — y son DOS, uno por compañía, porque
   cada una tiene su dominio. Faltan `SMTP_FROM_SKYLINE` y
   `SMTP_FROM_INFRACORE` y conectar la librería en `src/lib/mail/smtp.ts`.
   Mientras tanto la aplicación **no miente**: dice que quedó registrado pero
   que no salió.
1. Semana trabajada vs. facturada.
2. Cuentas por pagar y proyección.
3. Dashboard con los KPI del año.
4. Reapertura de semanas cerradas con motivo y aprobación.
5. Costo de equipo dentro del margen (BR-171).

**Pedido por el negocio y todavía sin construir:**

- El concepto de cuadrilla **propia / contratista / mixta** (hoy solo existe
  «se le paga a un contratista»), con PDF de lista de precios firmada por
  proyecto.
- **Varias listas de precio por proyecto**: en un mismo pueblo, unos feeders se
  pagan a un precio y otros a otro, y hay que guardar los PDF.
- Una **lista de reportes descargables** en Catálogos.

**Cosas del negocio, no del sistema:**

- 47 personas de Skyline tienen tarifa **provisional de $1**, puesta para poder
  seguir. Si se aprueba una semana así, cobran $5. Solo Rafael sabe las reales.
- Infracore: 16 de 18 personas sin tarifa.
- 37 grupos de nombres que podrían ser la misma persona, retenidos sin unir.
- 12 de las 15 «cuadrillas» de Skyline salieron de la columna EQUIPO del Excel
  y son equipos internos (CAMION, CUBO, DIRECCIONAL DRILL): no tienen
  contratista y no se les puede pagar. Se pueden desactivar.

**Bloqueado por fuera:** el despliegue en Netlify (sin créditos hasta el
12/09/2026) y la conciliación con SharePoint (Microsoft rechaza la extracción
con 406 por etiqueta de confidencialidad).

---

## 8. Los tres Excel de referencia — NO SE MODIFICAN

Se leen, nunca se escriben. Están en el Mac de Rafael:

```
.../SKYLINE ADVANCE TECH/03 - RECURSOS HUMANOS/SEGUIMIENTO LABORAL/2026 Laboral/
    NOMINA 2026 AERIO&UG- v03-20 oct---.xlsx
.../INFRACORE SYSTEMS LLC/SEGUIMIENTO LABORAL - INFRACORE/
    NOMINA 2026 -INFRACORE-N-AGOSTO 9.xlsx
~/Downloads/FORMATO COMIS.xlsx
```

El análisis está en `docs/EXCEL_ANALYSIS.md` (14 errores críticos encontrados)
y el mapeo en `docs/EXCEL_MAPPING.md`.
