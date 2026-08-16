'use client'

import Link from 'next/link'
import { useActionState } from 'react'
import { sendOrderReport } from './actions'

/**
 * Mandar el desprendible por correo a quien esté configurado.
 *
 * El resultado se muestra completo, incluido el fallo: si el correo no salió,
 * hay que saberlo en el momento. Un botón que se pone verde pase lo que pase
 * hace creer que contabilidad ya tiene el soporte.
 */
export function SendReport({ orderId }: { orderId: string }) {
  const [result, action, sending] = useActionState(sendOrderReport, null)
  const ok = result?.startsWith('LISTO|')

  return (
    <>
      <form action={action}>
        <input type="hidden" name="orderId" value={orderId} />
        <button
          type="submit"
          disabled={sending}
          className="inline-flex h-9 items-center rounded-md border border-[var(--border)] px-3 text-sm hover:bg-[var(--hover)] disabled:opacity-45"
          title="Manda el PDF a la auxiliar contable y a la empresa receptora, con su consecutivo"
        >
          {sending ? 'Enviando…' : 'Enviar por correo'}
        </button>
      </form>

      {result ? (
        <span
          className={`inline-flex items-center gap-2 rounded-md border px-2.5 py-1 text-xs ${
            ok
              ? 'border-emerald-300 bg-emerald-50 text-emerald-900'
              : 'border-amber-300 bg-amber-50 text-amber-900'
          }`}
        >
          {result.replace(/^LISTO\|/, '')}
          {!ok ? (
            <Link prefetch={false} href="/report-recipients" className="font-medium underline">
              configurar
            </Link>
          ) : null}
        </span>
      ) : null}
    </>
  )
}
