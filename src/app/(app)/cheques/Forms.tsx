'use client'

import { useActionState, useState } from 'react'
import { AYUDA_DESCUENTO, CLASE_DESCUENTO, type ClaseDescuento } from '@/lib/cobros'
import { crearCheque, guardarDescuento, guardarLoQueEntro } from './actions'

function Aviso({ result }: { result: string | null }) {
  if (!result) return null
  const ok = result.startsWith('LISTO|')
  return (
    <p
      className={`mt-2 rounded-md border p-2.5 text-sm ${
        ok
          ? 'border-emerald-300 bg-emerald-50 text-emerald-900'
          : 'border-amber-300 bg-amber-50 text-amber-900'
      }`}
    >
      {result.replace(/^LISTO\|/, '')}
    </p>
  )
}

const campo =
  'h-9 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 text-sm'

/**
 * Anotar un cheque con lo que dice el soporte.
 *
 * Solo se pide lo que se sabe en ese momento: cliente, valor y qué semanas
 * cubre. Lo que entró al banco se ve días después, y pedirlo aquí obligaría a
 * esperar para poder anotar el cheque.
 */
export function NuevoCheque({
  customers,
  weeks,
}: {
  customers: ReadonlyArray<{ id: string; name: string }>
  weeks: ReadonlyArray<{ id: string; label: string }>
}) {
  const [result, action, saving] = useActionState(crearCheque, null)
  const [abierto, setAbierto] = useState(false)

  if (!abierto) {
    return (
      <button
        type="button"
        onClick={() => setAbierto(true)}
        className="brand-gradient mb-5 inline-flex h-9 items-center rounded-full px-4 text-sm font-medium text-white"
      >
        + Anotar un cheque
      </button>
    )
  }

  return (
    <form
      action={action}
      className="mb-5 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4"
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="text-sm">
          <span className="mb-1 block text-xs text-[var(--muted)]">Quién nos pagó</span>
          <select name="customerId" required className={`${campo} w-full`}>
            {customers.map((customer) => (
              <option key={customer.id} value={customer.id}>
                {customer.name}
              </option>
            ))}
          </select>
        </label>

        <label className="text-sm">
          <span className="mb-1 block text-xs text-[var(--muted)]">Valor del cheque</span>
          <input
            name="expectedAmount"
            required
            inputMode="decimal"
            placeholder="50000"
            className={`${campo} w-full`}
          />
          <span className="mt-0.5 block text-[11px] text-[var(--muted)]">
            Lo que dice el soporte, no lo que entró.
          </span>
        </label>

        <label className="text-sm">
          <span className="mb-1 block text-xs text-[var(--muted)]">Número o referencia</span>
          <input name="reference" placeholder="CK-4471" className={`${campo} w-full`} />
        </label>

        <label className="text-sm">
          <span className="mb-1 block text-xs text-[var(--muted)]">Nota</span>
          <input name="notes" placeholder="opcional" className={`${campo} w-full`} />
        </label>
      </div>

      {weeks.length > 0 ? (
        <fieldset className="mt-3">
          <legend className="mb-1 text-xs text-[var(--muted)]">
            ¿Qué semanas cubre? Puede ser una o varias.
          </legend>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {weeks.map((week) => (
              <label key={week.id} className="flex items-center gap-1.5 text-xs">
                <input type="checkbox" name="weekId" value={week.id} className="h-3.5 w-3.5" />
                {week.label}
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="submit"
          disabled={saving}
          className="brand-gradient inline-flex h-9 items-center rounded-full px-4 text-sm font-medium text-white disabled:opacity-45"
        >
          {saving ? 'Guardando…' : 'Anotar el cheque'}
        </button>
        <button
          type="button"
          onClick={() => setAbierto(false)}
          className="inline-flex h-9 items-center rounded-full border border-[var(--border)] px-4 text-sm hover:bg-[var(--hover)]"
        >
          Cancelar
        </button>
      </div>

      <Aviso result={result} />
    </form>
  )
}

/** Lo que de verdad entró al banco. */
export function LoQueEntro({
  checkId,
  receivedAmount,
  receivedDate,
}: {
  checkId: string
  receivedAmount: string | null
  receivedDate: string | null
}) {
  const [result, action, saving] = useActionState(guardarLoQueEntro, null)

  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="checkId" value={checkId} />
      <label className="text-xs">
        <span className="mb-0.5 block text-[var(--muted)]">Entró al banco</span>
        <input
          name="receivedAmount"
          defaultValue={receivedAmount ?? ''}
          required
          inputMode="decimal"
          placeholder="38000"
          className={`${campo} w-32`}
        />
      </label>
      <label className="text-xs">
        <span className="mb-0.5 block text-[var(--muted)]">Cuándo</span>
        <input
          type="date"
          name="receivedDate"
          defaultValue={receivedDate ?? ''}
          className={campo}
        />
      </label>
      <button
        type="submit"
        disabled={saving}
        className="inline-flex h-9 items-center rounded-full border border-[var(--border)] px-4 text-sm hover:bg-[var(--hover)] disabled:opacity-45"
      >
        {saving ? 'Guardando…' : receivedAmount ? 'Corregir' : 'Registrar'}
      </button>
      {result && !result.startsWith('LISTO|') ? (
        <span className="text-xs text-amber-800">{result}</span>
      ) : null}
    </form>
  )
}

/**
 * Anotar un descuento.
 *
 * La clase se escoge primero porque decide si esa plata vuelve: la retención
 * queda pendiente de que la devuelvan, lo demás ya no se recupera. Debajo se
 * dice qué significa la que está escogida, para no tener que adivinarlo.
 */
export function NuevoDescuento({
  checkId,
  projects,
}: {
  checkId: string
  projects: ReadonlyArray<{ id: string; name: string }>
}) {
  const [result, action, saving] = useActionState(guardarDescuento, null)
  const [clase, setClase] = useState<ClaseDescuento>('RETENCION')

  return (
    <form action={action} className="mt-2 rounded-lg border border-[var(--border)] p-3">
      <input type="hidden" name="checkId" value={checkId} />

      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs">
          <span className="mb-0.5 block text-[var(--muted)]">De qué es</span>
          <select
            name="clase"
            value={clase}
            onChange={(evento) => setClase(evento.target.value as ClaseDescuento)}
            className={campo}
          >
            {Object.entries(CLASE_DESCUENTO).map(([code, etiqueta]) => (
              <option key={code} value={code}>
                {etiqueta}
              </option>
            ))}
          </select>
        </label>

        <label className="text-xs">
          <span className="mb-0.5 block text-[var(--muted)]">Cuánto</span>
          <input
            name="amount"
            required
            inputMode="decimal"
            placeholder="10000"
            className={`${campo} w-28`}
          />
        </label>

        <label className="text-xs">
          <span className="mb-0.5 block text-[var(--muted)]">
            {clase === 'RETENCION' ? 'De qué obra (importante)' : 'De qué obra'}
          </span>
          <select name="projectId" className={campo}>
            <option value="">— sin proyecto —</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </label>

        <label className="min-w-56 flex-1 text-xs">
          <span className="mb-0.5 block text-[var(--muted)]">Por qué</span>
          <input
            name="reason"
            required
            placeholder="Retención hasta que termine Dublin"
            className={`${campo} w-full`}
          />
        </label>

        <button
          type="submit"
          disabled={saving}
          className="inline-flex h-9 items-center rounded-full border border-[var(--border)] px-4 text-sm hover:bg-[var(--hover)] disabled:opacity-45"
        >
          {saving ? 'Guardando…' : 'Anotar descuento'}
        </button>
      </div>

      <p className="mt-1.5 text-[11px] text-[var(--muted)]">{AYUDA_DESCUENTO[clase]}</p>

      <Aviso result={result} />
    </form>
  )
}
