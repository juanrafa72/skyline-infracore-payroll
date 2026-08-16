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
        <button
          type="submit"
          disabled={saving}
          className={`inline-flex h-8 items-center rounded-full border px-3 text-xs transition disabled:opacity-45 ${
            active
              ? 'border-[var(--border)] hover:bg-[var(--hover)]'
              : 'border-emerald-300 text-emerald-800 hover:bg-emerald-50'
          }`}
          title={
            active
              ? `Saca ${name} de la semana. No se borra nada: sus días, liquidaciones y hoja de vida quedan intactos.`
              : `Vuelve a ofrecer ${name} en la semana.`
          }
        >
          {saving ? '…' : active ? 'Retirar' : 'Volver a usar'}
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
