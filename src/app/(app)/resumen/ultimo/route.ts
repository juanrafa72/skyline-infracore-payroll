import { redirect } from 'next/navigation'
import { assertCan } from '@/lib/auth/rbac'
import { getActiveCompany } from '@/lib/company/context'
import { prisma } from '@/lib/db/client'

export const dynamic = 'force-dynamic'

/**
 * Lleva al resumen recién emitido de una semana.
 *
 * Existe porque quien acaba de enviar no conoce el id del papel que se generó:
 * la acción devuelve un mensaje, no un objeto. Así el botón «Ver el resumen»
 * puede apuntar a algo estable sin inventarse rutas con datos adentro.
 */
export async function GET(request: Request) {
  await assertCan('payroll:view')
  const company = await getActiveCompany()
  const semana = new URL(request.url).searchParams.get('semana')

  const ultimo = await prisma.approvalSummary.findFirst({
    where: {
      companyId: company.id,
      ...(semana ? { payrollWeekId: semana } : {}),
    },
    orderBy: { createdAt: 'desc' },
    select: { id: true },
  })

  // Sin resumen todavía, se va a la lista: es mejor que una pantalla de error.
  redirect(ultimo ? `/resumen/${ultimo.id}` : '/resumen')
}
