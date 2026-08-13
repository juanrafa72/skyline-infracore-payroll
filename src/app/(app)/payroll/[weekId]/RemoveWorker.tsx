'use client'

import { useActionState } from 'react'
import { removeWorkerFromPeriod } from '../actions'

/**
 * Botón de quitar a alguien del período.
 *
 * Si no se puede (porque ya tiene días marcados), el motivo sale aquí mismo
 * como aviso. Antes reventaba en una pantalla de error del sistema.
 */
export function RemoveWorker({ weekId, workerId }: { weekId: string; workerId: string }) {
  const [message, action] = useActionState(removeWorkerFromPeriod, null)
  const ok = message?.startsWith('LISTO|')

  return (
    <form action={action} className="text-right">
      <input type="hidden" name="weekId" value={weekId} />
      <input type="hidden" name="workerId" value={workerId} />
      <button
        type="submit"
        title="Quitar de esta semana"
        className="rounded border border-[var(--border)] px-1.5 py-0.5 text-xs text-[var(--muted)] hover:border-red-300 hover:text-red-700"
      >
        quitar
      </button>
      {message && !ok ? (
        <p className="mt-1 rounded border border-amber-300 bg-amber-50 p-1.5 text-left text-xs text-amber-900">
          {message}
        </p>
      ) : null}
    </form>
  )
}
