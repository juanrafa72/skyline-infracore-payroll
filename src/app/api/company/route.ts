import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth/rbac'
import { setActiveCompany } from '@/lib/auth/session'
import { prisma } from '@/lib/db/client'

/**
 * Cambio de compañía activa.
 *
 * Exige el permiso `company:switch` y que la compañía esté entre las que el
 * usuario tiene asignadas. Queda registrado en el audit log.
 */
export async function POST(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.redirect(new URL('/login', request.url), { status: 303 })

  const form = await request.formData()
  const companyId = String(form.get('companyId') ?? '')
  const referer = request.headers.get('referer') ?? '/dashboard'

  const allowed =
    user.permissions.has('company:switch') &&
    user.availableCompanies.some((company) => company.id === companyId)

  if (allowed && companyId !== user.companyId) {
    await setActiveCompany(companyId)
    await prisma.auditLog.create({
      data: {
        companyId,
        userId: user.id,
        userEmailSnapshot: user.email,
        action: 'COMPANY_SWITCHED',
        entityType: 'Company',
        entityId: companyId,
        oldValueJson: { from: user.companyId },
        newValueJson: { to: companyId },
        changedFields: ['activeCompany'],
      },
    })
  }

  return NextResponse.redirect(new URL(referer, request.url), { status: 303 })
}
