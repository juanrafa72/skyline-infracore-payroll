import Link from 'next/link'
import type { ReactNode } from 'react'
import { Card } from './index'

/** Indicador con comparación contra el período anterior. */
export function Kpi({
  label,
  value,
  changePct,
  hint,
  href,
  /** true cuando subir es bueno (producción); false cuando subir es malo (costo). */
  higherIsBetter,
}: {
  label: string
  value: string
  changePct?: number | null | undefined
  hint?: string | undefined
  href?: string | undefined
  higherIsBetter?: boolean | undefined
}) {
  const body = (
    <>
      <p className="text-xs font-medium uppercase tracking-wide text-[var(--muted)]">{label}</p>
      <p className="mt-1.5 text-2xl font-semibold tabular-nums">{value}</p>
      <div className="mt-1 flex items-baseline gap-2">
        {changePct === undefined ? null : changePct === null ? (
          <span className="text-xs text-[var(--muted)]">sin base de comparación</span>
        ) : (
          <span
            className={`text-xs font-medium tabular-nums ${toneFor(changePct, higherIsBetter)}`}
          >
            {changePct > 0 ? '▲' : changePct < 0 ? '▼' : '='} {Math.abs(changePct).toFixed(1)}%
          </span>
        )}
        {hint ? <span className="text-xs text-[var(--muted)]">{hint}</span> : null}
      </div>
    </>
  )

  return (
    <Card className={href ? 'transition hover:border-[var(--accent)]' : ''}>
      {href ? <Link prefetch={false} href={href}>{body}</Link> : body}
    </Card>
  )
}

function toneFor(changePct: number, higherIsBetter?: boolean): string {
  if (changePct === 0 || higherIsBetter === undefined) return 'text-[var(--muted)]'
  const good = higherIsBetter ? changePct > 0 : changePct < 0
  return good ? 'text-emerald-700' : 'text-amber-700'
}

/** Barras horizontales: comparar magnitudes de un vistazo, sin librería de gráficos. */
export function BarList({
  rows,
  unit = '',
  empty = 'Sin datos en este período.',
}: {
  rows: ReadonlyArray<{ label: string; value: number; detail?: string; href?: string }>
  unit?: string
  empty?: string
}) {
  if (rows.length === 0) {
    return <p className="py-6 text-center text-sm text-[var(--muted)]">{empty}</p>
  }
  const max = Math.max(...rows.map((row) => row.value), 1)

  return (
    <ul className="space-y-2">
      {rows.map((row) => {
        const content = (
          <>
            <div className="flex items-baseline justify-between gap-3">
              <span className="truncate text-sm font-medium">{row.label}</span>
              <span className="shrink-0 text-sm tabular-nums">
                {row.value.toLocaleString('en-US')}
                {unit}
              </span>
            </div>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[var(--hover)]">
              <div
                className="h-full rounded-full bg-[var(--accent)]"
                style={{ width: `${Math.max((row.value / max) * 100, 1.5)}%` }}
              />
            </div>
            {row.detail ? (
              <p className="mt-1 text-xs text-[var(--muted)]">{row.detail}</p>
            ) : null}
          </>
        )
        return (
          <li key={row.label}>
            {row.href ? (
              <Link prefetch={false} href={row.href} className="block rounded p-1 hover:bg-[var(--hover)]">
                {content}
              </Link>
            ) : (
              content
            )}
          </li>
        )
      })}
    </ul>
  )
}

/** Serie temporal en columnas. Para ver la tendencia, no para decorar. */
export function TrendBars({
  points,
  empty = 'Sin historia todavía.',
}: {
  points: ReadonlyArray<{ label: string; value: number; caption?: string | undefined }>
  empty?: string
}) {
  if (points.length === 0) {
    return <p className="py-6 text-center text-sm text-[var(--muted)]">{empty}</p>
  }
  const max = Math.max(...points.map((point) => point.value), 1)

  return (
    <div className="flex h-44 gap-1.5 overflow-x-auto pb-1">
      {points.map((point) => (
        <div
          key={point.label}
          className="flex h-full min-w-[28px] flex-1 flex-col items-center justify-end gap-1"
        >
          <span className="text-[10px] tabular-nums text-[var(--muted)]">
            {point.value > 0 ? point.value.toLocaleString('en-US') : ''}
          </span>
          {/* Este contenedor sí tiene altura definida (flex-1), así el % de la barra resuelve */}
          <div className="flex w-full flex-1 items-end">
            <div
              className="w-full rounded-t bg-[var(--accent)]"
              style={{ height: `${Math.max((point.value / max) * 100, 2)}%` }}
              title={`${point.label}: ${point.value.toLocaleString('en-US')}`}
            />
          </div>
          <span className="text-[10px] text-[var(--muted)]">{point.label}</span>
          {point.caption ? (
            <span className="text-[10px] text-[var(--muted)]">{point.caption}</span>
          ) : null}
        </div>
      ))}
    </div>
  )
}

export function Panel({
  title,
  hint,
  action,
  children,
}: {
  title: string
  hint?: string | undefined
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">{title}</h2>
          {hint ? <p className="mt-0.5 text-xs text-[var(--muted)]">{hint}</p> : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  )
}
