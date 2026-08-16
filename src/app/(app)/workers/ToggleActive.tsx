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
 * El botón muestra el ESTADO —verde activo, rojo inactivo— y cambia al
 * oprimirlo. Que nada se borra se dice al pasar el mouse: sin esa promesa,
 * nadie se atreve a usarlo por miedo a perder el histórico.
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
        {/*
          UN solo botón que cambia de color, como lo pidió el negocio: verde
          activo, rojo inactivo. Antes decía la ACCIÓN («sacar de las listas»),
          que obliga a leer para saber en qué estado está; ahora dice el ESTADO,
          que es lo que uno viene a mirar cuando recorre la lista.
        */}
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
              ? `${name} está activo. Oprime para sacarlo de las listas al armar una semana; no se borra nada — sus días, nóminas y pagos quedan intactos.`
              : `${name} está inactivo: no sale en las listas. Oprime para volver a ofrecerlo.`
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
