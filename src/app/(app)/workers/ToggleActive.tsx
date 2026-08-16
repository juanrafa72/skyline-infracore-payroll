'use client'

import { useActionState } from 'react'
import { toggleWorkerActive } from './actions'

/**
 * Sacar a alguien de las listas, o devolverlo.
 *
 * El negocio lo pidió por un caso concreto: al subirle la tarifa a alguien se
 * crea una ficha nueva —JHON $100 pasa a ser JHON1 $130— y la vieja sigue
 * apareciendo al escoger gente. Con dos JHON en la lista es cuestión de tiempo
 * marcar el equivocado y pagarle la tarifa vieja.
 *
 * El botón dice lo que hace y lo que NO hace: nada se borra. Sin esa promesa
 * a la vista, nadie se atreve a usarlo por miedo a perder el histórico.
 */
export function ToggleWorkerActive({
  workerId,
  name,
  active,
}: {
  workerId: string
  name: string
  active: boolean
}) {
  const [result, action, saving] = useActionState(toggleWorkerActive, null)
  const ok = result?.startsWith('LISTO|')

  return (
    <div>
      <form action={action}>
        <input type="hidden" name="workerId" value={workerId} />
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
              ? `Saca a ${name} de las listas al armar una semana. No se borra nada: sus días, nóminas y pagos quedan intactos.`
              : `Vuelve a ofrecer a ${name} al armar una semana.`
          }
        >
          {saving ? '…' : active ? 'Sacar de las listas' : 'Volver a las listas'}
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
