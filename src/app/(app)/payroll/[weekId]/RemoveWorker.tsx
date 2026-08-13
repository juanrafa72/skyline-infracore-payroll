'use client'

import { useState, useTransition } from 'react'
import { removeWorkerFromPeriod } from '../actions'

/**
 * Quitar a alguien de la semana.
 *
 * SIN formulario propio, a propósito: este botón vive dentro del formulario de
 * los días, y un <form> dentro de otro <form> es HTML inválido — el navegador
 * descarta el de adentro y el botón termina enviando el formulario equivocado.
 * Fue exactamente el error que llegó a producción. La acción se llama directo.
 */
export function RemoveWorker({
  weekId,
  workerId,
  name,
  markedDays,
}: {
  weekId: string
  workerId: string
  name: string
  markedDays: number
}) {
  const [pending, startTransition] = useTransition()
  const [message, setMessage] = useState<string | null>(null)

  return (
    <div className="text-right">
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          // Si va a borrar días ya marcados, se pregunta primero.
          if (
            markedDays > 0 &&
            !window.confirm(
              `¿Sacar a ${name} de esta semana?\n\nSe borrarán sus ${markedDays} día(s) marcado(s).`,
            )
          ) {
            return
          }
          setMessage(null)
          const data = new FormData()
          data.set('weekId', weekId)
          data.set('workerId', workerId)
          startTransition(async () => {
            const result = await removeWorkerFromPeriod(null, data)
            if (!result.startsWith('LISTO|')) setMessage(result)
          })
        }}
        title={markedDays > 0 ? `Sacar de la semana y borrar sus ${markedDays} día(s)` : 'Sacar de la semana'}
        className="rounded border border-[var(--border)] px-2 py-0.5 text-xs text-[var(--muted)] transition hover:border-red-300 hover:text-red-700 disabled:opacity-50"
      >
        {pending ? '…' : 'quitar'}
      </button>

      {message ? (
        <p className="mt-1 rounded border border-amber-300 bg-amber-50 p-1.5 text-left text-xs text-amber-900">
          {message}
        </p>
      ) : null}
    </div>
  )
}
