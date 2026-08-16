import { assertCan } from '@/lib/auth/rbac'
import { prisma } from '@/lib/db/client'
import { buildDisbursementPdf } from '@/lib/pdf/build-disbursement'

export const dynamic = 'force-dynamic'

/**
 * Desprendible de una orden de desembolso.
 *
 * El documento se arma en `lib/pdf/build-disbursement`, que comparte con el
 * envío por correo: si cada camino lo armara por su cuenta, el PDF que se
 * descarga y el que recibe contabilidad podrían decir cosas distintas.
 */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await assertCan('payment:view')
  const { id } = await context.params

  const built = await buildDisbursementPdf(user.companyId, id)
  if (!built) {
    return new Response('Esa orden de desembolso no existe.', { status: 404 })
  }

  await prisma.auditLog.create({
    data: {
      companyId: user.companyId,
      userId: user.id,
      userEmailSnapshot: user.email,
      action: 'DISBURSEMENT_PDF_GENERATED',
      entityType: 'DisbursementOrder',
      entityId: id,
      payrollWeekId: built.payrollWeekId,
      newValueJson: { orderNumber: built.orderNumber },
      changedFields: [],
    },
  })

  return new Response(new Uint8Array(built.pdf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${built.orderNumber}.pdf"`,
      'Cache-Control': 'no-store',
    },
  })
}
