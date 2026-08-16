import { Badge, EmptyState, PageHeader } from '@/components/ui'
import { assertCan } from '@/lib/auth/rbac'
import { getActiveCompany } from '@/lib/company/context'
import { prisma } from '@/lib/db/client'
import { ESTADO_ENVIO, TIPO_REPORTE, type ReportKind } from '@/lib/mail/reports'
import { transporteActual } from '@/lib/mail/transport'
import { AddRecipientForm, ToggleRecipient, type RecipientRow } from './Forms'

export const dynamic = 'force-dynamic'

/**
 * Envío de reportes: a quién le llegan, y qué se ha mandado.
 *
 * El negocio lo pidió para sistematizar el soporte: mandar el desprendible a
 * la auxiliar contable y a la empresa receptora sin tener que armar el correo
 * a mano cada vez, y que cada reporte lleve su consecutivo.
 */
export default async function ReportRecipientsPage() {
  const user = await assertCan('payment:view')
  const company = await getActiveCompany()
  const canManage = user.permissions.has('settings:manage')

  const [recipients, paymentRecipients, envios] = await Promise.all([
    prisma.reportRecipient.findMany({
      where: { companyId: company.id },
      include: { paymentRecipient: { select: { name: true } } },
      orderBy: [{ active: 'desc' }, { name: 'asc' }],
    }),
    prisma.paymentRecipient.findMany({
      where: { companyId: company.id, active: true },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    }),
    prisma.reportDispatch.findMany({
      where: { companyId: company.id },
      include: { targets: true, order: { select: { orderNumber: true } } },
      orderBy: { createdAt: 'desc' },
      take: 30,
    }),
  ])

  const transporte = transporteActual()

  const rows: RecipientRow[] = recipients.map((r) => ({
    id: r.id,
    name: r.name,
    email: r.email,
    kinds: r.kinds,
    paymentRecipientName: r.paymentRecipient?.name ?? null,
    bcc: r.bcc,
    active: r.active,
  }))

  return (
    <>
      <PageHeader
        title="Envío de reportes"
        subtitle={`${company.displayName} · a quién le llegan los soportes por correo`}
      />

      {/*
        Si no hay cuenta de correo, se dice de frente. Dejar que alguien
        oprima «Enviar» creyendo que salió sería peor que no tener el botón.
      */}
      {!transporte.activo ? (
        <div className="mb-6 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          <strong>Falta la cuenta de correo desde la que se envía.</strong> Puedes dejar
          configurados los destinatarios desde ya: cada envío queda numerado y registrado, pero el
          correo <strong>no sale</strong> hasta que se conecte la cuenta. Mientras tanto, descarga
          el PDF de la orden y mándalo a mano.
        </div>
      ) : null}

      <section className="mb-8">
        <h2 className="brand-label mb-1 text-[var(--muted)]">Quién recibe</h2>
        <p className="mb-3 text-sm text-[var(--muted)]">
          Agrega los correos que hagan falta. Uno general para contabilidad, y si quieres uno por
          empresa receptora — ese solo recibe <strong>sus</strong> órdenes.
        </p>

        {canManage ? <AddRecipientForm paymentRecipients={paymentRecipients} /> : null}

        {rows.length === 0 ? (
          <EmptyState
            title="Todavía no hay destinatarios"
            hint="Agrega el correo de la auxiliar contable para empezar."
          />
        ) : (
          <div className="overflow-x-auto rounded-lg border border-[var(--border)] bg-[var(--surface)]">
            <table className="w-full border-collapse text-sm">
              <thead className="bg-[var(--hover)]">
                <tr>
                  {['Nombre', 'Correo', 'Qué recibe', 'De qué empresa', ''].map((h) => (
                    <th
                      key={h || 'acciones'}
                      className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-[var(--muted)]"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.id}
                    className={`border-t border-[var(--border)] ${row.active ? '' : 'opacity-55'}`}
                  >
                    <td className="px-3 py-2.5">
                      <span className="font-medium">{row.name}</span>
                      {row.bcc ? (
                        <span className="ml-2 text-xs text-[var(--muted)]">copia oculta</span>
                      ) : null}
                      {!row.active ? (
                        <span className="ml-2 text-xs text-[var(--muted)]">· desactivado</span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2.5">{row.email}</td>
                    <td className="px-3 py-2.5 text-xs text-[var(--muted)]">
                      {row.kinds.length === 0
                        ? 'todo'
                        : row.kinds
                            .map((k) => TIPO_REPORTE[k as ReportKind] ?? k)
                            .join(' · ')}
                    </td>
                    <td className="px-3 py-2.5 text-xs">
                      {row.paymentRecipientName ? (
                        <>solo {row.paymentRecipientName}</>
                      ) : (
                        <span className="text-[var(--muted)]">todas</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      {canManage ? <ToggleRecipient row={row} /> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <h2 className="brand-label mb-1 text-[var(--muted)]">Últimos envíos</h2>
        <p className="mb-3 text-sm text-[var(--muted)]">
          Cada reporte lleva un consecutivo único. Si a contabilidad le falta un número, se sabe
          exactamente cuál reclamar.
        </p>

        {envios.length === 0 ? (
          <EmptyState
            title="Todavía no se ha enviado nada"
            hint="Desde la orden de desembolso hay un botón para mandar el desprendible."
          />
        ) : (
          <ul className="space-y-2">
            {envios.map((envio) => (
              <li
                key={envio.id}
                className={`rounded-lg border p-3.5 text-sm ${
                  envio.status === 'FAILED'
                    ? 'border-red-300 bg-red-50'
                    : 'border-[var(--border)] bg-[var(--surface)]'
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">{envio.reportNumber}</span>
                  <Badge
                    tone={
                      envio.status === 'SENT'
                        ? 'good'
                        : envio.status === 'FAILED'
                          ? 'critical'
                          : 'warning'
                    }
                  >
                    {ESTADO_ENVIO[envio.status] ?? envio.status}
                  </Badge>
                </div>

                <p className="mt-1 text-xs text-[var(--muted)]">
                  {TIPO_REPORTE[envio.kind as ReportKind]}
                  {envio.order ? ` · ${envio.order.orderNumber}` : ''}
                  {' · '}
                  {(envio.sentAt ?? envio.createdAt).toISOString().slice(0, 16).replace('T', ' ')}
                  {envio.sentByName ? ` · ${envio.sentByName}` : ''}
                </p>

                <p className="mt-1 text-xs">
                  Para: {envio.targets.map((t) => `${t.nameSnapshot} <${t.emailSnapshot}>`).join(', ')}
                </p>

                {envio.failureReason ? (
                  <p className="mt-1 text-xs text-red-800">{envio.failureReason}</p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  )
}
