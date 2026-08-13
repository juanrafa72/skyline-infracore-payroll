import { Card, EmptyState, PageHeader } from '@/components/ui'
import { assertCan } from '@/lib/auth/rbac'
import { getActiveCompany } from '@/lib/company/context'
import { prisma } from '@/lib/db/client'
import { RecipientForm } from './RecipientForm'
import { RecipientList, type RecipientRow } from './RecipientList'

export const dynamic = 'force-dynamic'

export default async function RecipientsPage() {
  await assertCan('payroll:approve')
  const company = await getActiveCompany()

  const recipients = await prisma.paymentRecipient.findMany({
    where: { companyId: company.id },
    orderBy: [{ active: 'desc' }, { name: 'asc' }],
    include: {
      orders: {
        select: { id: true, status: true, amountPaid: true },
      },
    },
  })

  const rows: RecipientRow[] = recipients.map((recipient) => ({
    id: recipient.id,
    name: recipient.name,
    legalName: recipient.legalName,
    taxId: recipient.taxId,
    contactName: recipient.contactName,
    email: recipient.email,
    phone: recipient.phone,
    bankName: recipient.bankName,
    bankAccountLast4: recipient.bankAccountLast4,
    paymentDetails: recipient.paymentDetails,
    notes: recipient.notes,
    active: recipient.active,
    orderCount: recipient.orders.length,
    pendingCount: recipient.orders.filter((order) =>
      ['PENDING_PAYMENT', 'PARTIALLY_PAID'].includes(order.status),
    ).length,
    paidTotal: recipient.orders
      .reduce((sum, order) => sum + Number(order.amountPaid), 0)
      .toFixed(2),
  }))

  return (
    <>
      <PageHeader
        title="Empresas receptoras"
        subtitle={`A dónde se manda el dinero · ${company.displayName}`}
      />

      <div className="mb-5 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 text-sm">
        <p className="font-semibold">Qué es esto</p>
        <p className="mt-1 text-[var(--muted)]">
          Una empresa receptora es a quién se le <strong>transfiere</strong> el dinero para
          cubrir el pago de uno o varios trabajadores. No es la compañía dueña de la nómina —
          esa es {company.displayName}. Un trabajador de {company.displayName} puede pagarse
          enviando fondos a un subcontratista, a una agencia, o a él mismo.
        </p>
        <p className="mt-1 text-xs text-[var(--muted)]">
          Una empresa que ya tenga órdenes de desembolso no se borra: se desactiva, y así el
          historial contable sigue completo.
        </p>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
        <div>
          {rows.length === 0 ? (
            <EmptyState
              title="Todavía no hay empresas receptoras"
              hint="Crea la primera con el formulario. También puedes crearlas sobre la marcha desde la pantalla de aprobación."
            />
          ) : (
            <RecipientList rows={rows} />
          )}
        </div>

        <Card>
          <h2 className="text-sm font-semibold">Nueva empresa receptora</h2>
          <p className="mb-3 mt-1 text-xs text-[var(--muted)]">
            Solo el nombre es obligatorio. Lo demás se puede completar después.
          </p>
          <RecipientForm mode="create" />
        </Card>
      </div>
    </>
  )
}
