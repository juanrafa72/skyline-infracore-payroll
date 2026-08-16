'use client'

import { useActionState } from 'react'
import { useRouter } from 'next/navigation'
import { calcularCuadrillasDeLaSemana } from './actions'

/**
 * Escoger cuál cuadrilla y por cuál semana.
 *
 * Los dos selectores mandan a la misma dirección con los filtros puestos: así
 * la vista se puede guardar en favoritos o mandar por chat —«mira la 25 de
 * Hugo»— y sobrevive a recargar la página.
 */
export function Escoger({
  cuadrillas,
  semanas,
  crewId,
  weekId,
}: {
  cuadrillas: ReadonlyArray<{ id: string; name: string; contractorName: string | null }>
  semanas: ReadonlyArray<{ id: string; label: string }>
  crewId: string
  weekId: string | null
}) {
  const router = useRouter()
  const [result, action, saving] = useActionState(calcularCuadrillasDeLaSemana, null)
  const ok = result?.startsWith('LISTO|')

  const ir = (crew: string, semana: string | null) => {
    const url = new URLSearchParams({ crew })
    if (semana) url.set('semana', semana)
    router.push(`/liquidar-cuadrillas?${url.toString()}`)
  }

  return (
    <div className="mb-5 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm">
          <span className="mb-1 block text-xs text-[var(--muted)]">Cuadrilla</span>
          <select
            value={crewId}
            onChange={(evento) => ir(evento.target.value, null)}
            className="h-9 min-w-64 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-2 text-sm"
          >
            {cuadrillas.map((crew) => (
              <option key={crew.id} value={crew.id}>
                {crew.name}
                {crew.contractorName ? ` — se le paga a ${crew.contractorName}` : ' — SIN contratista'}
              </option>
            ))}
          </select>
          {/*
            Al cambiar de cuadrilla NO se conserva la semana: cada una va por
            la suya, y arrastrar la semana de la anterior es justo el error que
            esta pantalla evita.
          */}
          <span className="mt-0.5 block text-[11px] text-[var(--muted)]">
            Al cambiarla se propone SU última semana.
          </span>
        </label>

        <label className="text-sm">
          <span className="mb-1 block text-xs text-[var(--muted)]">Semana que se paga</span>
          <select
            value={weekId ?? ''}
            onChange={(evento) => ir(crewId, evento.target.value)}
            className="h-9 min-w-48 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-2 text-sm"
          >
            {semanas.map((semana) => (
              <option key={semana.id} value={semana.id}>
                {semana.label}
              </option>
            ))}
          </select>
        </label>

        {weekId ? (
          <form action={action}>
            <input type="hidden" name="weekId" value={weekId} />
            <button
              type="submit"
              disabled={saving}
              className="brand-gradient inline-flex h-9 items-center rounded-full px-4 text-sm font-medium text-white disabled:opacity-45"
              title="Vuelve la producción capturada en una liquidación al contratista."
            >
              {saving ? 'Calculando…' : 'Calcular esta semana'}
            </button>
          </form>
        ) : null}
      </div>

      {result ? (
        <p
          className={`mt-3 rounded-md border p-2.5 text-sm ${
            ok
              ? 'border-emerald-300 bg-emerald-50 text-emerald-900'
              : 'border-amber-300 bg-amber-50 text-amber-900'
          }`}
        >
          {result.replace(/^LISTO\|/, '')}
        </p>
      ) : null}
    </div>
  )
}
