'use client'

import { type ReactNode, useRef, useState, useTransition } from 'react'

/**
 * El formulario de la rejilla de días.
 *
 * Existe por una sola razón: **que avisar de un choque no cueste el trabajo**.
 *
 * Si otra persona guardó la semana mientras esta pantalla estaba abierta, el
 * servidor no guarda y pide una nota. Si eso costara volver a marcar todo —una
 * semana de 20 personas por 7 días— el aviso saldría más caro que el problema
 * que evita. Aquí el aviso aparece dentro del mismo formulario, con lo marcado
 * intacto: se escribe el porqué y se guarda otra vez.
 *
 * **Por qué el envío es a mano y no `<form action={…}>`:** React reinicia el
 * formulario cuando la acción termina. Con un `redirect` no se nota, porque la
 * pantalla se va. Pero al quedarse —que es justo lo que hace el aviso— ese
 * reinicio deja todos los días en «—» y el proyecto en «sin proyecto», y el
 * recuadro terminaría prometiendo que las marcas siguen ahí encima de una
 * rejilla vacía. Enviando los datos por nuestra cuenta, el navegador no toca
 * nada de lo que la persona escribió.
 */
export function GuardarDias({
  action,
  abiertaEn,
  children,
}: {
  /*
   * Recibe el formulario y ya. El `FormData` tiene que ir como ÚNICO
   * argumento: llamando la acción con algo antes, lo que llega al servidor es
   * un objeto vacío —el guardado se ejecuta sin un solo día— y no avisa.
   */
  action: (formData: FormData) => Promise<RespuestaGuardado>
  /** Cuándo se armó esta pantalla; con eso el servidor detecta el choque. */
  abiertaEn: string
  children: ReactNode
}) {
  const formulario = useRef<HTMLFormElement>(null)
  const [estado, setEstado] = useState<RespuestaGuardado>(null)
  const [enviando, empezar] = useTransition()

  return (
    <form
      ref={formulario}
      onSubmit={(evento) => {
        evento.preventDefault()
        const datos = new FormData(evento.currentTarget)
        empezar(async () => {
          setEstado(await action(datos))
        })
      }}
    >
      <input type="hidden" name="abiertaEn" value={abiertaEn} />

      {estado?.conflicto ? (
        <div className="mb-4 rounded-lg border-2 border-amber-400 bg-amber-50 p-4 text-sm text-amber-900">
          <p className="font-semibold">
            {estado.conflicto.quien} guardó cambios mientras tenías esta pantalla abierta
          </p>
          <p className="mt-1">
            No se guardó nada todavía. Lo que marcaste sigue aquí: si guardas así, lo que hizo{' '}
            {estado.conflicto.quien} se reemplaza por lo que ves en pantalla.
          </p>

          <label className="mt-3 block max-w-lg">
            <span className="mb-1 block font-medium">
              Escribe por qué lo vas a cambiar y vuelve a guardar
            </span>
            <input
              name="notaCambio"
              placeholder="Ej.: marcó mal el jueves de Hugo, lo corrijo"
              className="h-9 w-full rounded-lg border border-amber-400 bg-white px-3 text-sm"
            />
          </label>
          <p className="mt-2 text-xs">
            La nota queda registrada con tu nombre. Si prefieres ver primero lo que hizo, recarga
            la página — pero se pierde lo que marcaste ahora.
          </p>
        </div>
      ) : null}

      {/*
        Mientras guarda, el formulario se atenúa y no recibe clics: sin esto,
        dos clics seguidos mandan la semana dos veces.
      */}
      <fieldset disabled={enviando} className={enviando ? 'opacity-60' : undefined}>
        {children}
      </fieldset>
    </form>
  )
}

/** Lo que responde el guardado. `null` = todavía no se ha intentado. */
export type RespuestaGuardado = {
  conflicto?: { quien: string; mensaje: string }
} | null
