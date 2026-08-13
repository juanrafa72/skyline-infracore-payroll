# EXCEL_ANALYSIS.md

Análisis técnico de los tres libros de referencia. **Ningún archivo fue modificado.**
Lectura hecha con `openpyxl` en modo lectura, extrayendo fórmulas y valores cacheados.

Fecha del análisis: 2026-08-12.

---

## Índice

1. [NOMINA 2026 AERIO&UG (Skyline)](#1-nomina-2026-aeriough--skyline)
2. [NOMINA 2026 INFRACORE](#2-nomina-2026--infracore)
3. [FORMATO COMIS](#3-formato-comis)
4. [Hallazgos críticos](#4-hallazgos-críticos-consolidados)
5. [Ambigüedades — NEEDS BUSINESS CONFIRMATION](#5-ambigüedades--needs-business-confirmation)
6. [Qué se migra y qué no](#6-qué-se-migra-y-qué-no)

---

## 1. NOMINA 2026 AERIO&UG — Skyline

**Ruta:** `.../SKYLINE ADVANCE TECH/03 - RECURSOS HUMANOS/SEGUIMIENTO LABORAL/2026 Laboral/NOMINA 2026 AERIO&UG- v03-20 oct---.xlsx`

> Nota: existe un archivo bloqueo `~$NOMINA 2026 AERIO&UG- v03-20 oct---.xlsx` en la misma
> carpeta → el libro estaba abierto por alguien al momento del análisis. Riesgo típico de
> edición concurrente sobre archivo único.

### 1.1 Hojas

| Hoja | Estado | Filas | Función real |
|---|---|---|---|
| `BASE` | visible | 26.265 datos | **Tabla maestra `Principal`** (B1:AA26266). Única fuente de verdad. |
| `herby y dino 2026` | visible | 9.948 | Tabla dinámica filtrada por trabajador |
| `DH BLOWFIBER` | visible | 9.948 | Tabla dinámica — operación BlowFiber |
| `DH UG` | visible | 6.409 | Tabla dinámica — Underground |
| `DH AEREO` | visible | 9.948 | Tabla dinámica — Aéreo |
| `Listas` | visible | 199 | Catálogos: trabajadores, tarifas, proyectos, clientes, adicionales |
| `LISTADO` | oculta | 23 | Lista suelta de 13 nombres, sin uso aparente |
| `INFORME` | oculta | 1 | Vacía |
| `Dinamicas` | oculta | 527 | Pivotes de costo con `GETPIVOTDATA` |
| `FEDE Deuda` | oculta | 9.948 | **Control de una deuda personal (Federico)** fuera del modelo formal |

### 1.2 La tabla `Principal` (hoja BASE) — 26 columnas

| Col | Nombre | Tipo | Fórmula / origen |
|---|---|---|---|
| B | `Tipo` | lista | Aereo · Underground · Admin · BlowFiber |
| C | `Columna1` | fórmula | `CONCAT("T_", Tipo)` → apunta al rango con nombre de esa operación |
| D | `Nombre` | lista dependiente | `INDIRECT(Tipo)` — valida contra la lista de la operación |
| E | `Día` | fórmula | `DAY(Fecha)` |
| F | `Fecha` | fecha | día calendario |
| G | `Día trabajados` | lista | `Si` · `No` · `0.5` |
| H | `Observ Trabaj` | lista | Mantenimiento · Lluvia · Vacaciones · Descanso |
| I | `Adicionales` | lista | Lavar Carros · Emergencia · Bono por cumplimiento · Prestamo a compañia |
| J | `Corte` | fórmula | `IF(Fecha=0,0, CONCAT("Semana"," ",WEEKNUM(Fecha)))` |
| K | `Valor Día` | fórmula | `IFERROR(VLOOKUP(Nombre, Listas!$J$3:$K$196, 2, 0), 0)` |
| L | `Valor adicional` | manual | monto del adicional |
| M | `Dctos` | manual | monto del descuento |
| N | `Observación Dctos` | texto libre | **264 valores distintos** |
| O | `PAGO TOTAL` | fórmula | `IF(G="Si",K, IF(G=0.5, G*K, 0)) + L - M` |
| P–R | `Mes`, `Día semana`, `AÑO` | fórmula | derivados de Fecha |
| S | `PROYECTOS` | lista | proyecto/ubicación |
| T | `EMPRESA` | fórmula | `VLOOKUP(PROYECTOS, PROYECTOS[], 2, 0)` → **cliente**, no compañía |
| U | `EQUIPO` | manual | cuadrilla (crew) |
| V | `HORAS` | fórmula | `IFS(G="Si",8, G=0.5,4, G="No",0)` |
| W | `PAYROLL` | fórmula | `VLOOKUP(Nombre, TRABAJADORES_AEREOS[], 3, 0)` → "Payroll" o 0 |
| X–Z | `DÍAS DEL AÑO`, `DÍAS TRABAJADOS`, `% DÍAS ACTIVOS` | fórmula | usan `TODAY()` |
| AA | `NOMBRES UNICOS` | manual | copia parcial del nombre |

### 1.3 La fórmula de pago (todo el negocio en una celda)

```
PAGO TOTAL = IF(Día trabajados = "Si",  Valor Día,
             IF(Día trabajados = 0.5,   0.5 × Valor Día,
                                        0))
             + Valor adicional
             - Descuentos
```

Consecuencias:

- Solo existen tres estados de día: **completo, medio, nada**. No hay horas reales,
  no hay recargo nocturno, no hay horas extra.
- `HORAS` es **derivada** (8 / 4 / 0), no medida. Los 84.680 "horas" del archivo no son
  horas trabajadas: son días × 8. **No sirven para nada legal ni para costeo real.**
- Adicionales y descuentos son **un solo número por día**, sin categoría ni trazabilidad.
  Su explicación vive en un texto libre (`Observación Dctos`) con 264 variantes.

### 1.4 Catálogos (hoja `Listas`)

Cuatro tablas de trabajadores, una por operación, cada una con `TRABAJADORES | TARIFA | item`:

| Tabla | Rango | Registros |
|---|---|---|
| `TRABAJADORES_Admin` | F2:H199 | ~7 |
| `TRABAJADORES_AEREOS` | J2:L196 | ~49 |
| `TRABAJADORES_UNDERGROUND` | N2:P198 | ~48 |
| `TRABAJADORES_Blowfiber` | R2:T108 | ~14 |

Más: `PROYECTOS` (Z2:AB30 → proyecto, cliente, crew), `ADICIONALES` (V2:V6),
`ITEAMS` (X2:X11), `DIATRABAJADO` (D2:D5), `DIATRABAJADO8` (B2:B6).

**El truco del sufijo numérico.** No existe historial de tarifas. Cuando cambia la tarifa
de alguien, se crea un nombre nuevo con un dígito pegado:

```
JAIRO MEJIA          350        AMPARO   143        ISAAC CEBALLOS-UG    150
JAIRO MEJIA1         400        AMPARO1  103        ISAAC CEBALLOS-UG1   230
                                                    ISAAC CEBALLOS-UG2   250
                                                    ISAAC CEBALLOS-UG3   300
```

Lo mismo con sufijos de operación (`-UG`, `-Blow`, `-N`) y proyectos
(`Richmond_VA` vs `Richmond_VA1`, que además apuntan a clientes distintos —
Precision Fiber vs Souther Fiber Solutions).

Esto significa que **la identidad de la persona está rota**: una misma persona son
hasta 4 "trabajadores" distintos. Cualquier reporte por persona está mal.

**Personas y máquinas en la misma lista:**

```
INTERNACIONAL 2014      143   (camión)
Plow-Rent               286   (equipo)
MINI ESCAVADORA (JAIRO MEJIA)  300
COMPRESOR 400CC         132
CAPSTAN                  60
TORNADO                 134
```

**Cuadrillas tratadas como personas:** `AMPARO`, `CHATO`, `CUBO`, `DINO`, `HERBY`,
`MATEO`, `PALMICHE`, `CACIQUE` aparecen a la vez como *trabajador con tarifa* (143 / 103)
y como valor de la columna `EQUIPO` (crew). Un pago a "AMPARO" puede ser a una persona
o a una cuadrilla completa; el archivo no lo distingue.

### 1.5 Volumetría y calidad

| Métrica | Valor |
|---|---|
| Filas de datos en la tabla | 26.265 |
| Filas **vacías dentro** de la tabla | 6.854 (26 %) |
| Filas con nombre + fecha utilizables | 19.411 |
| Nombres distintos | 164 |
| `PAGO TOTAL` acumulado | 1.604.063,91 |
| `PAGO TOTAL` mínimo | **−127,59** (día con pago negativo) |
| Proyectos distintos | 24 |
| Clientes distintos | 13 |
| Crews distintos | 14 |

Problemas medidos:

- **`AÑO` va de 1900 a 2026.** 1900 = fecha vacía. Además el archivo llamado "2026"
  contiene datos de **2024 y 2025** (ej. filas con fecha 2025-05-31, deuda desde feb-2024).
- **`Día semana` en dos idiomas**: 17.219 en español y 1.046 en inglés → el archivo se
  editó en equipos con configuraciones regionales distintas.
- **Variantes de mayúsculas en `Día trabajados`**: `Si` (10.395), `No` (8.634),
  `0.5` (378), y sueltos `SI`, `no`, `NO`. Excel los tolera; un importador estricto no.
- **Duplicados exactos** (mismo nombre + misma fecha): **16 casos**
  (JOSE GREGORI LUGO1 semana del 19–25 ene 2025; ENDERSON FLOREZ LEYVA1 semana del
  22–28 dic 2024; JUANRAFAEL CAMACHO 25-feb-2024).
- **Proyectos duplicados por escritura**: `TUSCALOOSA` (236) vs `Tuscaloosa_AL` (3.232);
  `SKYLINE ADMIN` (120) vs `SKYLINE_ADMIN` (1.586).
- **`NO WORK` es un "proyecto"** (700 filas) asignado al cliente ficticio `SKYLINE ASSET`.
  Es un estado, no un proyecto.
- **Bug de tarifas:** `Valor Día` hace `VLOOKUP` **siempre contra la lista de Aéreo**
  (`Listas!$J$3:$K$196`), sin importar que la fila sea Underground, BlowFiber o Admin.
  Un nombre que solo existe en la lista de Underground devuelve **0** y el día se paga en
  cero sin aviso. Lo mismo aplica a la columna `PAYROLL`.
- **`% DÍAS ACTIVOS` y `DÍAS DEL AÑO` usan `TODAY()`**: el archivo cambia de valor solo
  con abrirlo otro día. No es auditable.
- **Deuda de Federico** vive en una hoja oculta con `GETPIVOTDATA` y una tabla manual
  `SEMANA | FEDE | JRC | RAMON | ESTADO`, empezando "semana 5", con la nota
  *"SE PRESTO LA PLATA EN FEB 14"*. Fuera de todo control.

---

## 2. NOMINA 2026 — INFRACORE

**Ruta:** `.../INFRACORE SYSTEMS LLC/SEGUIMIENTO LABORAL - INFRACORE/NOMINA 2026 -INFRACORE-N-AGOSTO 9.xlsx`

Es **una copia del libro de Skyline** con dos columnas añadidas:
`UNIDAD DE NEGOCIO` (B) y `NOTA` (O). La hoja `Listas` es **idéntica**, incluidos los
trabajadores y tarifas de Skyline.

Hay 5 versiones del mismo archivo en la carpeta (JUN 22, JUN 29, JULIO 20, JULIO 28,
AGOSTO 9) más una copia en `~/Downloads` (JULIO 27). El versionado es por nombre de archivo.

### 2.1 Volumetría

| Métrica | Valor |
|---|---|
| Filas de datos | 862 |
| `UNIDAD DE NEGOCIO` = INFRACORE | 441 |
| `UNIDAD DE NEGOCIO` = **SKYLINE** | **420** |
| `UNIDAD DE NEGOCIO` = "Total" | 1 |
| Nombres distintos | 27 |
| Tarifa máxima | 440 (turno noche) |
| `PAGO TOTAL` sumado | **242.992** |

### 2.2 🔴 Error crítico: fila de totales dentro de la tabla

La fila 863 está **dentro** de la tabla `Principal` y contiene:

```
UNIDAD DE NEGOCIO = "Total"      PAGO TOTAL = 121.496
```

Las 862 filas reales suman exactamente 121.496. La tabla suma **242.992**.

**Cualquier pivote, `SUM` o reporte sobre esta tabla reporta el doble del costo real.**
Es un error del 100 % sobre el costo de nómina de Infracore.

### 2.3 🔴 Error crítico: 448 días duplicados entre los dos libros

448 combinaciones `(persona, fecha)` existen **simultáneamente** en el libro de Skyline
y en el de Infracore. Ejemplos: HECTOR RAMIREZ, MARIO APONTE, ALEJANDRO APONTE,
JOSE RAFAEL URBINA, FREDDIE HUKILL BJ, CHAD BEAIRD, CAPSTAN, ATILIO ARGUIZONES-BLOW1.

Sumar los dos archivos → **doble pago / doble costo**.
No sumarlos → riesgo de dejar días sin pagar.
Hoy nada en los archivos indica cuál de los dos es el bueno.

Además hay **15 duplicados internos** en Infracore (MARIO APONTE y ALEJANDRO APONTE,
semana del 10–16 may 2026; JONATHON WAYNES-N 31-may-2026).

### 2.4 Sufijos de identidad

Infracore usa `-N` y `-2`:

```
ALEJANDRO APONTE · ALEJANDRO APONTE-N · ALEJANDRO APONTE-2
JOSE RAFAEL URBINA · JOSE RAFAEL URBINA-N · JOSE RAFAEL URBINA-2
ERIN HUBBARD-N · ERIN HUBBARD-2   ·   KYLE TYNER-N · KYLE TYNER-2
```

Hipótesis (a confirmar): `-N` = tarifa nocturna, `-2` = tarifa revisada.
Coherente con FORMATO COMIS: *"NOVASITE LLC- $400 DAY RATE - $440 NIGHT RATE"*.
**NEEDS BUSINESS CONFIRMATION.**

### 2.5 Clientes

`SOUTHER FIBER SOLUTIONS` (409) · sin cliente (365) · `WAITING PROYECT` (63) ·
`BIGHAM` (18) · `Skyline Advance Tech` (7).

`WAITING PROYECT` es un estado, no un cliente. `Skyline Advance Tech` como "cliente"
de Infracore implica facturación **entre las dos compañías** — no está modelado en
ninguna parte. **NEEDS BUSINESS CONFIRMATION.**

---

## 3. FORMATO COMIS

**Ruta:** `~/Downloads/FORMATO COMIS.xlsx`

31 hojas: `WEEK 1` … `week 29`, `WEEK 52`, y `descuentos`.
Es el **libro de caja, comisiones y pagos a contratistas** — el más importante y el más frágil.

### 3.1 Estructura de una hoja semanal

Cada hoja `week NN` contiene **seis bloques distintos apilados verticalmente**, sin
separación formal, con encabezados repetidos y significados diferentes:

| Filas aprox. | Bloque | Columnas |
|---|---|---|
| 4–44 | **Contratistas / facturación / comisión** | CONTRATISTA · PROYECTO · WEEK/CHEQUE · TOTAL · ADELANTOS/AJUSTE · DESCUENTOS · TOTAL INVOICE · COMI JRC · TOTAL A CONSIGNAR FZ · GRUPO QUINTERO · TOTAL A CONSIGNAR SKYLINE |
| 49–57 | **Nómina Aéreo** + venta de la semana | CONTRATISTA · PROYECTO · TEAM · WEEK · TOTAL · DESCUENTOS · TOTAL CONSIGNAR |
| 58–66 | **Nómina Underground** + venta | idem |
| 67–74 | **Nómina BlowFiber** + venta | idem |
| 75–84 | **Pendientes** (préstamos, arreglos, grúas) | CONTRATISTA · PROYECTO · TEAM · TOTAL · DESCUENTOS · TOTAL INVOICE · TOTAL CONSIGNAR |
| 86–97 | **Adelantos / financiación** | + TOTAL X PERSONA · ADELANTOS · MENOS 30 |
| 102–122 | **INFRACORE** — nómina BlowFiber y pendientes | CONTRATISTA · PROYECTO · DAYS · WEEK · TOTAL · DESCUENTOS · TOTAL CONSIGNAR |

**El layout cambia entre semanas**: las semanas 1–21 tienen 20 columnas; las 22–29 tienen 15.
Las filas de cada bloque se desplazan semana a semana (el bloque de contratistas empieza
en fila 6 en unas y en fila 5 en otras; los totales están en filas distintas).
**No es una tabla: es un documento libre. No se puede importar automáticamente sin mapeo
semana por semana.**

### 3.2 Lógica financiera detectada (week 29)

```
H7  = H6 - G6 - F6        TOTAL INVOICE − DESCUENTOS − ADELANTOS
I24 = H24 * 2%            COMI JRC = 2 % del invoice
J6  = I6                  a consignar = la comisión
L8  = J8 - 30             a consignar Skyline = neto − 30   ← ¿costo de transferencia?
H43 = H14+H27+H30+H33+H6  suma de invoices por cliente
H44 = H14+H27+H30+H33+H7+H38   "TOTAL DINERO QUE ENTRO"
J97 = H84+H65+H54+J44+L44+K44+H74+J93   "TOTAL DINERO QUE SALE DE CAJA"
```

Elementos identificados:

- **Comisión JRC = 2 % del invoice**, pero solo se aplica con fórmula en algunas filas
  (K2C, Theo, Infracore, GTS) y **no** en otras (Bigham-Dublin, Precision).
  **NEEDS BUSINESS CONFIRMATION.**
- **"Descuento Pronto Pago"**: el cliente descuenta ~1,09 % del invoice
  (ej. 401,60 sobre 36.928,23). Aparece en `DESCUENTOS` mezclado con descuentos a
  contratistas. Son cosas distintas: uno reduce el ingreso, otro reduce lo que se paga.
- **`-30` fijo** restado a consignaciones (`L8 = J8-30`). Costo bancario presumido.
- **Infracore dentro del mismo libro** (filas 102–122), con tarifas
  `$400 DAY RATE / $440 NIGHT RATE` en NOVASITE LLC, y renta de carro con tarjeta de
  Novasite prestada a Infracore (813,95, *"Return 8/12/2026"*).
- **Variance visible sin resolver**: `J116 = I116 - H116 = 495,77` — diferencia entre
  la venta (5.843,95) y lo consignado (5.348,18), anotada y nunca cerrada.

### 3.3 🔴 Fórmulas rotas y señales de peligro

| Celda | Problema |
|---|---|
| `week 23!J9 = E77` | Referencia a la fila 77 (otro bloque, "Pendientes") desde el bloque de contratistas. **Casi con seguridad un arrastre erróneo.** |
| `week 14!M7 = ` | Fórmula vacía |
| `H15 = H14 - G14 + F14` vs `H7 = H6 - G6 - F6` | **El signo de ADELANTOS cambia de bloque a bloque y de semana a semana.** En unas se resta, en otras se suma. |
| `G6 = 338.34 + 475` / `G6 = 290.09 + 3000` | Varios conceptos sumados dentro de una sola celda. Se pierde el detalle. |
| Estados en texto | `YA SE PAGO`, `PDT POR DEFINIR DE QUE SON`, `Ya se adelanto`, `SIN IDENTIFICAR ( PERO FACT CUADRAN)` — el estado de pago es **un comentario**, no un dato. |
| `B10 = X`, `B22 = EXTRA`, `B12 = PROVECION` | Contratistas sin identificar recibiendo montos (ej. 3.646,76 y 239,70 "sin identificar"). |

### 3.4 Hoja `descuentos`

Tres controles independientes pegados lado a lado:

- **B:G — Deuda de Jairo Mejía.** Registro por cheque: `CHEQUE | WEEK | CONTRATISTA |
  CONCEPTO | VALOR | TOTAL`. Conceptos: CASH 5.000, HOTEL WEEK 18 CUARTO 1/2/3 (483 c/u),
  ADELANTO 10.000, 12.000, 5.000. Los saldos se recalculan a mano en celdas sueltas
  (`G25 = G19-G24`, `G27 = G25+G26`) y el corte se marca con una fila de texto:
  *"DESCONTADO HASTA AQUI PA ARRIBA"*. Saldo llegó a 19.602,93.
- **J:L — Cartera** por radicado: `RESUMEN | DIAS EN CARTERA | VALOR` (1004647600 · 21 días
  · 1.445,20 …). Total 13.149,60.
- **N:S — Deuda de Paco.** `CHEQUE | WEEK | CONTRATISTA | CONCEPTO | VALOR | TOTAL` con
  abonos encadenados: 3.890 → 2.700,56 → 1.350,56 → 0. Incluye
  *"se le regala 1 semana de renta"* (condonación sin aprobación registrada).

**Riesgo:** los saldos de deuda son celdas calculadas a mano. Si alguien inserta una fila,
el saldo cambia y **no queda rastro**.

---

## 4. Hallazgos críticos consolidados

| # | Hallazgo | Impacto | Evidencia |
|---|---|---|---|
| C1 | Fila "Total" dentro de la tabla de Infracore | Costo reportado al **doble** (242.992 vs 121.496) | BASE fila 863 |
| C2 | 448 días `(persona, fecha)` en ambos libros | Doble pago o pago omitido | cruce Skyline↔Infracore |
| C3 | `VLOOKUP` de tarifas siempre contra la lista Aéreo | Días pagados en **$0** sin aviso | `Valor Día` col. K |
| C4 | Identidad rota por sufijos (`1`, `-N`, `-2`, `-UG`) | Imposible reportar por persona; historial de tarifa inexistente | `Listas` |
| C5 | Signo de ADELANTOS inconsistente (`-F` vs `+F`) | Adelantos sumados en vez de restados | FORMATO COMIS, varias semanas |
| C6 | Estado de pago como texto libre | No se sabe qué está pagado | `YA SE PAGO` |
| C7 | 31 duplicados internos exactos | Doble pago | 16 Skyline + 15 Infracore |
| C8 | Personas, cuadrillas y equipos en la misma lista | Costo laboral mezclado con costo de equipo | `Listas` |
| C9 | `EMPRESA` = cliente, no compañía legal | Contabilidad entre Skyline e Infracore sin separar | col. T / V |
| C10 | Sin control de acceso, sin aprobación, sin auditoría | Cualquiera cambia cualquier monto sin rastro | los 3 libros |
| C11 | Fórmulas con `TODAY()` | El archivo cambia solo con abrirlo | cols. X–Z |
| C12 | 5 copias del archivo Infracore + archivo de bloqueo | No se sabe cuál es la versión buena | carpetas |
| C13 | Variance de 495,77 anotada y nunca cerrada | Diferencias que se pierden | week 29 J116 |
| C14 | Montos "SIN IDENTIFICAR" pagados (3.646,76) | Salida de caja sin respaldo | week 14 |

---

## 5. Ambigüedades — NEEDS BUSINESS CONFIRMATION

Cada una puede cambiar cuánto recibe una persona. **No se asume ninguna.**
Todas se implementan como parámetro configurable con valor por defecto explícito.

| ID | Pregunta | Por qué importa |
|---|---|---|
| A1 | ¿`-N` significa turno nocturno? ¿`-2` es tarifa revisada? | Define si son la misma persona con 2 tarifas o 2 registros |
| A2 | ¿La comisión JRC de 2 % aplica a todos los clientes o solo a algunos? | Solo está en fórmula en 4 de ~10 clientes |
| A3 | El `-30` restado a las consignaciones, ¿qué es? ¿Se le descuenta al trabajador o lo asume la compañía? | Cambia el neto del trabajador |
| A4 | El "descuento pronto pago" del cliente, ¿se traslada al contratista o lo absorbe la compañía? | Hoy va mezclado en la misma columna |
| A5 | Adelantos: ¿se **suman** o se **restan** del invoice? | En los Excel aparece de las dos formas |
| A6 | De los 448 días duplicados, ¿cuál libro manda? | Define si hubo doble pago histórico |
| A7 | ¿Un descuento a un contratista se reparte entre sus trabajadores? | El enunciado dice que **no** automáticamente; se necesita la regla explícita |
| A8 | Medio día = exactamente 0,5 × tarifa. ¿Se confirma? ¿Hay mínimo garantizado? | Afecta 453 registros |
| A9 | ¿Existe recargo por horas extra, festivo o nocturnidad además de la tarifa diaria? | Hoy no existe en el modelo |
| A10 | Días con pago negativo (mín. −127,59): ¿se permiten o el descuento pasa a la semana siguiente? | Define el comportamiento del motor |
| A11 | Cuando Infracore factura a Skyline Advance Tech, ¿es venta real entre compañías? | Afecta el dashboard consolidado |
| A12 | ¿Qué semana rige? Excel usa `WEEKNUM` (domingo–sábado, sistema US) | Define el corte de nómina |
| A13 | Condonaciones tipo *"se le regala 1 semana de renta"*: ¿quién las autoriza? | Hoy nadie las aprueba |
| A14 | Equipos (CAPSTAN, PLOW, camión): ¿su "tarifa día" es costo interno o se le paga a alguien? | Separa costo de equipo de costo laboral |
| A15 | `NO WORK` y `WAITING PROYECT`: ¿se pagan? Hay 763 registros | Afecta costo |

---

## 6. Qué se migra y qué no

### Se migra (Phase 1 — catálogos)

| Origen | Destino | Registros | Nota |
|---|---|---|---|
| `Listas` J/N/R/F (trabajadores) | `Worker` + `WorkerRate` | ~118 → **~90 personas reales** tras unificar sufijos | requiere revisión humana de los alias |
| Nombres que son máquinas | `Equipment` | ~8 | CAPSTAN, PLOW-Rent, COMPRESOR, TORNADO, INTERNACIONAL 2014, MINI ESCAVADORA |
| Nombres que son cuadrillas | `Crew` | ~12 | MISSILES, AMPARO, CHATO, CUBO, DINO, HERBY, MATEO, PALMICHE, CACIQUE, CAMION, ADMIN, DIRECCIONAL DRILL |
| `Listas` Z:AB (`PROYECTOS`) | `Project` + `Customer` | 24 proyectos / 13 clientes | normalizando TUSCALOOSA y SKYLINE ADMIN |
| `Listas` V (`ADICIONALES`) | `AdditionCategory` | 4 | |
| `Listas` X (`ITEAMS`) | `WorkDayReason` | ~9 | |
| Tarifas por operación | `RateHistory` | ~118 | con `effectiveFrom` a confirmar |

### Se migra (Phase 2 — histórico)

| Origen | Destino | Registros | Nota |
|---|---|---|---|
| `BASE` Skyline (con nombre y fecha) | `WorkEntry` | 19.411 | año 2024–2026; excluir las 6.854 vacías |
| `BASE` Infracore | `WorkEntry` | 854 | **excluir fila 863 (Total)** |
| Descuentos con observación | `Deduction` | 161 | categorizar los 264 textos libres a mano |
| Adicionales | `Addition` | 414 | |
| `descuentos!B:G` (Jairo) | `Debt` + `DebtTransaction` | ~20 movimientos | |
| `descuentos!N:S` (Paco) | `Debt` + `DebtTransaction` | ~8 movimientos | |
| `descuentos!J:L` (cartera) | `Receivable` | 3 radicados | |
| `FEDE Deuda` | `Debt` + `DebtTransaction` | ~28 semanas | hoja oculta |

### NO se migra

- Las 4 hojas de tablas dinámicas (`DH *`, `herby y dino`) — se regeneran como reportes.
- `Dinamicas`, `INFORME`, `LISTADO` — obsoletas o vacías.
- Columnas `DÍAS DEL AÑO`, `% DÍAS ACTIVOS`, `HORAS`, `Mes`, `Día semana`, `AÑO`,
  `Columna1`, `NOMBRES UNICOS` — todas derivadas; se calculan.
- Las hojas semanales de `FORMATO COMIS` **no se importan automáticamente**: el layout
  cambia por semana. Se cargan con el Import Wizard, semana por semana, con revisión
  humana y detección de excepciones (Phase 2).
- La fila 863 de Infracore (`Total`) — es un artefacto, no un dato.

### Regla de migración

Ningún dato histórico entra al sistema con estado `PAID` automáticamente. Todo lo
importado llega como `IMPORTED_HISTORICAL`, marcado, y solo un aprobador puede
reconciliarlo. **La migración no puede crear pagos.**
