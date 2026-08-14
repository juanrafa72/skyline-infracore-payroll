'use client'

import { useActionState, useState } from 'react'
import { Button, Field } from '@/components/ui'
import { createCrewPricing } from '../actions'

export interface PricingOption {
  value: string
  label: string
}

/**
 * Negociación por unidad de una cuadrilla: los dos precios juntos.
 *
 * Se muestran lado a lado y con el margen calculado en vivo, porque la
 * pregunta que hay que poder responder al pactar no es "¿cuánto le pago?"
 * sino "¿esto deja plata?".
 */
export function PricingForm({
  crewId,
  projects,
  customers,
  today,
}: {
  crewId: string
  projects: readonly PricingOption[]
  customers: readonly PricingOption[]
  today: string
}) {
  const [result, submit, saving] = useActionState(createCrewPricing, null)
  const [cost, setCost] = useState('')
  const [sale, setSale] = useState('')

  const costNumber = Number(cost)
  const saleNumber = Number(sale)
  const bothSet = cost !== '' && sale !== '' && !Number.isNaN(costNumber) && !Number.isNaN(saleNumber)
  const perUnit = bothSet ? saleNumber - costNumber : null
  const losing = perUnit !== null && perUnit < 0

  const ok = result !== null && result.startsWith('LISTO|')
  const warns = ok && result.includes('OJO:')

  return (
    <form action={submit} className="mt-4">
      <input type="hidden" name="crewId" value={crewId} />

      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <Field label="Concepto" name="unitLabel" required placeholder="Strand" />
        <Field label="Código" name="unitCode" required placeholder="STRAND" />
        <Field
          label="Medida"
          name="unitOfMeasure"
          options={[
            { value: 'FOOT', label: 'Pie' },
            { value: 'METER', label: 'Metro' },
            { value: 'EACH', label: 'Unidad' },
            { value: 'LOT', label: 'Lote' },
          ]}
        />
        <Field
          label="Proyecto"
          name="projectId"
          options={[
            { value: '', label: '— todos —' },
            ...projects.map((project) => ({ value: project.value, label: project.label })),
          ]}
        />
      </div>

      {/* Los dos lados del negocio, uno al lado del otro */}
      <div className="mt-3 rounded-lg border border-[var(--border)] bg-[var(--hover)] p-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
          Cuánto se cobra y cuánto se paga por cada unidad
        </p>

        <div className="mt-2.5 grid gap-3 sm:grid-cols-3">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-[var(--muted)]">
              Nos pagan (venta)
            </span>
            <input
              name="salePricePerUnit"
              value={sale}
              onChange={(event) => setSale(event.target.value)}
              placeholder="1.00"
              className="h-9 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-2.5 text-sm outline-none focus:border-[var(--accent)]"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-medium text-[var(--muted)]">
              Le pagamos a la cuadrilla (costo)<span className="text-red-600"> *</span>
            </span>
            <input
              name="pricePerUnit"
              required
              value={cost}
              onChange={(event) => setCost(event.target.value)}
              placeholder="0.50"
              className="h-9 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-2.5 text-sm outline-none focus:border-[var(--accent)]"
            />
          </label>

          <div className="flex flex-col justify-end">
            <span className="mb-1 block text-xs font-medium text-[var(--muted)]">
              Deja por unidad
            </span>
            <p
              className={`flex h-9 items-center text-lg font-semibold tabular-nums ${
                losing ? 'text-red-700' : perUnit === null ? 'text-[var(--muted)]' : ''
              }`}
            >
              {perUnit === null ? '—' : `$${perUnit.toFixed(4)}`}
            </p>
          </div>
        </div>

        {sale !== '' ? (
          <div className="mt-2.5">
            <Field
              label="Cliente que paga la venta"
              name="customerId"
              required
              options={[
                { value: '', label: '— escoge el cliente —' },
                ...customers.map((customer) => ({
                  value: customer.value,
                  label: customer.label,
                })),
              ]}
              hint="Sin cliente no hay a quién cobrarle, y la venta no se puede contar."
            />
          </div>
        ) : (
          <p className="mt-2 text-xs text-[var(--muted)]">
            El precio de venta es opcional. Sin él la unidad se paga igual, pero no suma margen
            porque no se sabe cuánto se cobra.
          </p>
        )}

        {losing ? (
          <p className="mt-2 rounded-md border border-red-300 bg-red-50 p-2 text-xs text-red-800">
            Se le paga a la cuadrilla más de lo que se cobra. Se puede guardar —a veces se hace a
            propósito— pero cada unidad producida pierde ${Math.abs(perUnit).toFixed(4)}.
          </p>
        ) : null}
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <Field label="Desde" name="effectiveFrom" type="date" required defaultValue={today} />
        <Field label="Hasta" name="effectiveTo" type="date" hint="Vacío = sin fin" />
        <Field label="Nota" name="notes" placeholder="Acordado con el encargado" />
      </div>

      {result ? (
        <p
          className={`mt-3 rounded-md border p-2.5 text-sm ${
            warns
              ? 'border-red-300 bg-red-50 text-red-800'
              : ok
                ? 'border-emerald-300 bg-emerald-50 text-emerald-900'
                : 'border-amber-300 bg-amber-50 text-amber-900'
          }`}
        >
          {result.replace(/^LISTO\|/, '')}
        </p>
      ) : null}

      <div className="mt-3">
        <Button disabled={saving}>{saving ? 'Guardando…' : 'Agregar precio'}</Button>
      </div>
    </form>
  )
}
