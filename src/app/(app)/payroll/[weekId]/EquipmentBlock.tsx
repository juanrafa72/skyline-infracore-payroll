'use client'

import Link from 'next/link'
import { useMemo, useState, useTransition } from 'react'
import { useActionState } from 'react'
import { agruparProyectos } from '@/lib/payroll/project-order'
import { saveEquipmentWeekDays, toggleEquipoEnSemana } from '../actions'

export interface EquipmentRow {
  equipmentId: string
  name: string
  kindLabel: string
  /** RENTED = se le paga al proveedor · OWNED = costo interno, no se paga. */
  ownership: 'RENTED' | 'OWNED'
  dailyCost: string | null
  vendorName: string | null
  hasVendor: boolean
  payable: { total: string; days: number; statusLabel: string } | null
  markedDays: ReadonlyArray<string>
  /** A qué proyecto se le carga, hoy. */
  projectId: string | null
  /** Está en ESTA semana. Los que no, solo salen en «Todos». */
  enLaSemana: boolean
}

export interface ProjectOption {
  id: string
  name: string
}

type Filtro = 'ACTIVOS' | 'TODOS' | 'RENTED' | 'OWNED'

/*
 * «Activos» son los que están en obra ESTA semana —rentados y propios juntos—
 * y es donde se marcan los días, igual que la rejilla de la gente. Rentados y
 * Propios son el mismo grupo, partido, para cuando se quiere mirar solo uno.
 * «Todos» es el catálogo completo: ahí se activan y se desactivan.
 */
const FILTROS: ReadonlyArray<{ value: Filtro; label: string }> = [
  { value: 'ACTIVOS', label: 'Activos' },
  { value: 'RENTED', label: 'Rentados' },
  { value: 'OWNED', label: 'Propios' },
  { value: 'TODOS', label: 'Todos' },
]

/**
 * Sacar un equipo de la semana desde la rejilla.
 *
 * SIN formulario propio: vive dentro del formulario de los días, y un <form>
 * dentro de otro es HTML inválido — el navegador descarta el de adentro y el
 * botón termina guardando los días. Misma solución que en la rejilla de gente.
 */
function QuitarEquipo({
  weekId,
  row,
}: {
  weekId: string
  row: EquipmentRow
}) {
  const [pending, startTransition] = useTransition()
  const [mensaje, setMensaje] = useState<string | null>(null)

  return (
    <div className="text-right">
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          setMensaje(null)
          const datos = new FormData()
          datos.set('weekId', weekId)
          datos.set('equipmentId', row.equipmentId)
          startTransition(async () => {
            const resultado = await toggleEquipoEnSemana(null, datos)
            if (!resultado.startsWith('LISTO|')) setMensaje(resultado)
          })
        }}
        title={`Saca ${row.name} de esta semana. Sigue en el catálogo.`}
        className="rounded px-2 py-1 text-[11px] text-[var(--muted)] hover:bg-[var(--hover)] disabled:opacity-45"
      >
        {pending ? '…' : 'quitar'}
      </button>
      {mensaje ? <p className="mt-0.5 text-[11px] text-amber-800">{mensaje}</p> : null}
    </div>
  )
}

/** El botón que mete o saca un equipo de la semana. */
function EnLaSemana({ weekId, row }: { weekId: string; row: EquipmentRow }) {
  const [result, action, saving] = useActionState(toggleEquipoEnSemana, null)
  const problema = result !== null && !result.startsWith('LISTO|')

  return (
    <div>
      <form action={action}>
        <input type="hidden" name="weekId" value={weekId} />
        <input type="hidden" name="equipmentId" value={row.equipmentId} />
        <button
          type="submit"
          disabled={saving}
          aria-pressed={row.enLaSemana}
          className={`inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition disabled:opacity-45 ${
            row.enLaSemana
              ? 'border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100'
              : 'border-[var(--border)] hover:bg-[var(--hover)]'
          }`}
          title={
            row.enLaSemana
              ? `${row.name} está en esta semana. Oprime para sacarlo (no se puede si ya tiene días o liquidación).`
              : `Mete ${row.name} en esta semana para poder marcarle días.`
          }
        >
          {saving ? '…' : row.enLaSemana ? '✓ En la semana' : '+ Agregar'}
        </button>
      </form>
      {problema ? <p className="mt-1 text-xs text-amber-800">{result}</p> : null}
    </div>
  )
}

