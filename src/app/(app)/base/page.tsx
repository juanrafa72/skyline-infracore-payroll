import Link from 'next/link'
import { EmptyState, PageHeader, Stat, money } from '@/components/ui'
import { assertCan } from '@/lib/auth/rbac'
import { getActiveCompany } from '@/lib/company/context'
import { prisma } from '@/lib/db/client'
import { DIA_ETIQUETA, totalizarBase } from '@/lib/payroll/base'
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
    dia?: string
    q?: string
    archivo?: string
  }>
}) {
  await assertCan('payroll:view')
  const company = await getActiveCompany()
  const f = await searchParams

  const semanas = await semanasDeLaBase(company.id)
  // Sin elección previa, la semana donde está el trabajo.
  const semanaActiva = f.semana ?? (await semanaPorDefecto(company.id)) ?? 'todas'

  const [{ rows, truncado }, personas, proyectos] = await Promise.all([
    baseDeDatos(company.id, {
      week: semanaActiva,
      worker: f.persona || null,
      project: f.proyecto || null,
      dayType: f.dia || null,
      q: f.q || null,
      incluirArchivo: f.archivo === '1',
    }),
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
                  dia: f.dia ?? '',
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

      {truncado ? (
        <p className="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          Se están mostrando los primeros <strong>{TOPE}</strong> renglones. Hay más: filtra por
          semana o por persona, o baja el archivo a Excel: ahí van todos.
        </p>
      ) : null}

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
                  'Trabajador',
                  'Trabajó',
                  'Tarifa',
                  'Se pagó',
                  'Proyecto',
                  'Cuadrilla',
                ].map((h, i) => (
                  <th
                    key={h}
                    className={`whitespace-nowrap px-3 py-2.5 text-xs font-semibold uppercase tracking-wide text-[var(--muted)] ${
                      i === 5 || i === 6 ? 'text-right' : 'text-left'
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
                  <td className="px-3 py-2">
                    {r.projectName ?? <span className="text-[var(--muted)]">sin proyecto</span>}
                  </td>
                  <td className="px-3 py-2">{r.crewName ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-4 text-xs text-[var(--muted)]">
        La tarifa y lo pagado salen del cálculo, congelados el día que se hizo. Un día todavía sin
        calcular no muestra tarifa: enseñar la de hoy haría creer que se pagó algo que nunca se
        pagó.
      </p>
    </>
  )
}
