import Link from 'next/link'
import { EmptyState, PageHeader, Stat, money } from '@/components/ui'
import { assertCan } from '@/lib/auth/rbac'
import { getActiveCompany } from '@/lib/company/context'
import { prisma } from '@/lib/db/client'
import {
  DIA_ETIQUETA,
  ESTADO_BASE,
  TIPO_ETIQUETA,
  TONO_ESTADO,
  totalizarBase,
} from '@/lib/payroll/base'
import { TOPE, baseDeDatos, semanaPorDefecto, semanasDeLaBase } from '@/lib/payroll/base/service'

export const dynamic = 'force-dynamic'

/**
 * La BASE: todo lo capturado, un renglón por día.
 *
 * El negocio la pidió como su hoja de Excel de siempre pero legible: semana,
 * persona, día, si trabajó, tarifa y proyecto, con filtros para revisar lo que
 * se capturó en semanas anteriores sin abrir semana por semana.
 *
 * Por defecto muestra **la semana más reciente**, y el selector va de la más
 * nueva a la más vieja — tal como se pidió: «lo primero que veo es week 33 y
 * lo último week 1».
 */
export default async function BasePage({
  searchParams,
}: {
  searchParams: Promise<{
    semana?: string
    persona?: string
    proyecto?: string
    tipo?: string
    dia?: string
    estado?: string
    q?: string
    archivo?: string
    pagina?: string
  }>
}) {
  await assertCan('payroll:view')
  const company = await getActiveCompany()
  const f = await searchParams

  const semanas = await semanasDeLaBase(company.id)
  // Sin elección previa, la semana donde está el trabajo.
  const semanaActiva = f.semana ?? (await semanaPorDefecto(company.id)) ?? 'todas'

  // Página pedida. Una basura en la dirección vuelve a la primera.
  const pagina = Math.max(1, Number.parseInt(f.pagina ?? '1', 10) || 1)

  const [{ rows, hayMas }, personas, proyectos] = await Promise.all([
    baseDeDatos(
      company.id,
      {
        week: semanaActiva,
        tipo: f.tipo || null,
        worker: f.persona || null,
        project: f.proyecto || null,
        dayType: f.dia || null,
        estado: f.estado || null,
        q: f.q || null,
        incluirArchivo: f.archivo === '1',
      },
      TOPE,
      pagina,
    ),
    prisma.worker.findMany({
      where: { companyId: company.id },
      orderBy: { displayName: 'asc' },
      select: { id: true, displayName: true, status: true },
    }),
    prisma.project.findMany({
      where: { companyId: company.id },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    }),
  ])

  const totales = totalizarBase(rows)
  const semanaElegida = semanas.find((s) => s.id === semanaActiva)

  /** El mismo filtro, otra página: cambiar de hoja no puede perder la vista. */
  const enlacePagina = (n: number) => {
    const p = new URLSearchParams()
    for (const [k, v] of Object.entries({
      semana: semanaActiva,
      tipo: f.tipo,
      persona: f.persona,
      proyecto: f.proyecto,
      dia: f.dia,
      estado: f.estado,
      q: f.q,
      archivo: f.archivo,
    })) {
      if (v) p.set(k, v)
    }
    if (n > 1) p.set('pagina', String(n))
    return `/base?${p.toString()}`
  }

  const SELECT =
    'h-9 w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-2 text-sm'

  return (
    <>
      <PageHeader
        title="Base"
        subtitle={`${company.displayName} · todo lo capturado, un renglón por día`}
        action={
          rows.length > 0 ? (
            <a
              href={`/base/csv?${new URLSearchParams(
                Object.entries({
                  semana: semanaActiva,
                  persona: f.persona ?? '',
                  proyecto: f.proyecto ?? '',
                  tipo: f.tipo ?? '',
                  dia: f.dia ?? '',
                  estado: f.estado ?? '',
                  q: f.q ?? '',
                  archivo: f.archivo ?? '',
                }).filter(([, v]) => v) as [string, string][],
              ).toString()}`}
              className="inline-flex h-9 items-center rounded-full border border-[var(--border)] px-4 text-sm hover:bg-[var(--hover)]"
            >
              Bajar a Excel
            </a>
          ) : null
        }
      />

      {/* Filtros. Van en la dirección para poder guardar o compartir una vista. */}
      <form className="mb-5 grid gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3.5 sm:grid-cols-2 lg:grid-cols-5">
        <label className="text-sm">
          <span className="mb-1 block text-[var(--muted)]">Semana</span>
          <select name="semana" defaultValue={semanaActiva} className={SELECT}>
            <option value="todas">Todas las semanas</option>
            {semanas.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label} · {s.year} ({s.dias} días){s.soloArchivo ? ' · archivo' : ''}
              </option>
            ))}
          </select>
        </label>

        <label className="text-sm">
          <span className="mb-1 block text-[var(--muted)]">Qué</span>
          <select name="tipo" defaultValue={f.tipo ?? ''} className={SELECT}>
            <option value="">Todo</option>
            {Object.entries(TIPO_ETIQUETA).map(([code, etiqueta]) => (
              <option key={code} value={code}>
                {etiqueta}
              </option>
            ))}
          </select>
        </label>

        <label className="text-sm">
          <span className="mb-1 block text-[var(--muted)]">Trabajador</span>
          <select name="persona" defaultValue={f.persona ?? ''} className={SELECT}>
            <option value="">Todos</option>
            {personas.map((p) => (
              <option key={p.id} value={p.id}>
                {p.displayName}
                {p.status !== 'ACTIVE' ? ' (fuera de las listas)' : ''}
              </option>
            ))}
          </select>
        </label>

        <label className="text-sm">
          <span className="mb-1 block text-[var(--muted)]">Proyecto</span>
          <select name="proyecto" defaultValue={f.proyecto ?? ''} className={SELECT}>
            <option value="">Todos</option>
            {proyectos.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>

        <label className="text-sm">
          <span className="mb-1 block text-[var(--muted)]">Trabajó</span>
          <select name="dia" defaultValue={f.dia ?? ''} className={SELECT}>
            <option value="">Todos</option>
            {Object.entries(DIA_ETIQUETA).map(([code, etiqueta]) => (
              <option key={code} value={code}>
                {etiqueta}
              </option>
            ))}
          </select>
        </label>

        <label className="text-sm">
          <span className="mb-1 block text-[var(--muted)]">Estado</span>
          <select name="estado" defaultValue={f.estado ?? ''} className={SELECT}>
            <option value="">Todos</option>
            {Object.entries(ESTADO_BASE).map(([code, etiqueta]) => (
              <option key={code} value={code}>
                {etiqueta}
              </option>
            ))}
          </select>
        </label>

        <label className="text-sm">
          <span className="mb-1 block text-[var(--muted)]">Buscar</span>
          <input
            name="q"
            defaultValue={f.q ?? ''}
            placeholder="nombre o proyecto"
            className="h-9 w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 text-sm"
          />
        </label>

        <label className="flex items-center gap-2 text-sm sm:col-span-2">
          <input
            type="checkbox"
            name="archivo"
            value="1"
            defaultChecked={f.archivo === '1'}
            className="h-4 w-4"
          />
          <span>
            Incluir los días que vinieron del Excel
            <span className="ml-1 text-xs text-[var(--muted)]">— archivo, ya pagados por fuera</span>
          </span>
        </label>

        <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-3">
          <button
            type="submit"
            className="brand-gradient inline-flex h-9 items-center rounded-full px-4 text-sm font-medium text-white shadow-sm hover:opacity-90"
          >
            Filtrar
          </button>
          <Link
            prefetch={false}
            href="/base"
            className="inline-flex h-9 items-center rounded-full border border-[var(--border)] px-4 text-sm hover:bg-[var(--hover)]"
          >
            Limpiar
          </Link>
        </div>
      </form>

      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Renglones"
          value={String(totales.registros)}
          hint={semanaElegida ? `${semanaElegida.label} · ${semanaElegida.year}` : 'todas las semanas'}
        />
        <Stat label="Días que pagan" value={totales.diasPagados} hint="completo = 1 · medio = ½" />
        <Stat label="Personas" value={String(totales.personas)} hint="distintas en la vista" />
        <Stat label="Proyectos" value={String(totales.proyectos)} hint="distintos en la vista" />
      </div>


      {rows.length === 0 ? (
        <EmptyState
          title="No hay días capturados con esos filtros"
          hint="Cambia la semana o limpia el filtro. Los días del Excel solo salen si marcas la casilla."
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-[var(--border)] bg-[var(--surface)]">
          <table className="w-full border-collapse text-sm">
            {/* La cabecera se queda pegada arriba: en 500 filas uno pierde de
                vista qué columna es cuál. */}
            <thead className="sticky top-0 z-10 bg-[var(--hover)]">
              <tr>
                {[
                  'Semana',
                  'Fecha',
                  'Día',
                  'Qué',
                  'Nombre',
                  'Trabajó',
                  'Detalle',
                  'Tarifa',
                  'Vale el día',
                  'Estado',
                  'Se le paga a',
                  'Proyecto',
                ].map((h, i) => (
                  <th
                    key={h}
                    className={`whitespace-nowrap px-3 py-2.5 text-xs font-semibold uppercase tracking-wide text-[var(--muted)] ${
                      i === 7 || i === 8 ? 'text-right' : 'text-left'
                    }`}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.id}
                  className={`border-t border-[var(--border)] ${
                    r.fromImport ? 'bg-[var(--bg)] text-[var(--muted)]' : ''
                  }`}
                >
                  <td className="whitespace-nowrap px-3 py-2">
                    {r.weekLabel} · {r.weekYear}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 tabular-nums">{r.workDate}</td>
                  <td className="px-3 py-2">{r.dayName}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-xs text-[var(--muted)]">
                    {TIPO_ETIQUETA[r.tipo]}
                  </td>
                  <td className="px-3 py-2 font-medium">
                    {r.workerName}
                    {r.isControlOnly ? (
                      <span
                        className="ml-2 text-xs font-normal text-[var(--muted)]"
                        title="Día de control de cuadrilla: se anota, no genera pago individual"
                      >
                        control
                      </span>
                    ) : null}
                    {r.fromImport ? (
                      <span className="ml-2 text-xs font-normal">del Excel</span>
                    ) : null}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">
                    {DIA_ETIQUETA[r.dayType] ?? r.dayType}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-xs text-[var(--muted)]">
                    {r.detalle ?? ''}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {r.rate ? `$${money(r.rate)}` : <span className="text-[var(--muted)]">—</span>}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {r.amount ? (
                      `$${money(r.amount)}`
                    ) : r.dayType === 'NO_WORK' ? (
                      /*
                       * Un día que no se trabajó no se paga NUNCA. Decir «sin
                       * calcular» ahí hace creer que falta un paso y que la
                       * cifra va a aparecer después.
                       */
                      <span className="text-[var(--muted)]">no aplica</span>
                    ) : r.isControlOnly ? (
                      <span className="text-[var(--muted)]" title="Los días de control anotan, no pagan">
                        no paga
                      </span>
                    ) : (
                      <span className="text-[var(--muted)]" title="Todavía sin calcular">
                        sin calcular
                      </span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        TONO_ESTADO[r.estado] === 'good'
                          ? 'bg-emerald-100 text-emerald-900'
                          : TONO_ESTADO[r.estado] === 'warning'
                            ? 'bg-amber-100 text-amber-900'
                            : TONO_ESTADO[r.estado] === 'info'
                              ? 'bg-sky-100 text-sky-900'
                              : 'bg-[var(--hover)] text-[var(--muted)]'
                      }`}
                    >
                      {ESTADO_BASE[r.estado]}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {r.payeeName ?? <span className="text-[var(--muted)]">—</span>}
                  </td>
                  <td className="px-3 py-2">
                    {r.projectName ?? <span className="text-[var(--muted)]">sin proyecto</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/*
        Pasar de página.
        Antes la pantalla cortaba en 800 y avisaba, pero no había cómo ver las
        siguientes: para revisar tres semanas seguidas uno se quedaba ciego.
      */}
      {rows.length > 0 && (hayMas || pagina > 1) ? (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm">
          <span className="text-[var(--muted)]">
            Página <strong>{pagina}</strong> · renglones {(pagina - 1) * TOPE + 1} a{' '}
            {(pagina - 1) * TOPE + rows.length}
          </span>
          <div className="flex gap-2">
            {pagina > 1 ? (
              <Link
                prefetch={false}
                href={enlacePagina(pagina - 1)}
                className="inline-flex h-9 items-center rounded-full border border-[var(--border)] px-4 hover:bg-[var(--hover)]"
              >
                ← Anteriores
              </Link>
            ) : (
              <span className="inline-flex h-9 items-center rounded-full border border-[var(--border)] px-4 text-[var(--muted)] opacity-45">
                ← Anteriores
              </span>
            )}
            {hayMas ? (
              <Link
                prefetch={false}
                href={enlacePagina(pagina + 1)}
                className="inline-flex h-9 items-center rounded-full border border-[var(--border)] px-4 hover:bg-[var(--hover)]"
              >
                Más antiguos →
              </Link>
            ) : (
              <span className="inline-flex h-9 items-center rounded-full border border-[var(--border)] px-4 text-[var(--muted)] opacity-45">
                Más antiguos →
              </span>
            )}
          </div>
        </div>
      ) : null}

      <p className="mt-4 text-xs text-[var(--muted)]">
        <strong>Vale el día</strong> es lo que genera ESE día —tarifa × jornada: un día completo a
        $190 vale $190, medio día vale $95—. Si el dinero ya salió del banco lo dice la columna{' '}
        <strong>Estado</strong>. La tarifa queda congelada el día que se calcula: enseñar la de hoy
        haría creer que se pagó algo que nunca se pagó.
      </p>
    </>
  )
}
