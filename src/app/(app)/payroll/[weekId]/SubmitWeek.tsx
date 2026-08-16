'use client'

import Link from 'next/link'
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
  crews,
  equipment,
  blockedByErrors,
  alreadySent,
  highlight = false,
}: {
  payrolls: ReadonlyArray<{ id: string; name: string; net: string }>
  /** Liquidaciones de cuadrilla y de equipo listas para el mismo envío. */
  crews: ReadonlyArray<{ id: string; name: string; net: string }>
  equipment: ReadonlyArray<{ id: string; name: string; net: string }>
  blockedByErrors: number
  alreadySent: number
  /** Viene de calcular: este es el paso siguiente y late para señalarlo. */
  highlight?: boolean
}) {
  const [result, action] = useActionState(submitWeek, null)
  const ok = result?.startsWith('LISTO|')
  const total =
    payrolls.reduce((sum, row) => sum + Number(row.net), 0) +
    crews.reduce((sum, row) => sum + Number(row.net), 0) +
    equipment.reduce((sum, row) => sum + Number(row.net), 0)

  if (payrolls.length === 0 && crews.length === 0 && equipment.length === 0) {
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
        <div
          className={`mb-3 rounded-md border p-2.5 text-sm ${
            ok
              ? 'border-emerald-300 bg-emerald-50 text-emerald-900'
              : 'border-amber-300 bg-amber-50 text-amber-900'
          }`}
        >
          <p>{result.replace(/^(LISTO|PARCIAL)\|/, '')}</p>

          {/*
            Ya se envió: lo que sigue está en OTRA pantalla. Sin la señal, uno
            se queda mirando una semana que ya no tiene nada que hacer.
          */}
          {ok ? (
            <Link
              prefetch={false}
              href="/approvals"
              className="paso-siguiente mt-2 inline-flex h-9 items-center rounded-full bg-[var(--accent)] px-4 text-sm font-medium text-white hover:opacity-90"
            >
              Ir a aprobar →
            </Link>
          ) : null}
        </div>
      ) : null}

      <p className="text-sm font-semibold">Enviar a aprobación</p>
      <p className="mt-1 text-xs text-[var(--muted)]">
        {payrolls.length} nómina(s)
        {crews.length > 0 ? ` + ${crews.length} cuadrilla(s)` : ''}
        {equipment.length > 0 ? ` + ${equipment.length} equipo(s)` : ''} · $
        {total.toLocaleString('en-US', { minimumFractionDigits: 2 })} en total. Una vez enviadas
        no las puedes editar hasta que quien aprueba las devuelva.
      </p>

      {crews.length > 0 || equipment.length > 0 ? (
        <ul className="mt-1.5 text-xs text-[var(--muted)]">
          {crews.map((crew) => (
            <li key={crew.id}>
              Cuadrilla {crew.name} · ${Number(crew.net).toLocaleString('en-US', { minimumFractionDigits: 2 })} al contratista
            </li>
          ))}
          {equipment.map((machine) => (
            <li key={machine.id}>
              Equipo {machine.name} · ${Number(machine.net).toLocaleString('en-US', { minimumFractionDigits: 2 })} al proveedor
            </li>
          ))}
        </ul>
      ) : null}

      {blockedByErrors > 0 ? (
        <p className="mt-3 rounded-md border border-red-300 bg-red-50 p-2.5 text-sm text-red-700">
          Hay {blockedByErrors} error(es) crítico(s) sin resolver. Corrígelos antes de enviar.
        </p>
      ) : (
        <form action={action} className="mt-3">
          {payrolls.map((payroll) => (
            <input key={payroll.id} type="hidden" name="payrollId" value={payroll.id} />
          ))}
          {crews.map((crew) => (
            <input key={crew.id} type="hidden" name="crewPayrollId" value={crew.id} />
          ))}
          {equipment.map((machine) => (
            <input key={machine.id} type="hidden" name="equipmentPayrollId" value={machine.id} />
          ))}
          <button
            type="submit"
            className={`h-9 rounded-md bg-[var(--accent)] px-4 text-sm font-medium text-white hover:opacity-90${
              highlight ? ' paso-siguiente' : ''
            }`}
          >
            Enviar {payrolls.length + crews.length + equipment.length} a aprobación
          </button>
        </form>
      )}
    </div>
  )
}
