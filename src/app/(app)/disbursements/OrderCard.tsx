'use client'

import { useActionState, useMemo, useState } from 'react'
import { ZERO, add, toCents, toDecimalString } from '@/lib/payroll/engine/money'
import {
  attachProofAction,
  cancelOrderAction,
  payOrderAction,
  sendToAccountingAction,
} from './actions'

export interface OrderWorker {
  /** Renglón de la orden: puede ser una persona, una cuadrilla o un equipo. */
  itemId: string
  name: string
  crewLabel: string | null
  amount: string
  paid: boolean
}

export interface OrderCardData {
  id: string
  orderNumber: string
  status: string
  statusLabel: string
  recipientName: string
  recipientTaxId: string | null
  recipientBank: string | null
  recipientPaymentDetails: string | null
  weekLabel: string
  period: string
  total: string
  amountPaid: string
  workers: readonly OrderWorker[]
  approvedByName: string | null
  preparedByName: string | null
  paidByName: string | null
  paymentDate: string | null
  methodLabel: string | null
  reference: string | null
  sentToAccounting: string | null
  documents: ReadonlyArray<{ fileName: string; fileRef: string; kindLabel: string }>
}

const METHODS = [
  ['ZELLE', 'Zelle'],
  ['ACH', 'Transferencia ACH'],
  ['WIRE', 'Transferencia'],
  ['CHECK', 'Cheque'],
  ['CASH', 'Efectivo'],
  ['OTHER', 'Otro'],
] as const

/** Con más de esta cantidad la lista arranca plegada, pero nunca escondida. */
const COLLAPSE_OVER = 8

