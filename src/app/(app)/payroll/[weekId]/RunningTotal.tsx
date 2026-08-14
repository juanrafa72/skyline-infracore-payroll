'use client'

import { useEffect, useRef, useState } from 'react'
import { type Cents, ZERO, add, toCents, toDecimalString } from '@/lib/payroll/engine/money'
import { daysLabel, estimateWeek, type MarkedDays, type WeekEstimate } from '@/lib/payroll/estimate'

export interface WorkerRate {
  id: string
  name: string
  /** Tarifa diaria como cadena. `null` = sin tarifa: no se puede estimar. */
  rate: string | null
}

/**
 * Lo que va sumando la semana, mientras se marca.
 *
 * **Es un estimado, y lo dice.** Multiplica días por tarifa y suma los
 * adicionales: no conoce descuentos, préstamos ni reglas de la compañía. La
 * cifra buena sale de «Calcular», y llamarla total definitivo aquí haría que
 * alguien apruebe contra un número que no es.
 *
 * Lee el formulario directamente en vez de duplicar el estado de cada casilla:
 * duplicar el estado es lo que hizo que los días se guardaran mal la primera
 * vez que se armó esta pantalla.
 */
export function RunningTotal({ workers }: { workers: readonly WorkerRate[] }) {
  const anchor = useRef<HTMLDivElement>(null)
  const [totals, setTotals] = useState<WeekEstimate>(() => estimateWeek([]))
  const [open, setOpen] = useState(false)
  const [noWork, setNoWork] = useState(0)

  useEffect(() => {
    const form = anchor.current?.closest('form')
    if (!form) return

    const rateOf = new Map(workers.map((worker) => [worker.id, worker.rate]))
    const nameOf = new Map(workers.map((worker) => [worker.id, worker.name]))

    function recompute() {
      if (!form) return
      const perWorker = new Map<string, { full: number; half: number; extra: Cents }>()
      let noWork = 0

      for (const element of form.elements) {
        const named = element as HTMLInputElement | HTMLSelectElement
        if (!named.name) continue

        const day = /^day:([^:]+):/.exec(named.name)
        if (day) {
          const workerId = day[1]!
          const bucket = perWorker.get(workerId) ?? { full: 0, half: 0, extra: ZERO }
          if (named.value === 'FULL_DAY') bucket.full += 1
          else if (named.value === 'HALF_DAY') bucket.half += 1
          else if (named.value === 'NO_WORK') noWork += 1
          perWorker.set(workerId, bucket)
          continue
        }

        const extra = /^extra:([^:]+):/.exec(named.name)
        if (extra && named.value.trim() !== '') {
          const workerId = extra[1]!
          const bucket = perWorker.get(workerId) ?? { full: 0, half: 0, extra: ZERO }
          try {
            bucket.extra = add(bucket.extra, toCents(named.value.trim()))
          } catch {
            // Un monto a medio escribir («12.») no suma hasta que sea válido.
          }
          perWorker.set(workerId, bucket)
        }
      }

      const marked: MarkedDays[] = [...perWorker.entries()].map(([workerId, bucket]) => {
        const rate = rateOf.get(workerId) ?? null
        return {
          workerId,
          name: nameOf.get(workerId) ?? 'sin nombre',
          rate: rate === null ? null : toCents(rate),
          fullDays: bucket.full,
          halfDays: bucket.half,
          extra: bucket.extra,
        }
      })

      setTotals(estimateWeek(marked))
      setNoWork(noWork)
    }

    recompute()
    form.addEventListener('change', recompute)
    form.addEventListener('input', recompute)
    return () => {
      form.removeEventListener('change', recompute)
      form.removeEventListener('input', recompute)
    }
  }, [workers])

  const nothing = totals.lines.length === 0

  return (
    <div ref={anchor} className="sticky bottom-0 z-10 mt-3">
      <div className="rounded-lg border-2 border-[var(--accent)] bg-[var(--surface)] shadow-lg">
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="flex w-full flex-wrap items-center justify-between gap-3 px-4 py-3 text-left"
        >
          <div>
            <p className="brand-label text-[var(--muted)]">Va sumando</p>
            <p className="text-sm">
              <strong className="tabular-nums">{totals.daysLabel}</strong> día
              {totals.daysLabel === '1' ? '' : 's'} ·{' '}
              <span className="text-[var(--muted)]">
                {totals.lines.length} persona{totals.lines.length === 1 ? '' : 's'}
                {noWork > 0 ? ` · ${noWork} día(s) sin trabajar` : ''}
              </span>
            </p>
          </div>

          <div className="text-right">
            <p className="brand-display text-2xl tabular-nums text-[var(--ink)]">
              ${Number(toDecimalString(totals.grand)).toLocaleString('en-US', {
                minimumFractionDigits: 2,
              })}
            </p>
            <p className="text-xs text-[var(--muted)]">
              {totals.extra !== ZERO
                ? `incluye $${toDecimalString(totals.extra)} de adicionales · `
                : ''}
              {open ? 'ocultar detalle' : 'ver por persona'}
            </p>
          </div>
        </button>

        {totals.withoutRate.length > 0 ? (
          <p className="border-t border-amber-300 bg-amber-50 px-4 py-2 text-xs text-amber-900">
            <strong>{totals.withoutRate.length} sin tarifa</strong> ({totals.withoutRate.join(', ')}):
            sus días cuentan, pero su plata no está sumada aquí porque no se sabe cuánto se le paga.
          </p>
        ) : null}

        {open && !nothing ? (
          <ul className="max-h-56 overflow-y-auto border-t border-[var(--border)] px-4 py-2">
            {totals.lines.map((line) => (
              <li
                key={line.name}
                className="flex justify-between gap-3 border-b border-[var(--border)] py-1 text-sm last:border-0"
              >
                <span className="truncate">{line.name}</span>
                <span className="shrink-0 text-[var(--muted)] tabular-nums">
                  {daysLabel(line.fullDays, line.halfDays)} día
                  {daysLabel(line.fullDays, line.halfDays) === '1' ? '' : 's'}
                  {line.extra !== ZERO ? ` + $${toDecimalString(line.extra)}` : ''}
                </span>
                <span className="w-24 shrink-0 text-right font-medium tabular-nums">
                  {line.subtotal === null ? 'sin tarifa' : `$${toDecimalString(line.subtotal)}`}
                </span>
              </li>
            ))}
          </ul>
        ) : null}

        <p className="border-t border-[var(--border)] px-4 py-1.5 text-center text-xs text-[var(--muted)]">
          Estimado: días × tarifa, más adicionales. No incluye descuentos ni préstamos — el
          definitivo sale al <strong>Calcular</strong>.
        </p>
      </div>
    </div>
  )
}
