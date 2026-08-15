'use client'

import { useActionState } from 'react'
import { deleteProduction } from './actions'

/**
 * Borrar un registro de producción, con respuesta visible.
 *
 * Si la liquidación de la cuadrilla ya movió dinero, el servicio lo rechaza y
 * el motivo aparece aquí mismo — antes borraba sin preguntar nada.
 */
export function DeleteProductionButton({ id }: { id: string }) {
  const [result, action, deleting] = useActionState(deleteProduction, null)
  const failed = result !== null && !result.startsWith('LISTO|')

  return (
    <form action={action}>
      <input type="hidden" name="id" value={id} />
      <button
        type="submit"
        disabled={deleting}
        className="rounded border border-[var(--border)] px-1.5 py-0.5 text-xs text-[var(--muted)] hover:border-red-300 hover:text-red-700 disabled:opacity-45"
      >
        {deleting ? '…' : 'borrar'}
      </button>
      {failed ? <p className="mt-1 max-w-[220px] text-right text-xs text-red-700">{result}</p> : null}
    </form>
  )
}
