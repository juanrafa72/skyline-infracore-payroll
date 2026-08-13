import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Badge, Button, Card, EmptyState, LinkButton, PageHeader, Stat, money } from '@/components/ui'
import { getActiveCompany } from '@/lib/company/context'
import { prisma } from '@/lib/db/client'
import { shortDay, toIso } from '@/lib/payroll/week'
import { calculateWeek, saveWorkEntries } from '../actions'

export const dynamic = 'force-dynamic'

/**
 * Columnas de la rejilla: nombre + N días + tarifa.
 *
 * El número de días depende de la frecuencia (1, 7, 14, 15, 16, 30, 31…), así
 * que la plantilla se pasa como variable CSS en línea. No puede ser una clase
 * de Tailwind armada con texto: Tailwind solo genera las clases que ve escritas
 * literalmente en el código.
 */
function gridTemplate(dayCount: number): string {
  if (dayCount > 16) return 'minmax(150px,1fr) minmax(0,6fr) minmax(80px,0.7fr)'
  return `minmax(150px,1.6fr) repeat(${dayCount},minmax(0,1fr)) minmax(80px,0.9fr)`
}

/** Clase estática que consume la variable. Esta sí la compila Tailwind. */
const GRID_CLASS = 'md:[grid-template-columns:var(--payroll-grid)] md:gap-2'


const DAY_OPTIONS = [
  { value: '', label: '—' },
  { value: 'FULL_DAY', label: 'Sí' },
  { value: 'HALF_DAY', label: '½' },
  { value: 'NO_WORK', label: 'No' },
] as const

