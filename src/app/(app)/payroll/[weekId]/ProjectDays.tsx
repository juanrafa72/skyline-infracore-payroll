'use client'

import { useState } from 'react'
import { DayCell } from './DayCell'

/**
 * Un día de la rejilla, con lo que ya está guardado en él.
 */
export interface GridDay {
  iso: string
  /** «Lun 11», como sale en el encabezado. */
  label: string
  dayType: string
  amount: string
  note: string
  /**
   * Proyecto guardado de ESE día.
   *
   * `null` = todavía no hay día guardado. `''` = el día existe y quedó a
   * propósito sin proyecto. **No es lo mismo**: confundirlos hace que un día
   * sin proyecto herede el de la semana en cualquier guardado posterior.
   */
  savedProjectId: string | null
}

/**
 * El proyecto de la persona en la semana, y sus días.
 *
 * Van juntos en un solo componente porque comparten un interruptor: el proyecto
 * puede ser uno para toda la semana (lo normal) o uno por día. Se devuelven como
 * fragmento —dos celdas sueltas— para que la rejilla del padre siga mandando en
 * el layout.
 *
 * Por qué existe el modo por día: la misma persona trabaja lunes, martes y
 * viernes en un proyecto y miércoles y jueves en otro. Pasa, y el modelo
 * siempre lo admitió (`WorkEntry` guarda el proyecto de cada día); lo que
 * faltaba era la pantalla. De ahí sale el cliente al que se le factura ese día,
 * así que ponerlos todos en el mismo proyecto no es un detalle cosmético: es
 * facturarle a quien no fue.
 */
export function ProjectDays({
  workerId,
  weekProjectId,
  days,
  projects,
  inlineDays,
  startPerDay,
}: {
  workerId: string
  /** Proyecto propuesto para toda la semana ('' = sin proyecto). */
  weekProjectId: string
  days: readonly GridDay[]
  projects: ReadonlyArray<{ id: string; name: string }>
  inlineDays: boolean
  /**
   * Arranca en modo por día. Viene en `true` cuando los días guardados ya
   * tienen proyectos distintos: mostrar un solo selector ahí haría que el
   * siguiente guardado aplanara la semana en silencio.
   */
  startPerDay: boolean
}) {
  const [perDay, setPerDay] = useState(startPerDay)
  const [weekChoice, setWeekChoice] = useState(weekProjectId)

  const options = (
    <>
      <option value="">— sin proyecto —</option>
      {projects.map((project) => (
        <option key={project.id} value={project.id}>
          {project.name}
        </option>
      ))}
    </>
  )

  return (
    <>
      <div className="mt-2 md:mt-0">
        <span className="mb-0.5 block text-[11px] text-[var(--muted)] md:hidden">Proyecto</span>

        {perDay ? (
          <div className="rounded border border-sky-300 bg-sky-50 px-1.5 py-1 text-[11px] leading-tight text-sky-900">
            <p className="font-semibold">Proyecto por día</p>
            <p className="text-sky-800">se marca abajo, en cada día</p>
            <button
              type="button"
              onClick={() => setPerDay(false)}
              className="mt-0.5 underline hover:no-underline"
            >
              volver a uno solo
            </button>
          </div>
        ) : (
          <>
            {/*
              Si esta semana aún no dice nada, se propone el proyecto de la
              semana pasada (solo sugerencia visual: no se guarda nada hasta
              oprimir «Guardar días»).
            */}
            <select
              name={`proyecto:${workerId}`}
              value={weekChoice}
              onChange={(event) => setWeekChoice(event.target.value)}
              className="h-8 w-full rounded border border-[var(--border)] bg-[var(--surface)] px-1 text-xs outline-none focus:border-[var(--accent)]"
            >
              {options}
            </select>

            <button
              type="button"
              onClick={() => setPerDay(true)}
              className="mt-0.5 block text-left text-[11px] text-[var(--accent)] underline hover:no-underline"
            >
              cambió de proyecto entre semana
            </button>

            {/*
              Solo aparece si la semana YA tenía días en proyectos distintos y
              alguien acaba de cerrar el modo por día: al guardar, todos
              quedarían en uno. Es legítimo, pero no puede pasar sin avisar.
            */}
            {startPerDay ? (
              <p className="mt-0.5 text-[11px] font-medium leading-tight text-amber-700">
                Al guardar, TODOS los días quedan en este proyecto.
              </p>
            ) : null}
          </>
        )}
      </div>

      {/* `md:contents` disuelve este envoltorio dentro de la rejilla en escritorio */}
      <div
        className={`mt-3 grid grid-cols-4 gap-2 md:mt-0 ${
          inlineDays ? 'md:contents' : 'md:grid-cols-8 md:gap-1.5'
        }`}
      >
        {days.map((day) => (
          // La clave incluye lo guardado: al recalcular, React vuelve a montar
          // los campos y muestran lo que quedó. Sin esto, un campo no
          // controlado conserva en pantalla lo que tenía antes.
          <label
            key={`${day.iso}:${day.dayType}:${day.amount}:${day.savedProjectId ?? ''}`}
            className="block"
          >
            <span
              className={`mb-0.5 block text-center text-[11px] text-[var(--muted)] ${
                inlineDays ? 'md:hidden' : ''
              }`}
            >
              {day.label}
            </span>

            <DayCell
              workerId={workerId}
              day={day.iso}
              dayType={day.dayType}
              amount={day.amount}
              note={day.note}
            />

            {perDay ? (
              <select
                name={`proyectodia:${workerId}:${day.iso}`}
                // Un día ya guardado manda sobre la propuesta de la semana,
                // incluso si quedó sin proyecto (`''`).
                defaultValue={day.savedProjectId ?? weekChoice}
                title={`Proyecto del ${day.label}`}
                className="mt-1 h-7 w-full min-w-[52px] rounded border border-sky-300 bg-sky-50 px-0.5 text-[11px] outline-none focus:border-[var(--accent)]"
              >
                {options}
              </select>
            ) : null}
          </label>
        ))}
      </div>
    </>
  )
}
