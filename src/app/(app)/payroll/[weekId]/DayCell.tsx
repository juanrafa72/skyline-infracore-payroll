'use client'

import { useState } from 'react'

const OPTIONS = [
  { value: '', label: '—' },
  { value: 'FULL_DAY', label: 'Sí' },
  { value: 'HALF_DAY', label: '½' },
  { value: 'NO_WORK', label: 'No' },
  { value: 'PLUS', label: 'Sí +' },
] as const

/**
 * Casilla de un día.
 *
 * "Sí +" abre dos campos: cuánto se le suma ese día y por qué. La nota es
 * obligatoria — la base de datos rechaza un monto sin explicación, así que el
 * formulario lo pide antes de dejar guardar.
 */
export function DayCell({
  workerId,
  day,
  dayType,
  amount,
  note,
  compact,
}: {
  workerId: string
  day: string
  dayType: string
  amount: string
  note: string
  compact?: boolean
}) {
  const hasExtra = amount !== '' && amount !== '0.00'
  const [selection, setSelection] = useState(hasExtra ? 'PLUS' : dayType)
  const showExtra = selection === 'PLUS'

  return (
    <div className="w-full">
      <select
        // Sin nombre cuando hay extra: el valor lo envía el campo oculto.
        // Dos campos con el mismo nombre se pisan entre sí al enviar.
        {...(showExtra ? {} : { name: `day:${workerId}:${day}` })}
        value={selection}
        onChange={(event) => setSelection(event.target.value)}
        className="h-8 w-full min-w-[52px] rounded border border-[var(--border)] bg-[var(--surface)] px-1 text-center text-sm outline-none focus:border-[var(--accent)]"
      >
        {OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>

      {/* Cuando se elige "Sí +", el día se envía como completo y aparte va el extra */}
      {showExtra ? (
        <>
          <input type="hidden" name={`day:${workerId}:${day}`} value="FULL_DAY" />
          <div className={compact ? 'mt-1 space-y-1' : 'mt-1 space-y-1'}>
            <input
              name={`extra:${workerId}:${day}`}
              defaultValue={hasExtra ? amount : ''}
              inputMode="decimal"
              placeholder="$ extra"
              required
              className="h-7 w-full rounded border border-amber-400 bg-amber-50 px-1 text-center text-xs outline-none"
            />
            <input
              name={`nota:${workerId}:${day}`}
              defaultValue={note}
              placeholder="¿por qué?"
              required
              title="Obligatorio: todo monto adicional necesita explicación"
              className="h-7 w-full rounded border border-amber-400 bg-amber-50 px-1 text-center text-[11px] outline-none"
            />
          </div>
        </>
      ) : null}
    </div>
  )
}