export default async function WeekPage({ params }: { params: Promise<{ weekId: string }> }) {
  const { weekId } = await params
  const company = await getActiveCompany()

  const week = await prisma.payrollWeek.findFirst({
    where: { id: weekId, companyId: company.id },
  })
  if (!week) notFound()

  const [workers, entries, payrolls, exceptions] = await Promise.all([
    prisma.worker.findMany({
      where: { companyId: company.id, status: 'ACTIVE' },
      orderBy: { displayName: 'asc' },
      include: { rates: { where: { active: true } } },
    }),
    prisma.workEntry.findMany({ where: { companyId: company.id, payrollWeekId: week.id } }),
    prisma.workerPayroll.findMany({
      where: { companyId: company.id, payrollWeekId: week.id },
      include: { worker: true, lines: true },
      orderBy: { worker: { displayName: 'asc' } },
    }),
    prisma.exception.findMany({
      where: { companyId: company.id, payrollWeekId: week.id, status: 'OPEN' },
    }),
  ])

  // El período puede durar 1, 7, 14, 15, 16, 28, 30 o 31 días según la
  // frecuencia, o lo que dure un corte. Se recorre de inicio a fin.
  const days: string[] = []
  for (
    let cursor = new Date(week.startDate);
    toIso(cursor) <= toIso(week.endDate);
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  ) {
    days.push(toIso(cursor))
  }

  const entryMap = new Map(
    entries.map((entry) => [`${entry.workerId}:${toIso(entry.workDate)}`, entry.dayType]),
  )

  const totals = payrolls.reduce(
    (accumulator, payroll) => ({
      gross: accumulator.gross + Number(payroll.grossPay),
      deductions: accumulator.deductions + Number(payroll.deductionsTotal),
      net: accumulator.net + Number(payroll.netPay),
    }),
    { gross: 0, deductions: 0, net: 0 },
  )

  const critical = exceptions.filter((exception) => exception.level === 'CRITICAL')
  // Con más de 16 días las casillas van dentro de su propio bloque, no como
  // columnas de la rejilla: `md:contents` solo sirve cuando sí son columnas.
  const inlineDays = days.length <= 16
  const gridStyle = { '--payroll-grid': gridTemplate(days.length) } as React.CSSProperties

  return (
    <>
      <PageHeader
        title={`${week.label} · ${week.year}`}
        subtitle={`${toIso(week.startDate)} → ${toIso(week.endDate)} · ${company.displayName}`}
        action={<LinkButton href="/payroll" variant="secondary">Volver</LinkButton>}
      />

      {week.isOffCycle ? (
        <div className="mb-5 rounded-lg border border-amber-300 bg-amber-50 p-3.5 text-sm text-amber-900">
          <strong>
            {week.settlementType === 'FINAL_SETTLEMENT'
              ? 'Liquidación por retiro'
              : 'Corte parcial'}
          </strong>{' '}
          — período fuera de calendario, de {toIso(week.startDate)} a {toIso(week.endDate)}.
          {week.offCycleReason ? ` ${week.offCycleReason}` : ''}
          <br />
          No forma parte del ciclo regular: los días que se marquen aquí no deben marcarse
          también en el período normal.
        </div>
      ) : null}

      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Bruto" value={`$${money(totals.gross)}`} />
        <Stat label="Descuentos" value={`$${money(totals.deductions)}`} />
        <Stat label="Neto a pagar" value={`$${money(totals.net)}`} tone="good" />
        <Stat
          label="Errores"
          value={String(critical.length)}
          tone={critical.length > 0 ? 'warning' : 'default'}
          hint={critical.length > 0 ? 'Bloquean el envío a aprobación' : 'Ninguno'}
        />
      </div>

      {workers.length === 0 ? (
        <EmptyState
          title="No hay trabajadores activos"
          hint="Primero registra al menos una persona para poder marcar sus días."
          action={<LinkButton href="/workers/new">Nuevo trabajador</LinkButton>}
        />
      ) : (
        <>
          <section className="mb-8">
            <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide">Días trabajados</h2>
            <p className="mb-3 text-xs text-[var(--muted)]">
              Sí = día completo · ½ = medio día · No = no trabajó · — = sin registrar todavía.
            </p>

            <form action={saveWorkEntries}>
              <input type="hidden" name="weekId" value={week.id} />

              {/*
                UN SOLO juego de campos, con el layout cambiando por CSS.
                Duplicar la rejilla (una versión de escritorio y otra de móvil)
                enviaría cada día dos veces y el segundo valor pisaría al primero.
              */}
              <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)]">
                <div
                  style={gridStyle}
                  className={`hidden ${inlineDays ? 'md:grid' : ''} ${GRID_CLASS} border-b border-[var(--border)] bg-[var(--hover)] px-3 py-2.5`}
                >
                  <span className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
                    Trabajador
                  </span>
                  {days.map((day) => (
                    <span
                      key={day}
                      className="text-center text-xs font-semibold uppercase tracking-wide text-[var(--muted)]"
                    >
                      {shortDay(day)}
                    </span>
                  ))}
                  <span className="text-right text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
                    Tarifa
                  </span>
                </div>

                {workers.map((worker) => (
                  <div
                    key={worker.id}
                    style={gridStyle}
                    className={`border-b border-[var(--border)] px-3 py-3 last:border-b-0 md:grid ${GRID_CLASS} md:items-center md:py-2`}
                  >
                    <div className="flex items-center justify-between gap-2 md:block">
                      <Link
                        href={`/workers/${worker.id}`}
                        className="text-sm font-medium text-[var(--accent)] hover:underline"
                      >
                        {worker.displayName}
                      </Link>
                      <span className="text-xs tabular-nums text-[var(--muted)] md:hidden">
                        {worker.rates[0] ? `$${money(worker.rates[0].amount)}` : 'sin tarifa'}
                      </span>
                    </div>

                    {/* `md:contents` disuelve este envoltorio dentro de la rejilla en escritorio */}
                    <div className={`mt-3 grid grid-cols-4 gap-2 md:mt-0 ${inlineDays ? "md:contents" : "md:grid-cols-8 md:gap-1.5"}`}>
                      {days.map((day) => {
                        const current = entryMap.get(`${worker.id}:${day}`) ?? ''
                        return (
                          // La clave incluye el valor: al recalcular, React vuelve a montar
                          // el campo y muestra lo que quedó guardado. Sin esto, un campo no
                          // controlado conserva en pantalla lo que tenía antes.
                          <label key={`${day}:${current}`} className="block">
                            <span className={`mb-0.5 block text-center text-[11px] text-[var(--muted)] ${inlineDays ? 'md:hidden' : ''}`}>
                              {shortDay(day)}
                            </span>
                            <DaySelect worker={worker.id} day={day} value={current} />
                          </label>
                        )
                      })}
                    </div>

                    <div className="hidden text-right text-sm tabular-nums md:block">
                      {worker.rates[0] ? (
                        `$${money(worker.rates[0].amount)}`
                      ) : (
                        <Badge tone="critical">falta</Badge>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <Button>Guardar días</Button>
              </div>
            </form>

            <form action={calculateWeek} className="mt-2">
              <input type="hidden" name="weekId" value={week.id} />
              <Button variant="secondary">Calcular nómina</Button>
            </form>
          </section>

          {exceptions.length > 0 ? (
            <section className="mb-8">
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide">
                Errores detectados
              </h2>
              <ul className="space-y-2">
                {exceptions.map((exception) => (
                  <li
                    key={exception.id}
                    className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm"
                  >
                    <div className="flex items-center gap-2">
                      <Badge tone="critical">{exception.level}</Badge>
                      <span className="font-medium">{exception.title}</span>
                    </div>
                    <p className="mt-1 text-red-800">{exception.detail}</p>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <section>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide">Resultado</h2>
            {payrolls.length === 0 ? (
              <EmptyState
                title="Sin calcular"
                hint="Marca los días y presiona «Calcular nómina»."
              />
            ) : (
              <div className="overflow-x-auto rounded-lg border border-[var(--border)] bg-[var(--surface)]">
                <table className="w-full border-collapse text-sm">
                  <thead className="bg-[var(--hover)]">
                    <tr>
                      {['Trabajador', 'Días', '½', 'Bruto', 'Descuentos', 'Neto', 'Estado'].map(
                        (header, index) => (
                          <th
                            key={header}
                            className={`px-3 py-2.5 text-xs font-semibold uppercase tracking-wide text-[var(--muted)] ${
                              index > 0 && index < 6 ? 'text-right' : 'text-left'
                            }`}
                          >
                            {header}
                          </th>
                        ),
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {payrolls.map((payroll) => (
                      <tr key={payroll.id} className="border-t border-[var(--border)]">
                        <td className="px-3 py-2.5 font-medium">{payroll.worker.displayName}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{payroll.daysFull}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{payroll.daysHalf}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums">${money(payroll.grossPay)}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums">${money(payroll.deductionsTotal)}</td>
                        <td className="px-3 py-2.5 text-right font-semibold tabular-nums">${money(payroll.netPay)}</td>
                        <td className="px-3 py-2.5">
                          <Badge tone="info">{payroll.status}</Badge>
                        </td>
                      </tr>
                    ))}
                    <tr className="border-t-2 border-[var(--border)] bg-[var(--hover)] font-semibold">
                      <td className="px-3 py-2.5">Total</td>
                      <td />
                      <td />
                      <td className="px-3 py-2.5 text-right tabular-nums">${money(totals.gross)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">${money(totals.deductions)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">${money(totals.net)}</td>
                      <td />
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <Card className="mt-6 border-amber-300 bg-amber-50">
            <p className="text-sm text-amber-900">
              <strong>Falta el siguiente paso:</strong> enviar a aprobación, el Approval Center de
              Rafael y el Payment Center. Están en los módulos M9 y M10 del plan.
            </p>
          </Card>
        </>
      )}
    </>
  )
}

function DaySelect({ worker, day, value }: { worker: string; day: string; value: string }) {
  return (
    <select
      name={`day:${worker}:${day}`}
      defaultValue={value}
      className="h-8 w-full min-w-[52px] rounded border border-[var(--border)] bg-[var(--surface)] px-1 text-center text-sm outline-none focus:border-[var(--accent)]"
    >
      {DAY_OPTIONS.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  )
}
