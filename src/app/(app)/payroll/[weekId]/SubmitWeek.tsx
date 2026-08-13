'use client'

import { useActionState } from 'react'
import { submitWeek } from '../../approvals/actions'

/**
 * Enviar la semana a aprobación.
 *
 * Se bloquea si quedan errores críticos abiertos: una nómina con un error sin
 * resolver no debería llegar a la mesa de quien aprueba.
 */
export function SubmitWeek({
  payrolls,
  blockedByErrors,
  alreadySent,
}: {
  payrolls: ReadonlyArray<{ id: string; name: string; net: string }>
  blockedByErrors: number
  alreadySent: number
}) {
  const [result, action] = useActionState(submitWeek, null)
  const ok = result?.startsWith('LISTO|')
  const total = payrolls.reduce((sum, row) => sum + Number(row.net), 0)

  if (payrolls.length === 0) {
    return (
      <div className="mt-6 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 text-sm">
        {alreadySent > 0 ? (
          <p>
            <strong>{alreadySent} nómina(s) ya están esperando aprobación.</strong> Quien aprueba
            las verá en su pantalla.
          </p>
        ) : (
          <p className="text-[var(--muted)]">
            Marca los días y presiona «Calcular nómina» para poder enviar a aprobación.
          </p>
        )}
      </div>
    )
  }

  return (
    <div className="mt-6 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
      {result ? (
        <p
          className={`mb-3 rounded-md border p-2.5 text-sm ${
            ok
              ? 'border-emerald-300 bg-emerald-50 text-emerald-900'
              : 'border-amber-300 bg-amber-50 text-amber-900'
          }`}
        >
          {result.replace(/^(LISTO|PARCIAL)\|/, '')}
        </p>
      ) : null}

      <p className="text-sm font-semibold">Enviar a aprobación</p>
      <p className="mt-1 text-xs text-[var(--muted)]">
        {payrolls.length} nómina(s) · $
        {total.toLocaleString('en-US', { minimumFractionDigits: 2 })} en total. Una vez enviadas
        no las puedes editar hasta que quien aprueba las devuelva.
      </p>

      {blockedByErrors > 0 ? (
        <p className="mt-3 rounded-md border border-red-300 bg-red-50 p-2.5 text-sm text-red-700">
          Hay {blockedByErrors} error(es) crítico(s) sin resolver. Corrígelos antes de enviar.
        </p>
      ) : (
        <form action={action} className="mt-3">
          {payrolls.map((payroll) => (
            <input key={payroll.id} type="hidden" name="payrollId" value={payroll.id} />
          ))}
          <button
            type="submit"
            className="h-9 rounded-md bg-[var(--accent)] px-4 text-sm font-medium text-white hover:opacity-90"
          >
            Enviar {payrolls.length} a aprobación
          </button>
        </form>
      )}
    </div>
  )
}
