'use client'

import { useActionState } from 'react'
import { toggleEquipmentActive } from './actions'

/**
 * Retirar un equipo de las listas, o devolverlo.
 *
 * Igual que con las personas: una máquina que ya no se usa estorba para
 * encontrar la que sí. El botón dice lo que hace y lo que NO hace — nada se
 * borra —, porque sin esa promesa a la vista nadie se atreve a usarlo.
 */
export function ToggleEquipmentActive({
  equipmentId,
  name,
  active,
}: {
  equipmentId: string
  name: string
  active: boolean
}) {
  const [result, action, saving] = useActionState(toggleEquipmentActive, null)
  const ok = result?.startsWith('LISTO|')

  return (
    <div>
      <form action={action}>
        <input type="hidden" name="equipmentId" value={equipmentId} />
        {/* Mismo botón de estado que en trabajadores: verde activo, rojo no. */}
        <button
          type="submit"
          disabled={saving}
          aria-pressed={active}
          className={`inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition disabled:opacity-45 ${
            active
              ? 'border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100'
              : 'border-red-300 bg-red-50 text-red-700 hover:bg-red-100'
          }`}
          title={
            active
              ? `${name} está activo y se ofrece en la semana. Oprime para retirarlo; no se borra nada — sus días, liquidaciones y hoja de vida quedan intactos.`
              : `${name} está inactivo: no se ofrece en la semana. Oprime para volver a usarlo.`
          }
        >
          <span
            aria-hidden
            className={`h-2 w-2 rounded-full ${active ? 'bg-emerald-500' : 'bg-red-500'}`}
          />
          {saving ? '…' : active ? 'Activo' : 'Inactivo'}
        </button>
      </form>

      {result ? (
        <p className={`mt-1 text-xs ${ok ? 'text-emerald-800' : 'text-amber-800'}`}>
          {result.replace(/^LISTO\|/, '')}
        </p>
      ) : null}
    </div>
  )
}