function currency(value: string): string {
  return Number(value).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

/**
 * Equipos de la semana: qué máquina estuvo en obra, en qué proyecto, y cuánto
 * se le paga a su proveedor.
 *
 * Se ven los RENTADOS y los PROPIOS, con un filtro para separarlos, porque el
 * negocio decide semana a semana cuál estuvo trabajando. La diferencia no es
 * si se marcan días —ambos se marcan— sino a quién se le paga: el rentado
 * genera liquidación para su PROVEEDOR (BR-121); el propio ya es nuestro y no
 * le debe nada a nadie, así que solo deja constancia de dónde estuvo.
 *
 * El alquiler se paga POR DÍA y se le carga a un PROYECTO: sin proyecto no se
 * sabe a qué obra cargarle el costo — el mismo hueco que dejaba el margen
 * incompleto en los días de la gente.
 */
export function EquipmentBlock({
  weekId,
  shortDays,
  rows,
  projects,
  projectsInUse = [],
}: {
  weekId: string
  shortDays: ReadonlyArray<{ iso: string; label: string }>
  rows: readonly EquipmentRow[]
  projects: readonly ProjectOption[]
  /** Proyectos que ya aparecen en la semana: van arriba en el selector. */
  projectsInUse?: readonly string[]
}) {
  const [result, action, saving] = useActionState(saveEquipmentWeekDays, null)
  const ok = result !== null && result.startsWith('LISTO|')

  /*
   * Abre en RENTADOS, que es lo que se paga.
   *
   * Con «Todos» de entrada, una semana normal obliga a pasar por encima de
   * siete máquinas propias —que no le deben nada a nadie— antes de llegar a la
   * que sí genera una transferencia. Salvo que no haya ningún rentado: ahí
   * mostrar una lista vacía sería peor.
   */
  const hayEnLaSemana = rows.some((row) => row.enLaSemana)
  /*
   * Abre en «Activos»: es donde se trabaja. Si la semana todavía no tiene
   * ninguno, abre en «Todos», que es donde se activan — mostrar una lista
   * vacía sin decir dónde está el botón fue lo que dejó al negocio sin salida.
   */
  const [filtro, setFiltro] = useState<Filtro>(hayEnLaSemana ? 'ACTIVOS' : 'TODOS')

  const visibles = useMemo(
    () =>
      filtro === 'TODOS'
        ? rows
        : filtro === 'ACTIVOS'
          ? rows.filter((row) => row.enLaSemana)
          : rows.filter((row) => row.ownership === filtro && row.enLaSemana),
    [rows, filtro],
  )

  const cuenta = useMemo(
    () => ({
      activos: rows.filter((r) => r.enLaSemana).length,
      rentados: rows.filter((r) => r.ownership === 'RENTED' && r.enLaSemana).length,
      propios: rows.filter((r) => r.ownership === 'OWNED' && r.enLaSemana).length,
      todos: rows.length,
    }),
    [rows],
  )

  // Los proyectos de la semana, arriba: son 21 y el selector sale en cada fila.
  const grupos = useMemo(
    () => agruparProyectos(projects, projectsInUse),
    [projects, projectsInUse],
  )

  return (
    <section className="mb-6 rounded-lg border border-[var(--border)] bg-[var(--surface)]">
      <div className="border-b border-[var(--border)] p-3.5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">Equipos de la semana</h2>
            <p className="mt-0.5 text-xs text-[var(--muted)]">
              Día marcado = día que estuvo en obra. El <strong>rentado</strong> se paga por día a
              su proveedor; el <strong>propio</strong> solo deja constancia de dónde estuvo.{' '}
              <Link prefetch={false} href="/equipment" className="text-[var(--accent)] underline">
                Administrar equipos
              </Link>
            </p>
          </div>

          {/* Propio o rentado: el negocio lo pidió como lo primero que se elige. */}
          <div className="flex rounded-full border border-[var(--border)] p-0.5 text-xs">
            {FILTROS.map((opcion) => (
              <button
                key={opcion.value}
                type="button"
                onClick={() => setFiltro(opcion.value)}
                className={`rounded-full px-3 py-1 transition ${
                  filtro === opcion.value
                    ? 'bg-[var(--accent)] font-medium text-white'
                    : 'hover:bg-[var(--hover)]'
                }`}
              >
                {opcion.label}
                {opcion.value === 'ACTIVOS' ? ` (${cuenta.activos})` : null}
                {opcion.value === 'RENTED' ? ` (${cuenta.rentados})` : null}
                {opcion.value === 'OWNED' ? ` (${cuenta.propios})` : null}
                {opcion.value === 'TODOS' ? ` (${cuenta.todos})` : null}
              </button>
            ))}
          </div>
        </div>
      </div>

      {result ? (
        <p
          className={`mx-3.5 mt-3 rounded-md border p-2.5 text-sm ${
            ok
              ? 'border-emerald-300 bg-emerald-50 text-emerald-900'
              : 'border-amber-300 bg-amber-50 text-amber-900'
          }`}
        >
          {result.replace(/^LISTO\|/, '')}
        </p>
      ) : null}

      {/*
        «Todos» es la pantalla de ADMINISTRAR: se agregan y se sacan de la
        semana. Va fuera del formulario de días a propósito — un <form> dentro
        de otro es HTML inválido: el navegador descarta el de adentro y su
        botón termina guardando los días en vez de agregar el equipo.
      */}
      {/*
        La misma barra que tiene la rejilla de gente: cuántos hay y por dónde se
        agregan. Sin ella, «Todos» era la única puerta y no se veía desde aquí.
      */}
      {filtro !== 'TODOS' ? (
        <div className="mx-3.5 mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-[var(--hover)] px-3 py-2">
          <span className="text-sm">
            <strong>
              {filtro === 'ACTIVOS'
                ? cuenta.activos
                : filtro === 'RENTED'
                  ? cuenta.rentados
                  : cuenta.propios}
            </strong>{' '}
            equipo(s){' '}
            {filtro === 'ACTIVOS' ? 'en obra' : filtro === 'RENTED' ? 'rentado(s)' : 'propio(s)'} en
            esta semana
          </span>
          <button
            type="button"
            onClick={() => setFiltro('TODOS')}
            className="rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
          >
            + Agregar equipos
          </button>
        </div>
      ) : null}

      {filtro === 'TODOS' ? (
        <div className="p-3.5">
          <p className="mb-3 text-xs text-[var(--muted)]">
            Marca aquí qué equipos estuvieron en obra esta semana. Los días se marcan en{' '}
            <strong>Rentados</strong> y <strong>Propios</strong>.
          </p>

          {rows.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">
              No hay equipos en el catálogo.{' '}
              <Link prefetch={false} href="/equipment" className="text-[var(--accent)] underline">
                Se crean en Catálogos → Equipos
              </Link>
              .
            </p>
          ) : (
            <ul className="divide-y divide-[var(--border)] rounded-lg border border-[var(--border)]">
              {rows.map((row) => (
                <li
                  key={row.equipmentId}
                  className="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
                >
                  <span className="text-sm">
                    <strong className="font-medium">{row.name}</strong>
                    <span
                      className={`ml-2 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                        row.ownership === 'RENTED'
                          ? 'bg-amber-100 text-amber-900'
                          : 'bg-[var(--hover)] text-[var(--muted)]'
                      }`}
                    >
                      {row.ownership === 'RENTED' ? 'rentado' : 'propio'}
                    </span>
                    <span className="ml-2 text-xs text-[var(--muted)]">
                      {row.kindLabel}
                      {row.markedDays.length > 0
                        ? ` · ${row.markedDays.length} día(s) marcado(s)`
                        : ''}
                    </span>
                  </span>
                  <EnLaSemana weekId={weekId} row={row} />
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
      <form action={action}>
        <input type="hidden" name="weekId" value={weekId} />

        {visibles.length === 0 ? (
          <p className="p-3.5 text-sm text-[var(--muted)]">
            {filtro === 'ACTIVOS'
              ? 'Todavía no hay equipos en esta semana. '
              : `Ningún equipo ${filtro === 'RENTED' ? 'rentado' : 'propio'} está en esta semana. `}
            Ve a <strong>Todos</strong> y oprime <strong>+ Agregar</strong> en los que estuvieron
            en obra.
          </p>
        ) : (
          <div className="overflow-x-auto p-3.5">
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr>
                  <th className="min-w-[180px] py-1 pr-2 text-left font-medium text-[var(--muted)]">
                    Equipo
                  </th>
                  <th className="min-w-[130px] px-2 py-1 text-left font-medium text-[var(--muted)]">
                    Proyecto
                  </th>
                  {shortDays.map((day) => (
                    <th
                      key={day.iso}
                      className="px-1 py-1 text-center font-medium text-[var(--muted)]"
                    >
                      {day.label}
                    </th>
                  ))}
                  <th className="min-w-[130px] py-1 pl-2 text-right font-medium text-[var(--muted)]">
                    Liquidación
                  </th>
                  <th className="py-1 pl-2 text-right font-medium text-[var(--muted)]">Quitar</th>
                </tr>
              </thead>
              <tbody>
                {visibles.map((row) => (
                  <tr key={row.equipmentId} className="border-t border-[var(--border)]">
                    <td className="py-1.5 pr-2">
                      <p className="text-sm font-medium">
                        {row.name}
                        <span
                          className={`ml-2 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                            row.ownership === 'RENTED'
                              ? 'bg-amber-100 text-amber-900'
                              : 'bg-[var(--hover)] text-[var(--muted)]'
                          }`}
                        >
                          {row.ownership === 'RENTED' ? 'rentado' : 'propio'}
                        </span>
                      </p>
                      <p className="text-[11px] text-[var(--muted)]">
                        {row.kindLabel}
                        {row.ownership === 'RENTED' ? (
                          <>
                            {' · '}
                            {row.dailyCost ? (
                              `$${currency(row.dailyCost)}/día`
                            ) : (
                              <span className="font-medium text-red-700">sin costo diario</span>
                            )}{' '}
                            ·{' '}
                            {row.hasVendor ? (
                              <>cobra {row.vendorName}</>
                            ) : (
                              <span className="font-medium text-red-700">sin proveedor</span>
                            )}
                          </>
                        ) : (
                          ' · costo interno, no se le paga a nadie'
                        )}
                      </p>
                      <input type="hidden" name={`equipomember:${row.equipmentId}`} value="1" />
                    </td>

                    {/* A qué obra se le carga el alquiler de esta semana. */}
                    <td className="px-2 py-1.5">
                      <select
                        name={`equipoproyecto:${row.equipmentId}`}
                        defaultValue={row.projectId ?? ''}
                        className="h-8 w-full min-w-[120px] rounded border border-[var(--border)] bg-[var(--bg)] px-1 text-xs"
                      >
                        <option value="">— sin proyecto —</option>
                        {grupos.enUso.length > 0 ? (
                          <optgroup label="En esta semana">
                            {grupos.enUso.map((project) => (
                              <option key={project.id} value={project.id}>
                                {project.name}
                              </option>
                            ))}
                          </optgroup>
                        ) : null}
                        {grupos.resto.length > 0 ? (
                          <optgroup label={grupos.enUso.length > 0 ? 'Los demás' : 'Proyectos'}>
                            {grupos.resto.map((project) => (
                              <option key={project.id} value={project.id}>
                                {project.name}
                              </option>
                            ))}
                          </optgroup>
                        ) : null}
                      </select>
                    </td>

                    {shortDays.map((day) => (
                      <td key={day.iso} className="px-1 py-1.5 text-center">
                        <input
                          type="checkbox"
                          name={`equipoday:${row.equipmentId}:${day.iso}`}
                          defaultChecked={row.markedDays.includes(
                            `${row.equipmentId}:${day.iso}`,
                          )}
                          className="h-3.5 w-3.5"
                        />
                      </td>
                    ))}

                    <td className="py-1.5 pl-2 text-right">
                      {row.ownership === 'OWNED' ? (
                        <span className="text-[11px] text-[var(--muted)]">no se paga</span>
                      ) : row.payable ? (
                        <>
                          <p className="text-sm font-semibold tabular-nums">
                            ${currency(row.payable.total)}
                          </p>
                          <p className="text-[11px] text-[var(--muted)]">
                            {row.payable.days} día(s) · {row.payable.statusLabel}
                          </p>
                        </>
                      ) : (
                        <span className="text-[11px] text-[var(--muted)]">sin liquidar</span>
                      )}
                    </td>

                    <td className="py-1.5 pl-2">
                      <QuitarEquipo weekId={weekId} row={row} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="border-t border-[var(--border)] px-3.5 py-3">
          <button
            type="submit"
            disabled={saving}
            className="h-9 rounded-full bg-[var(--accent)] px-4 text-sm font-medium text-white hover:opacity-90 disabled:opacity-45"
          >
            {saving ? 'Guardando…' : 'Guardar días de equipo'}
          </button>
          <span className="ml-3 text-xs text-[var(--muted)]">
            Si la liquidación ya estaba aprobada, se cae y vuelve a aprobación — con rastro.
          </span>
        </div>
      </form>
      )}
    </section>
  )
}
