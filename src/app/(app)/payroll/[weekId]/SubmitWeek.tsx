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
  weekId,
  payrolls,
  crews,
  equipment,
  blockedByErrors,
  alreadySent,
  highlight = false,
  faltaPorRegistrar = null,
}: {
  weekId: string
  payrolls: ReadonlyArray<{ id: string; name: string; net: string }>
  /** Liquidaciones de cuadrilla y de equipo listas para el mismo envío. */
  crews: ReadonlyArray<{ id: string; name: string; net: string }>
  equipment: ReadonlyArray<{ id: string; name: string; net: string }>
  blockedByErrors: number
  alreadySent: number
  /** Viene de calcular: este es el paso siguiente y late para señalarlo. */
  highlight?: boolean
  /**
   * Qué días de la semana quedaron sin registrar, dicho en una frase. `null`
   * cuando está todo. NO bloquea: avisa. Una semana puede cerrarse antes de
   * tiempo, pero nadie debería enviarla sin darse cuenta de que le faltan días.
   */
  faltaPorRegistrar?: string | null
}) {
  const [result, action] = useActionState(submitWeek, null)
  const ok = result?.startsWith('LISTO|')
  const suma = (filas: ReadonlyArray<{ net: string }>) =>
    filas.reduce((total, fila) => total + Number(fila.net), 0)
  const totalPersonal = suma(payrolls)
  const totalEquipo = suma(equipment)
  const totalCuadrillas = suma(crews)
  const total = totalPersonal + totalEquipo + totalCuadrillas
  const money = (valor: number) =>
    valor.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

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
            <>
              <Link
                prefetch={false}
                href={`/resumen/ultimo?semana=${weekId}`}
                className="mt-2 mr-2 inline-flex h-9 items-center rounded-full border border-emerald-300 bg-white px-4 text-sm font-medium hover:bg-emerald-100"
              >
                Ver el resumen
              </Link>
              <Link
                prefetch={false}
                href="/approvals"
              className="paso-siguiente mt-2 inline-flex h-9 items-center rounded-full bg-[var(--accent)] px-4 text-sm font-medium text-white hover:opacity-90"
              >
                Ir a aprobar →
              </Link>
            </>
          ) : null}
        </div>
      ) : null}

      <p className="text-sm font-semibold">Enviar a aprobación</p>

      {/*
        El último visto bueno antes de que salga de sus manos.
        Lo pidió el negocio: ver QUÉ se está mandando y por cuánto, en vez de
        oprimir un botón que dice un número suelto. Al enviar, este mismo
        resumen queda congelado con un consecutivo — BR-440…444.
      */}
      <table className="mt-2 w-full max-w-sm text-sm">
        <tbody>
          <tr>
            <td className="py-0.5">Personal</td>
            <td className="py-0.5 text-right text-xs text-[var(--muted)]">
              {payrolls.length} persona{payrolls.length === 1 ? '' : 's'}
            </td>
            <td className="py-0.5 text-right tabular-nums">${money(totalPersonal)}</td>
          </tr>
          <tr>
            <td className="py-0.5">Equipo rentado</td>
            <td className="py-0.5 text-right text-xs text-[var(--muted)]">
              {equipment.length} equipo{equipment.length === 1 ? '' : 's'}
            </td>
            <td className="py-0.5 text-right tabular-nums">${money(totalEquipo)}</td>
          </tr>
          <tr>
            <td className="py-0.5">Cuadrillas</td>
            <td className="py-0.5 text-right text-xs text-[var(--muted)]">
              {crews.length} cuadrilla{crews.length === 1 ? '' : 's'}
            </td>
            <td className="py-0.5 text-right tabular-nums">${money(totalCuadrillas)}</td>
          </tr>
          <tr className="border-t border-[var(--border)]">
            <td className="py-1 font-semibold" colSpan={2}>
              Total a aprobar
            </td>
            <td className="py-1 text-right font-semibold tabular-nums">${money(total)}</td>
          </tr>
        </tbody>
      </table>

      <p className="mt-1 text-xs text-[var(--muted)]">
        Una vez enviadas no las puedes editar hasta que quien aprueba las devuelva.
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

      {faltaPorRegistrar ? (
        <p className="mt-3 rounded-md border border-amber-300 bg-amber-50 p-2.5 text-sm text-amber-900">
          <strong>Ojo:</strong> {faltaPorRegistrar} Lo que no quede registrado no se paga en esta
          semana.
        </p>
      ) : null}

      {blockedByErrors > 0 ? (
        <p className="mt-3 rounded-md border border-red-300 bg-red-50 p-2.5 text-sm text-red-700">
          Hay {blockedByErrors} error(es) crítico(s) sin resolver. Corrígelos antes de enviar.
        </p>
      ) : (
        <form action={action} className="mt-3">
          <input type="hidden" name="weekId" value={weekId} />
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
