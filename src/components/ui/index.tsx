import Link from 'next/link'
import type { ReactNode } from 'react'

export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string
  subtitle?: string
  action?: ReactNode
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3 border-b border-[var(--border)] pb-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{title}</h1>
        {subtitle ? <p className="mt-1 text-sm text-[var(--muted)]">{subtitle}</p> : null}
      </div>
      {action}
    </div>
  )
}

export function Button({
  children,
  variant = 'primary',
  type = 'submit',
  disabled,
  title,
}: {
  children: ReactNode
  variant?: 'primary' | 'secondary' | 'danger'
  type?: 'submit' | 'button'
  disabled?: boolean
  title?: string
}) {
  const styles = {
    primary: 'bg-[var(--accent)] text-white hover:opacity-90',
    secondary: 'border border-[var(--border)] bg-[var(--surface)] hover:bg-[var(--hover)]',
    danger: 'border border-red-300 text-red-700 hover:bg-red-50',
  }[variant]
  return (
    <button
      type={type}
      disabled={disabled}
      title={title}
      className={`inline-flex h-9 items-center rounded-md px-3.5 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-45 ${styles}`}
    >
      {children}
    </button>
  )
}

export function LinkButton({
  href,
  children,
  variant = 'primary',
}: {
  href: string
  children: ReactNode
  variant?: 'primary' | 'secondary'
}) {
  const styles =
    variant === 'primary'
      ? 'bg-[var(--accent)] text-white hover:opacity-90'
      : 'border border-[var(--border)] hover:bg-[var(--hover)]'
  return (
    <Link
      href={href}
      className={`inline-flex h-9 items-center rounded-md px-3.5 text-sm font-medium transition ${styles}`}
    >
      {children}
    </Link>
  )
}

export function Field({
  label,
  name,
  type = 'text',
  required,
  defaultValue,
  placeholder,
  hint,
  step,
  options,
}: {
  label: string
  name: string
  type?: string
  required?: boolean
  defaultValue?: string | number | null
  placeholder?: string
  hint?: string
  step?: string
  options?: ReadonlyArray<{ value: string; label: string }>
}) {
  const base =
    'h-9 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-2.5 text-sm outline-none focus:border-[var(--accent)]'
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-[var(--muted)]">
        {label}
        {required ? <span className="text-red-600"> *</span> : null}
      </span>
      {options ? (
        <select name={name} required={required} defaultValue={defaultValue ?? ''} className={base}>
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      ) : (
        <input
          name={name}
          type={type}
          step={step}
          required={required}
          defaultValue={defaultValue ?? ''}
          placeholder={placeholder}
          className={base}
        />
      )}
      {hint ? <span className="mt-1 block text-xs text-[var(--muted)]">{hint}</span> : null}
    </label>
  )
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 ${className}`}>
      {children}
    </div>
  )
}

export function Stat({
  label,
  value,
  hint,
  tone = 'default',
}: {
  label: string
  value: string
  hint?: string
  tone?: 'default' | 'warning' | 'good'
}) {
  const toneClass = {
    default: '',
    warning: 'text-amber-700',
    good: 'text-emerald-700',
  }[tone]
  return (
    <Card>
      <p className="text-xs font-medium uppercase tracking-wide text-[var(--muted)]">{label}</p>
      <p className={`mt-1.5 text-xl font-semibold tabular-nums ${toneClass}`}>{value}</p>
      {hint ? <p className="mt-1 text-xs text-[var(--muted)]">{hint}</p> : null}
    </Card>
  )
}

export function EmptyState({ title, hint, action }: { title: string; hint: string; action?: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-[var(--border)] p-10 text-center">
      <p className="text-sm font-medium">{title}</p>
      <p className="mx-auto mt-1 max-w-md text-sm text-[var(--muted)]">{hint}</p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  )
}

export function Badge({
  children,
  tone = 'neutral',
}: {
  children: ReactNode
  tone?: 'neutral' | 'warning' | 'critical' | 'good' | 'info'
}) {
  const styles = {
    neutral: 'border-[var(--border)] text-[var(--muted)]',
    warning: 'border-amber-300 bg-amber-50 text-amber-800',
    critical: 'border-red-300 bg-red-50 text-red-700',
    good: 'border-emerald-300 bg-emerald-50 text-emerald-700',
    info: 'border-sky-300 bg-sky-50 text-sky-800',
  }[tone]
  return (
    <span className={`inline-flex items-center rounded border px-1.5 py-0.5 text-xs font-medium ${styles}`}>
      {children}
    </span>
  )
}

/** Tabla en desktop, tarjetas en móvil. Nunca scroll horizontal gigante. */
export function DataTable<T>({
  rows,
  columns,
  href,
  empty,
}: {
  rows: readonly T[]
  columns: ReadonlyArray<{
    key: string
    header: string
    render: (row: T) => ReactNode
    align?: 'left' | 'right'
    primary?: boolean
  }>
  href?: (row: T) => string
  empty: ReactNode
}) {
  if (rows.length === 0) return <>{empty}</>

  return (
    <>
      {/* Desktop */}
      <div className="hidden overflow-x-auto rounded-lg border border-[var(--border)] md:block">
        <table className="w-full border-collapse text-sm">
          <thead className="bg-[var(--hover)]">
            <tr>
              {columns.map((column) => (
                <th
                  key={column.key}
                  className={`px-3 py-2.5 text-xs font-semibold uppercase tracking-wide text-[var(--muted)] ${
                    column.align === 'right' ? 'text-right' : 'text-left'
                  }`}
                >
                  {column.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr
                key={index}
                className="border-t border-[var(--border)] hover:bg-[var(--hover)]"
              >
                {columns.map((column) => (
                  <td
                    key={column.key}
                    className={`px-3 py-2.5 ${column.align === 'right' ? 'text-right tabular-nums' : ''}`}
                  >
                    {href && column.primary ? (
                      <Link href={href(row)} className="font-medium text-[var(--accent)] hover:underline">
                        {column.render(row)}
                      </Link>
                    ) : (
                      column.render(row)
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Móvil */}
      <ul className="space-y-2 md:hidden">
        {rows.map((row, index) => {
          const primary = columns.find((column) => column.primary) ?? columns[0]!
          const rest = columns.filter((column) => column !== primary)
          const content = (
            <>
              <p className="text-sm font-semibold">{primary.render(row)}</p>
              <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5">
                {rest.map((column) => (
                  <div key={column.key} className="min-w-0">
                    <dt className="truncate text-xs text-[var(--muted)]">{column.header}</dt>
                    <dd className="truncate text-sm tabular-nums">{column.render(row)}</dd>
                  </div>
                ))}
              </dl>
            </>
          )
          return (
            <li key={index} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3.5">
              {href ? <Link href={href(row)}>{content}</Link> : content}
            </li>
          )
        })}
      </ul>
    </>
  )
}

export function money(value: { toString(): string } | null | undefined): string {
  if (value === null || value === undefined) return '—'
  const number = Number(value.toString())
  return number.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
