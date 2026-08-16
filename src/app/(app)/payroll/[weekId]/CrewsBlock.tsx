'use client'

import { useActionState, useState, useTransition } from 'react'
import {
  asignarContratistaACuadrilla,
  calculateWeek,
  capturarProduccionDeCuadrilla,
  saveCrewControlDays,
  toggleCuadrillaEnSemana,
} from '../actions'
import { ContractorBreakdown, type ContractorPanel } from './ContractorBreakdown'

export interface CrewProductionRow {
  id: string
  label: string
  quantity: string
  cost: string
  revenue: string | null
  margin: string | null
}

export interface CrewView {
  crewId: string
  crewName: string
  contractorName: string | null
  hasContractor: boolean
  /** PRODUCTION = por pie construido · DAILY = precio fijo por día. */
  billingMode: 'PRODUCTION' | 'DAILY'
  dailyRate: string | null
  /** Solo DAILY: días ya marcados, `crewId:YYYY-MM-DD`. */
  crewDays: ReadonlyArray<string>
  projectId: string | null
  payable: { total: string; count: number; statusLabel: string } | null
  members: ReadonlyArray<{ workerId: string; name: string }>
  controlDays: ReadonlyArray<string>
  production: ReadonlyArray<CrewProductionRow>
}

function currency(value: string | number): string {
  return Number(value).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

/**
 * Bloque de cuadrillas de la semana: producción → deuda con el contratista,
 * más los días de control de su gente.
 *
 * Aquí NADIE cobra por día: al contratista se le paga el total de producción y
 * él le paga a su gente. Los días de los integrantes se anotan solo como
 * control interno — por eso viven en una cuadrícula aparte de la de personal,
 * y guardarlos jamás toca un día pagado.
 */
/**
 * Decir a quién se le paga esta cuadrilla, sin salir de la semana.
 *
 * Doce de las «cuadrillas» que trajo el Excel son equipos de trabajo internos
 * —CAMION, CUBO, DIRECCIONAL DRILL— y no tienen contratista. Descubrirlo al
 * momento de liquidar y tener que salir a Catálogos para arreglarlo es lo que
 * hacía la pantalla inservible. Se puede escribir uno nuevo: si el que trabajó
 * no está en el catálogo, mandarlo a crearlo aparte es el mismo viaje.
 *
 * SIN formulario propio: vive dentro del formulario de los días de control.
 */
function AsignarContratista({
  weekId,
  crewId,
  crewName,
  contractors,
}: {
  weekId: string
  crewId: string
  crewName: string
  contractors: ReadonlyArray<{ id: string; name: string }>
}) {
  const [pendiente, empezar] = useTransition()
  const [mensaje, setMensaje] = useState<string | null>(null)
  const [contractorId, setContractorId] = useState('')
  const [nombreNuevo, setNombreNuevo] = useState('')

  return (
    <div className="mt-2 rounded-lg border border-red-200 bg-red-50/50 p-3">
      <p className="mb-2 text-xs font-medium text-red-800">
        ¿A quién se le paga {crewName}? Sin esto no se puede aprobar su pago.
      </p>

      <div className="flex flex-wrap items-end gap-2">
        {contractors.length > 0 ? (
          <label className="text-xs">
            <span className="mb-0.5 block text-[var(--muted)]">Contratista</span>
            <select
              value={contractorId}
              onChange={(evento) => {
                setContractorId(evento.target.value)
                if (evento.target.value) setNombreNuevo('')
              }}
              className="h-8 min-w-48 rounded border border-[var(--border)] bg-[var(--bg)] px-1 text-sm"
            >
              <option value="">— escoge —</option>
              {contractors.map((contractor) => (
                <option key={contractor.id} value={contractor.id}>
                  {contractor.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        <label className="text-xs">
          <span className="mb-0.5 block text-[var(--muted)]">
            {contractors.length > 0 ? '…o uno nuevo' : 'Nombre del contratista'}
          </span>
          <input
            value={nombreNuevo}
            onChange={(evento) => {
              setNombreNuevo(evento.target.value)
              if (evento.target.value) setContractorId('')
            }}
            placeholder="Ej.: Hugo"
            className="h-8 w-44 rounded border border-[var(--border)] bg-[var(--bg)] px-2 text-sm"
          />
        </label>

        <button
          type="button"
          disabled={pendiente}
          onClick={() => {
            setMensaje(null)
            const datos = new FormData()
            datos.set('weekId', weekId)
            datos.set('crewId', crewId)
            datos.set('contractorId', contractorId)
            datos.set('nombreNuevo', nombreNuevo)
            empezar(async () => {
              setMensaje(await asignarContratistaACuadrilla(null, datos))
            })
          }}
          className="inline-flex h-8 items-center rounded-full border border-red-300 bg-white px-4 text-xs font-medium hover:bg-red-100 disabled:opacity-45"
        >
          {pendiente ? 'Guardando…' : 'Guardar'}
        </button>
      </div>

      {mensaje ? (
        <p
          className={`mt-1.5 text-xs ${
            mensaje.startsWith('LISTO|') ? 'text-emerald-800' : 'text-amber-800'
          }`}
        >
          {mensaje.replace(/^LISTO\|/, '')}
        </p>
      ) : null}
    </div>
  )
}

/**
 * Capturar lo que construyó una cuadrilla, sin salir de la semana.
 *
 * Agregar una cuadrilla no servía de nada: sin producción no hay liquidación,
 * sin liquidación no hay desglose que editar, y la producción se capturaba en
 * otra pantalla que además exigía una negociación creada de antemano. Quien
 * agregaba a Jesús se quedaba mirando «aún sin liquidar» sin nada que oprimir.
 *
 * Se pide como lo dice el negocio —«10.000 pies a $0.30»— y con la tarifa
 * editable. SIN formulario propio: vive dentro del formulario de los días de
 * control, y un <form> dentro de otro es HTML inválido.
 */
function CapturarProduccion({
  weekId,
  crewId,
  crewName,
  desde,
  projects,
}: {
  weekId: string
  crewId: string
  crewName: string
  /** Primer día de la semana: la fecha que se propone. */
  desde: string
  projects: ReadonlyArray<{ id: string; name: string }>
}) {
  const [pendiente, empezar] = useTransition()
  const [calculando, calcular] = useTransition()
  const [mensaje, setMensaje] = useState<string | null>(null)
  const [cantidad, setCantidad] = useState('')
  const [tarifa, setTarifa] = useState('')
  const [fecha, setFecha] = useState(desde)
  const [proyecto, setProyecto] = useState('')
  const [unidad, setUnidad] = useState('FOOT')

  const total =
    Number(cantidad) > 0 && Number(tarifa) > 0
      ? (Number(cantidad) * Number(tarifa)).toLocaleString('en-US', {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })
      : null

  return (
    <div className="mt-3 rounded-lg border border-[var(--border)] bg-[var(--hover)] p-3">
      <p className="mb-2 text-xs font-medium">
        ¿Qué construyó {crewName} esta semana?
      </p>

      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs">
          <span className="mb-0.5 block text-[var(--muted)]">Cantidad</span>
          <input
            value={cantidad}
            onChange={(e) => setCantidad(e.target.value)}
            inputMode="decimal"
            placeholder="10000"
            className="h-8 w-28 rounded border border-[var(--border)] bg-[var(--bg)] px-2 text-sm"
          />
        </label>

        <label className="text-xs">
          <span className="mb-0.5 block text-[var(--muted)]">Unidad</span>
          <select
            value={unidad}
            onChange={(e) => setUnidad(e.target.value)}
            className="h-8 rounded border border-[var(--border)] bg-[var(--bg)] px-1 text-sm"
          >
            <option value="FOOT">pies</option>
            <option value="METER">metros</option>
            <option value="UNIT">unidades</option>
          </select>
        </label>

        <label className="text-xs">
          <span className="mb-0.5 block text-[var(--muted)]">Se le paga por unidad</span>
          <input
            value={tarifa}
            onChange={(e) => setTarifa(e.target.value)}
            inputMode="decimal"
            placeholder="0.30"
            className="h-8 w-24 rounded border border-[var(--border)] bg-[var(--bg)] px-2 text-sm"
          />
        </label>

        <label className="text-xs">
          <span className="mb-0.5 block text-[var(--muted)]">Fecha</span>
          <input
            type="date"
            value={fecha}
            onChange={(e) => setFecha(e.target.value)}
            className="h-8 rounded border border-[var(--border)] bg-[var(--bg)] px-2 text-sm"
          />
        </label>

        {projects.length > 0 ? (
          <label className="text-xs">
            <span className="mb-0.5 block text-[var(--muted)]">Proyecto</span>
            <select
              value={proyecto}
              onChange={(e) => setProyecto(e.target.value)}
              className="h-8 rounded border border-[var(--border)] bg-[var(--bg)] px-1 text-sm"
            >
              <option value="">— sin proyecto —</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        <button
          type="button"
          disabled={pendiente}
          onClick={() => {
            setMensaje(null)
            const datos = new FormData()
            datos.set('weekId', weekId)
            datos.set('crewId', crewId)
            datos.set('cantidad', cantidad)
            datos.set('tarifa', tarifa)
            datos.set('fecha', fecha)
            datos.set('unidad', unidad)
            datos.set('projectId', proyecto)
            empezar(async () => {
              const resultado = await capturarProduccionDeCuadrilla(null, datos)
              setMensaje(resultado)
              if (resultado.startsWith('LISTO|')) {
                setCantidad('')
                setTarifa('')
              }
            })
          }}
          className="brand-gradient inline-flex h-8 items-center rounded-full px-4 text-xs font-medium text-white disabled:opacity-45"
        >
          {pendiente ? 'Guardando…' : 'Guardar producción'}
        </button>

        {/* La cuenta a la vista mientras se teclea: es la calculadora que pidió el negocio. */}
        {total ? (
          <span className="text-sm font-semibold tabular-nums">= ${total}</span>
        ) : null}
      </div>

      {mensaje ? (
        <div className="mt-2">
          <p
            className={`text-xs ${
              mensaje.startsWith('LISTO|') ? 'text-emerald-800' : 'text-amber-800'
            }`}
          >
            {mensaje.replace(/^LISTO\|/, '').replace(' Presiona «Calcular nómina» para liquidarla.', '')}
          </p>

          {/*
            El paso siguiente, aquí mismo.
            Decir «presiona Calcular nómina» y dejar ese botón al final de una
            página larga es mandar a buscar: quien acaba de capturar está
            mirando ESTE punto de la pantalla.
          */}
          {mensaje.startsWith('LISTO|') ? (
            <button
              type="button"
              disabled={calculando}
              onClick={() => {
                const datos = new FormData()
                datos.set('weekId', weekId)
                calcular(async () => {
                  await calculateWeek(datos)
                })
              }}
              className="paso-siguiente mt-2 inline-flex h-8 items-center rounded-full bg-[var(--accent)] px-4 text-xs font-medium text-white disabled:opacity-45"
            >
              {calculando ? 'Calculando…' : 'Calcular nómina y liquidarla'}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

/**
 * Escoger qué cuadrillas se liquidan esta semana.
 *
 * Va FUERA del formulario de los días de control: un <form> dentro de otro es
 * HTML inválido y su botón terminaría guardando los días.
 */
function EscogerCuadrilla({
  weekId,
  disponibles,
  enLaSemana,
  sinCapturar,
}: {
  weekId: string
  disponibles: ReadonlyArray<{
    id: string
    name: string
    contractorName: string | null
    yaEsta: boolean
  }>
  enLaSemana: number
  /** Cuántas están en la semana pero todavía sin nada capturado. */
  sinCapturar: number
}) {
  const [result, action, saving] = useActionState(toggleCuadrillaEnSemana, null)
  const [abierto, setAbierto] = useState(false)
  const faltantes = disponibles.filter((crew) => !crew.yaEsta)
  const conContratista = faltantes.filter((crew) => crew.contractorName)
  const sinContratista = faltantes.filter((crew) => !crew.contractorName)

  return (
    <div className="mx-3.5 mt-3">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-[var(--hover)] px-3 py-2">
        <span className="text-sm">
          <strong>{enLaSemana}</strong> cuadrilla{enLaSemana === 1 ? '' : 's'} en esta semana
          {/*
            En qué van, igual que lo dice el bloque de la gente. Un bloque que
            no dice si le falta algo obliga a recorrerlo entero para saberlo.
          */}
          <span
            className={`mt-0.5 block text-xs ${
              sinCapturar > 0 ? 'font-medium text-amber-700' : 'text-[var(--muted)]'
            }`}
          >
            {enLaSemana === 0
              ? 'Agrega la que vas a liquidar.'
              : sinCapturar > 0
                ? `Falta capturar lo que construyó ${sinCapturar === 1 ? '1 cuadrilla' : `${sinCapturar} cuadrillas`}.`
                : 'Todas tienen su producción capturada.'}
          </span>
        </span>
        {faltantes.length > 0 ? (
          <button
            type="button"
            onClick={() => setAbierto((antes) => !antes)}
            className="rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
          >
            {abierto ? 'Cerrar' : '+ Agregar cuadrilla'}
          </button>
        ) : (
          <span className="text-xs text-[var(--muted)]">Ya están todas las del catálogo.</span>
        )}
      </div>

      {result ? (
        <p
          className={`mt-2 rounded-md border p-2.5 text-sm ${
            result.startsWith('LISTO|')
              ? 'border-emerald-300 bg-emerald-50 text-emerald-900'
              : 'border-amber-300 bg-amber-50 text-amber-900'
          }`}
        >
          {result.replace(/^LISTO\|/, '')}
        </p>
      ) : null}

      {abierto ? (
        <form action={action} className="mt-2 flex flex-wrap items-end gap-2 rounded-lg border border-[var(--border)] p-3">
          <input type="hidden" name="weekId" value={weekId} />
          <label className="text-sm">
            <span className="mb-1 block text-xs text-[var(--muted)]">Cuál se liquida</span>
            {/*
              Primero las que tienen a quién pagarle.
              Doce de las «cuadrillas» que trajo el Excel son equipos de trabajo
              internos —CAMION, CUBO, DIRECCIONAL DRILL— y no se le pagan a
              nadie. Mezcladas alfabéticamente tapaban a los contratistas, que
              son los que uno viene a liquidar.
            */}
            <select
              name="crewId"
              required
              className="h-9 min-w-72 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-2 text-sm"
            >
              {conContratista.length > 0 ? (
                <optgroup label="Se le paga a un contratista">
                  {conContratista.map((crew) => (
                    <option key={crew.id} value={crew.id}>
                      {crew.name} — se le paga a {crew.contractorName}
                    </option>
                  ))}
                </optgroup>
              ) : null}
              {sinContratista.length > 0 ? (
                <optgroup label="Sin contratista — hay que decir a quién se le paga">
                  {sinContratista.map((crew) => (
                    <option key={crew.id} value={crew.id}>
                      {crew.name}
                    </option>
                  ))}
                </optgroup>
              ) : null}
            </select>
          </label>
          <button
            type="submit"
            disabled={saving}
            className="brand-gradient inline-flex h-9 items-center rounded-full px-4 text-sm font-medium text-white disabled:opacity-45"
          >
            {saving ? 'Agregando…' : 'Agregar a la semana'}
          </button>
        </form>
      ) : null}
    </div>
  )
}

export function CrewsBlock({
  weekId,
  shortDays,
  crews,
  loose,
  projects = [],
  panels = [],
  disponibles = [],
  contractors = [],
}: {
  weekId: string
  /** Días de la semana: [iso, etiqueta corta]. */
  shortDays: ReadonlyArray<{ iso: string; label: string }>
  crews: readonly CrewView[]
  /** Producción sin cuadrilla (histórica): visible para que no se pierda. */
  loose: readonly CrewProductionRow[]
  /** Para elegir a qué obra se le carga una cuadrilla que cobra por día. */
  projects?: ReadonlyArray<{ id: string; name: string }>
  /** Desglose y conciliación por contratista, uno por liquidación calculada. */
  panels?: readonly ContractorPanel[]
  /** Los contratistas del catálogo, para decir a quién se le paga. */
  contractors?: ReadonlyArray<{ id: string; name: string }>
  /** Todas las cuadrillas de la compañía, para poder escoger cuál se liquida. */
  disponibles?: ReadonlyArray<{
    id: string
    name: string
    contractorName: string | null
    yaEsta: boolean
  }>
}) {
  const [result, action, saving] = useActionState(saveCrewControlDays, null)
  const ok = result !== null && result.startsWith('LISTO|')

  const anyMembers = crews.some((crew) => crew.members.length > 0)

  return (
    <section className="mb-6 rounded-lg border border-[var(--border)] bg-[var(--surface)]">
      <div className="border-b border-[var(--border)] p-3.5">
        <h2 className="text-sm font-semibold">Cuadrillas — se paga al contratista</h2>
        <p className="mt-0.5 text-xs text-[var(--muted)]">
          La producción de la semana se vuelve una liquidación por cuadrilla al presionar
          «Calcular nómina». Los días de la gente son control interno: <strong>no generan pago
          individual</strong>.
        </p>
      </div>

      {/*
        Cuáles se liquidan esta semana. Antes solo aparecían las que ya tenían
        producción capturada, así que no había por dónde empezar con una
        cuadrilla nueva — y pueden trabajar varias a la vez.
      */}
      <EscogerCuadrilla
        weekId={weekId}
        disponibles={disponibles}
        enLaSemana={crews.length}
        sinCapturar={
          crews.filter((crew) => !crew.payable && crew.production.length === 0).length
        }
      />

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

        <ul className="divide-y divide-[var(--border)]">
          {crews.map((crew) => (
            <li key={crew.crewId} className="p-3.5">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold">
                    {crew.crewName}
                    {/* Cómo cobra: por pie construido o precio fijo por día. */}
                    <span
                      className={`ml-2 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                        crew.billingMode === 'DAILY'
                          ? 'bg-sky-100 text-sky-900'
                          : 'bg-[var(--hover)] text-[var(--muted)]'
                      }`}
                    >
                      {crew.billingMode === 'DAILY'
                        ? crew.dailyRate
                          ? `$${currency(crew.dailyRate)} por día`
                          : 'por día — falta la tarifa'
                        : 'por producción'}
                    </span>
                  </p>
                  <p className="text-xs text-[var(--muted)]">
                    {crew.hasContractor ? (
                      <>se le paga a <strong>{crew.contractorName}</strong></>
                    ) : (
                      <span className="font-medium text-red-700">
                        sin contratista — dilo aquí abajo
                      </span>
                    )}
                  </p>
                </div>
                {crew.payable ? (
                  <div className="text-right">
                    <p className="text-lg font-semibold tabular-nums">
                      ${currency(crew.payable.total)}
                    </p>
                    <p className="text-xs text-[var(--muted)]">
                      {crew.billingMode === 'DAILY'
                        ? `${crew.payable.count} día(s)`
                        : `${crew.payable.count} registro(s)`}{' '}
                      · {crew.payable.statusLabel}
                    </p>
                  </div>
                ) : (
                  <p className="text-xs text-[var(--muted)]">
                    {crew.billingMode === 'DAILY'
                      ? 'aún sin liquidar — marca los días y presiona «Calcular nómina»'
                      : 'aún sin liquidar — captura lo que construyó, aquí abajo'}
                  </p>
                )}
              </div>

              {/*
                Días de la cuadrilla que cobra POR DÍA.
                No confundir con los días de control de su gente, que van
                abajo: estos SÍ pagan, y le pagan al contratista.
              */}
              {/* Lo primero que falta: a quién se le paga. */}
              {!crew.hasContractor ? (
                <AsignarContratista
                  weekId={weekId}
                  crewId={crew.crewId}
                  crewName={crew.crewName}
                  contractors={contractors}
                />
              ) : null}

              {/*
                Sin liquidación todavía: aquí se captura lo que construyó, con
                la tarifa a la vista. Antes había que irse a otra pantalla y
                además tener creada la negociación.
              */}
              {crew.billingMode === 'PRODUCTION' && !crew.payable ? (
                <CapturarProduccion
                  weekId={weekId}
                  crewId={crew.crewId}
                  crewName={crew.crewName}
                  desde={shortDays[0]?.iso ?? ''}
                  projects={projects}
                />
              ) : null}

              {crew.billingMode === 'DAILY' ? (
                <div className="mt-3 rounded-lg border border-sky-200 bg-sky-50/50 p-2.5">
                  <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs font-medium">Días que trabajó la cuadrilla</span>
                    {projects.length > 0 ? (
                      <label className="text-xs">
                        <span className="mr-1 text-[var(--muted)]">Proyecto:</span>
                        <select
                          name={`crewproyecto:${crew.crewId}`}
                          defaultValue={crew.projectId ?? ''}
                          className="h-7 rounded border border-[var(--border)] bg-[var(--bg)] px-1 text-xs"
                        >
                          <option value="">— sin proyecto —</option>
                          {projects.map((project) => (
                            <option key={project.id} value={project.id}>
                              {project.name}
                            </option>
                          ))}
                        </select>
                      </label>
                    ) : null}
                  </div>

                  <input type="hidden" name={`crewmember:${crew.crewId}`} value="1" />
                  <div className="flex flex-wrap gap-2">
                    {shortDays.map((day) => (
                      <label
                        key={day.iso}
                        className="flex items-center gap-1 text-xs text-[var(--muted)]"
                      >
                        <input
                          type="checkbox"
                          name={`crewday:${crew.crewId}:${day.iso}`}
                          defaultChecked={crew.crewDays.includes(`${crew.crewId}:${day.iso}`)}
                          className="h-3.5 w-3.5"
                        />
                        {day.label}
                      </label>
                    ))}
                  </div>

                  {!crew.dailyRate ? (
                    <p className="mt-1.5 text-xs font-medium text-red-700">
                      Falta la tarifa diaria de esta cuadrilla. Ponla en Catálogos → Cuadrillas:
                      sin ella no se puede calcular lo que se le debe.
                    </p>
                  ) : null}
                </div>
              ) : null}

              {crew.production.length > 0 ? (
                <ul className="mt-2 space-y-0.5">
                  {crew.production.map((row) => (
                    <li
                      key={row.id}
                      className="flex flex-wrap items-center gap-x-4 gap-y-0.5 text-xs text-[var(--muted)]"
                    >
                      <span className="min-w-[140px] flex-1">
                        {row.label} · {row.quantity}
                      </span>
                      <span className="tabular-nums">
                        {row.revenue === null ? 'sin venta' : `venta $${currency(row.revenue)}`}
                      </span>
                      <span className="tabular-nums">costo ${currency(row.cost)}</span>
                      <span
                        className={`min-w-[80px] text-right font-medium tabular-nums ${
                          row.margin !== null && Number(row.margin) < 0 ? 'text-red-700' : ''
                        }`}
                      >
                        {row.margin === null ? '—' : `$${currency(row.margin)}`}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}

              {crew.members.length > 0 ? (
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full border-collapse text-xs">
                    <thead>
                      <tr>
                        <th className="min-w-[150px] py-1 pr-2 text-left font-medium text-[var(--muted)]">
                          Su gente (control, sin pago)
                        </th>
                        {shortDays.map((day) => (
                          <th
                            key={day.iso}
                            className="px-1 py-1 text-center font-medium text-[var(--muted)]"
                          >
                            {day.label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {crew.members.map((member) => (
                        <tr key={member.workerId} className="border-t border-[var(--border)]">
                          <td className="py-1 pr-2">
                            {member.name}
                            <input
                              type="hidden"
                              name={`controlmember:${member.workerId}`}
                              value={crew.crewId}
                            />
                          </td>
                          {shortDays.map((day) => (
                            <td key={day.iso} className="px-1 py-1 text-center">
                              <input
                                type="checkbox"
                                name={`controlday:${member.workerId}:${day.iso}`}
                                defaultChecked={crew.controlDays.includes(
                                  `${member.workerId}:${day.iso}`,
                                )}
                                className="h-3.5 w-3.5"
                              />
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                /*
                 * Solo se avisa si tampoco hay desglose abajo. Decir «no tiene
                 * integrantes» justo encima de la tabla con sus cuatro personas
                 * se lee como un error de la aplicación: la gente de la
                 * cuadrilla (para días de control) y el desglose del
                 * contratista son dos listas distintas, y quien mira la
                 * pantalla no tiene por qué saberlo.
                 */
                !panels.some(
                  (panel) => panel.crewName === crew.crewName && panel.members.length > 0,
                ) ? (
                  <p className="mt-2 text-xs text-[var(--muted)]">
                    Sin integrantes registrados. Se agregan en{' '}
                    <strong>Catálogos → Cuadrillas</strong> y sirven para anotar sus días de
                    control; lo que se le paga al contratista se detalla abajo.
                  </p>
                ) : null
              )}
            </li>
          ))}
        </ul>

        {anyMembers ? (
          <div className="border-t border-[var(--border)] px-3.5 py-3">
            <button
              type="submit"
              disabled={saving}
              className="h-9 rounded-full bg-[var(--accent)] px-4 text-sm font-medium text-white hover:opacity-90 disabled:opacity-45"
            >
              {saving ? 'Guardando…' : 'Guardar días de control'}
            </button>
            <span className="ml-3 text-xs text-[var(--muted)]">
              Solo control: no cambian ningún pago ni tumban aprobaciones.
            </span>
          </div>
        ) : null}
      </form>

      {/*
        Contratistas: qué construyó cada uno, cómo se reparte entre su gente y
        si eso cuadra con lo que dice SharePoint.

        Va FUERA del formulario de días de control: son dos guardados distintos
        y un <form> dentro de otro es HTML inválido — el navegador descarta el
        de adentro y su botón termina enviando el de afuera.
      */}
      {panels.map((panel) => (
        <ContractorBreakdown key={panel.crewPayrollId} panel={panel} />
      ))}

      {loose.length > 0 ? (
        <div className="border-t border-[var(--border)] px-3.5 py-2.5">
          <p className="mb-1 text-xs font-semibold text-[var(--muted)]">
            Producción sin cuadrilla (histórica)
          </p>
          <ul className="space-y-0.5">
            {loose.map((row) => (
              <li key={row.id} className="flex flex-wrap gap-x-4 text-xs text-[var(--muted)]">
                <span className="min-w-[140px] flex-1">
                  {row.label} · {row.quantity}
                </span>
                <span className="tabular-nums">costo ${currency(row.cost)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  )
}
