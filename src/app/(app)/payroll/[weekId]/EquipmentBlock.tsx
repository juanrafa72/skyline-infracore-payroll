'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { useActionState } from 'react'
import { agruparProyectos } from '@/lib/payroll/project-order'
import { saveEquipmentWeekDays } from '../actions'

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
}

export interface ProjectOption {
  id: string
  name: string
}

type Filtro = 'TODOS' | 'RENTED' | 'OWNED'

const FILTROS: ReadonlyArray<{ value: Filtro; label: string }> = [
  { value: 'RENTED', label: 'Rentados' },
  { value: 'OWNED', label: 'Propios' },
  { value: 'TODOS', label: 'Todos' },
]

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
  const hayRentados = rows.some((row) => row.ownership === 'RENTED')
  const [filtro, setFiltro] = useState<Filtro>(hayRentados ? 'RENTED' : 'TODOS')

  const visibles = useMemo(
    () => (filtro === 'TODOS' ? rows : rows.filter((row) => row.ownership === filtro)),
    [rows, filtro],
  )

  const cuenta = useMemo(
    () => ({
      rentados: rows.filter((r) => r.ownership === 'RENTED').length,
      propios: rows.filter((r) => r.ownership === 'OWNED').length,
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
                {opcion.value === 'RENTED' ? ` (${cuenta.rentados})` : null}
                {opcion.value === 'OWNED' ? ` (${cuenta.propios})` : null}
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

      <form action={action}>
        <input type="hidden" name="weekId" value={weekId} />

        {visibles.length === 0 ? (
          <p className="p-3.5 text-sm text-[var(--muted)]">
            No hay equipos {filtro === 'RENTED' ? 'rentados' : 'propios'} activos.{' '}
            <Link prefetch={false} href="/equipment" className="text-[var(--accent)] underline">
              Se crean en Catálogos → Equipos
            </Link>
            .
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
    </section>
  )
}