function currency(value: string): string {
  return Number(value).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

/**
 * Una orden de desembolso, como la ve quien transfiere.
 *
 * Se ve de una: a qué empresa, cuánto, de qué semana, qué consecutivo y —lo
 * más importante— qué personas la componen, con su monto. Nadie debería tener
 * que abrir otra pantalla para saber a quién está pagando.
 */
export function OrderCard({ data, canPay }: { data: OrderCardData; canPay: boolean }) {
  const pending = data.workers.filter((worker) => !worker.paid)
  const [open, setOpen] = useState(data.workers.length <= COLLAPSE_OVER)
  const [paying, setPaying] = useState(false)
  const [extras, setExtras] = useState(false)
  const [selected, setSelected] = useState<ReadonlySet<string>>(
    () => new Set(pending.map((worker) => worker.itemId)),
  )

  const [payResult, pay, payingNow] = useActionState(payOrderAction, null)
  const [proofResult, attachProof] = useActionState(attachProofAction, null)
  const [sendResult, send] = useActionState(sendToAccountingAction, null)
  const [cancelResult, cancel] = useActionState(cancelOrderAction, null)

  const message = payResult ?? proofResult ?? sendResult ?? cancelResult
  const ok = message?.startsWith('LISTO|')

  /* Lo que suman los marcados, en centavos: es lo que hay que transferir. */
  const selectedTotal = useMemo(() => {
    const total = data.workers
      .filter((worker) => selected.has(worker.itemId))
      .reduce((accumulator, worker) => add(accumulator, toCents(worker.amount)), ZERO)
    return toDecimalString(total)
  }, [data.workers, selected])

  const settled = data.status === 'PAID' || data.status === 'CANCELLED'
  const partial = selected.size !== pending.length

  const toggle = (id: string) => {
    setSelected((previous) => {
      const next = new Set(previous)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const tone =
    data.status === 'PAID'
      ? 'border-emerald-300'
      : data.status === 'CANCELLED'
        ? 'border-[var(--border)] opacity-70'
        : data.status === 'PARTIALLY_PAID'
          ? 'border-amber-300'
          : 'border-[var(--border)]'

  return (
    <article className={`rounded-xl border-2 bg-[var(--surface)] ${tone}`}>
      {/* ── Cabecera: a quién y cuánto ───────────────────────── */}
      <header className="flex flex-wrap items-start justify-between gap-3 p-4 pb-3">
        <div className="min-w-[200px] flex-1">
          <p className="brand-label text-[var(--muted)]">
            Empresa receptora
          </p>
          <h3 className="mt-0.5 text-xl font-semibold leading-tight">{data.recipientName}</h3>
          <p className="mt-1 text-sm text-[var(--muted)]">
            {data.weekLabel} · {data.period}
          </p>
          <p className="mt-0.5 font-mono text-xs text-[var(--muted)]">{data.orderNumber}</p>
        </div>

        <div className="text-right">
          <p className="text-2xl font-semibold tabular-nums">${currency(data.total)}</p>
          <p className="text-sm text-[var(--muted)]">
            {data.workers.length} trabajador{data.workers.length === 1 ? '' : 'es'}
          </p>
          <span
            className={`mt-1 inline-block rounded border px-2 py-0.5 text-xs font-medium ${
              data.status === 'PAID'
                ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
                : data.status === 'PARTIALLY_PAID'
                  ? 'border-amber-300 bg-amber-50 text-amber-900'
                  : data.status === 'CANCELLED'
                    ? 'border-[var(--border)] text-[var(--muted)]'
                    : 'border-sky-300 bg-sky-50 text-sky-900'
            }`}
          >
            {data.statusLabel}
          </span>
        </div>
      </header>

      {data.recipientBank || data.recipientTaxId || data.recipientPaymentDetails ? (
        <p className="px-4 pb-2 text-xs text-[var(--muted)]">
          {[
            data.recipientTaxId ? `EIN ${data.recipientTaxId}` : null,
            data.recipientBank,
            data.recipientPaymentDetails,
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
      ) : null}

      {/* ── Quiénes van en este desembolso ───────────────────── */}
      <div className="border-t border-[var(--border)]">
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="flex w-full items-center justify-between px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide text-[var(--muted)] hover:bg-[var(--hover)]"
        >
          <span>Trabajadores incluidos</span>
          <span>{open ? '−' : `+ ver los ${data.workers.length}`}</span>
        </button>

        {open ? (
          <ul className="px-4 pb-1">
            {data.workers.map((worker) => (
              <li
                key={worker.itemId}
                className="flex items-center justify-between gap-3 border-b border-[var(--border)] py-1.5 text-sm last:border-0"
              >
                <span className="flex items-center gap-2">
                  {paying && !worker.paid ? (
                    <input
                      type="checkbox"
                      name="itemId"
                      form={`pay-${data.id}`}
                      value={worker.itemId}
                      checked={selected.has(worker.itemId)}
                      onChange={() => toggle(worker.itemId)}
                      className="h-4 w-4"
                    />
                  ) : null}
                  {worker.name}
                  {worker.paid ? (
                    <span className="rounded border border-emerald-300 bg-emerald-50 px-1.5 text-xs text-emerald-800">
                      pagado
                    </span>
                  ) : null}
                </span>
                <span className="tabular-nums">${currency(worker.amount)}</span>
              </li>
            ))}
          </ul>
        ) : null}

        <div className="flex items-center justify-between border-t-2 border-[var(--border)] px-4 py-2.5">
          <span className="text-sm font-semibold uppercase tracking-wide">Total a transferir</span>
          <span className="text-xl font-semibold tabular-nums">${currency(data.total)}</span>
        </div>

        {data.amountPaid !== '0.00' && data.amountPaid !== data.total ? (
          <p className="px-4 pb-2 text-right text-xs text-[var(--muted)]">
            transferido hasta ahora ${currency(data.amountPaid)}
          </p>
        ) : null}
      </div>

      {/* ── Qué se sabe del pago ─────────────────────────────── */}
      {data.reference || data.paidByName ? (
        <dl className="grid gap-x-6 gap-y-1 border-t border-[var(--border)] px-4 py-2.5 text-xs sm:grid-cols-2">
          <Line label="Pagó" value={data.paidByName ?? '—'} />
          <Line label="Fecha" value={data.paymentDate ?? '—'} />
          <Line label="Método" value={data.methodLabel ?? '—'} />
          <Line label="Referencia" value={data.reference ?? '—'} />
        </dl>
      ) : null}

      {message ? (
        <p
          className={`mx-4 mb-3 rounded-md border p-2.5 text-sm ${
            ok
              ? 'border-emerald-300 bg-emerald-50 text-emerald-900'
              : 'border-amber-300 bg-amber-50 text-amber-900'
          }`}
        >
          {message.replace(/^LISTO\|/, '')}
        </p>
      ) : null}

      {/* ── Acciones ─────────────────────────────────────────── */}
      <footer className="flex flex-wrap items-center gap-2 border-t border-[var(--border)] p-3">
        <a
          href={`/disbursements/${data.id}/pdf`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex h-9 items-center rounded-md border border-[var(--border)] px-3 text-sm hover:bg-[var(--hover)]"
        >
          Descargar PDF
        </a>

        {canPay && !settled && pending.length > 0 ? (
          <button
            type="button"
            onClick={() => setPaying((value) => !value)}
            className="h-9 rounded-md bg-[var(--accent)] px-3.5 text-sm font-medium text-white hover:opacity-90"
          >
            {paying ? 'Cancelar' : 'Registrar pago'}
          </button>
        ) : null}

        <button
          type="button"
          onClick={() => setExtras((value) => !value)}
          className="h-9 rounded-md border border-[var(--border)] px-3 text-sm hover:bg-[var(--hover)]"
        >
          {extras ? 'Menos' : 'Comprobante y contabilidad'}
        </button>

        {data.sentToAccounting ? (
          <span className="text-xs text-[var(--muted)]">
            enviada a contabilidad · {data.sentToAccounting}
          </span>
        ) : null}
      </footer>

      {/* ── Registrar la transferencia ───────────────────────── */}
      {paying && canPay && !settled ? (
        <form
          id={`pay-${data.id}`}
          action={pay}
          className="border-t border-[var(--border)] bg-[var(--hover)] p-4"
        >
          <input type="hidden" name="orderId" value={data.id} />

          <p className="mb-3 text-sm">
            <strong>{selected.size}</strong> de {pending.length} pendiente(s) ·{' '}
            <strong className="tabular-nums">${currency(selectedTotal)}</strong>
            <span className="ml-2 text-xs text-[var(--muted)]">
              Si el giro no cubrió a todos, desmarca a quienes van aparte.
            </span>
          </p>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Input label="Fecha del pago" name="paymentDate" type="date" defaultValue={today()} required />
            <Select label="Método" name="method" options={METHODS} />
            <Input label="Banco / plataforma" name="bankName" placeholder="Chase, Zelle…" />
            <Input label="Referencia bancaria" name="reference" required placeholder="Confirmación" />
            <Input
              label="Monto transferido"
              name="amountPaid"
              defaultValue={selectedTotal}
              required
              hint="Tiene que dar exactamente lo que suman los marcados."
            />
            <Input label="Observaciones" name="notes" />
          </div>

          {partial ? (
            <div className="mt-3">
              <Input
                label="Por qué van aparte"
                name="differenceReason"
                required
                hint="Obligatorio cuando el giro no cubre a toda la orden."
              />
            </div>
          ) : null}

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="submit"
              disabled={payingNow || selected.size === 0}
              className="h-9 rounded-md bg-[var(--accent)] px-4 text-sm font-medium text-white hover:opacity-90 disabled:opacity-45"
            >
              {payingNow ? 'Registrando…' : `Confirmar transferencia de $${currency(selectedTotal)}`}
            </button>
            <span className="text-xs text-[var(--muted)]">
              Después de esto la orden queda cerrada: los montos ya no se pueden cambiar.
            </span>
          </div>
        </form>
      ) : null}

      {/* ── Comprobante, contabilidad, anulación ─────────────── */}
      {extras ? (
        <div className="space-y-4 border-t border-[var(--border)] bg-[var(--hover)] p-4">
          <div>
            <p className="text-sm font-semibold">Comprobante de la transferencia</p>
            <p className="mb-2 mt-0.5 text-xs text-[var(--muted)]">
              El archivo va en SharePoint. Aquí se guarda el enlace, y queda amarrado a esta orden
              para siempre.
            </p>
            <form action={attachProof} className="grid gap-2 sm:grid-cols-[1fr_2fr_auto]">
              <input type="hidden" name="orderId" value={data.id} />
              <input
                name="fileName"
                placeholder="Nombre del archivo"
                className="h-9 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2.5 text-sm"
              />
              <input
                name="fileRef"
                required
                placeholder="Enlace de SharePoint"
                className="h-9 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2.5 text-sm"
              />
              <button
                type="submit"
                className="h-9 rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 text-sm hover:bg-[var(--hover)]"
              >
                Guardar
              </button>
            </form>

            {data.documents.length > 0 ? (
              <ul className="mt-2 space-y-1 text-xs">
                {data.documents.map((document, index) => (
                  <li key={index}>
                    <span className="text-[var(--muted)]">{document.kindLabel}: </span>
                    <a
                      href={document.fileRef}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[var(--accent)] underline"
                    >
                      {document.fileName}
                    </a>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>

          <div>
            <p className="text-sm font-semibold">Enviar a contabilidad</p>
            <p className="mb-2 mt-0.5 text-xs text-[var(--muted)]">
              Descarga el PDF y déjalo registrado. Queda constancia de a quién se le pasó y cuándo.
            </p>
            <form action={send} className="grid gap-2 sm:grid-cols-[2fr_auto]">
              <input type="hidden" name="orderId" value={data.id} />
              <input
                name="sentTo"
                required
                placeholder="Correo o nombre de quien lo recibe"
                className="h-9 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2.5 text-sm"
              />
              <button
                type="submit"
                className="h-9 rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 text-sm hover:bg-[var(--hover)]"
              >
                Marcar enviada
              </button>
            </form>
          </div>

          {data.status === 'PENDING_PAYMENT' ? (
            <div>
              <p className="text-sm font-semibold">Anular la orden</p>
              <p className="mb-2 mt-0.5 text-xs text-[var(--muted)]">
                Solo mientras no haya salido dinero. El motivo queda registrado.
              </p>
              <form action={cancel} className="grid gap-2 sm:grid-cols-[2fr_auto]">
                <input type="hidden" name="orderId" value={data.id} />
                <input
                  name="reason"
                  required
                  placeholder="Por qué se anula"
                  className="h-9 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2.5 text-sm"
                />
                <button
                  type="submit"
                  className="h-9 rounded-md border border-red-300 bg-[var(--surface)] px-3 text-sm text-red-700 hover:bg-red-50"
                >
                  Anular
                </button>
              </form>
            </div>
          ) : null}
        </div>
      ) : null}
    </article>
  )
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-[var(--muted)]">{label}</dt>
      <dd className="text-right">{value}</dd>
    </div>
  )
}

function Input({
  label,
  name,
  type = 'text',
  required,
  defaultValue,
  placeholder,
  hint,
}: {
  label: string
  name: string
  type?: string
  required?: boolean
  defaultValue?: string
  placeholder?: string
  hint?: string
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-[var(--muted)]">
        {label}
        {required ? <span className="text-red-600"> *</span> : null}
      </span>
      <input
        name={name}
        type={type}
        required={required}
        defaultValue={defaultValue}
        placeholder={placeholder}
        className="h-9 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-2.5 text-sm outline-none focus:border-[var(--accent)]"
      />
      {hint ? <span className="mt-1 block text-xs text-[var(--muted)]">{hint}</span> : null}
    </label>
  )
}

function Select({
  label,
  name,
  options,
}: {
  label: string
  name: string
  options: ReadonlyArray<readonly [string, string]>
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-[var(--muted)]">{label}</span>
      <select
        name={name}
        className="h-9 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-2.5 text-sm outline-none focus:border-[var(--accent)]"
      >
        {options.map(([value, text]) => (
          <option key={value} value={value}>
            {text}
          </option>
        ))}
      </select>
    </label>
  )
}
