import { NextResponse } from 'next/server'
import { ACTIVE_COMPANY_COOKIE } from '@/lib/company/context'
import { prisma } from '@/lib/db/client'

/**
 * Cambio de compañía activa.
 * TEMPORAL: cuando entre autenticación (M3) exigirá el permiso `company:switch`
 * y quedará registrado en el audit log.
 */
export async function POST(request: Request) {
  const form = await request.formData()
  const companyId = String(form.get('companyId') ?? '')

  const company = await prisma.company.findUnique({ where: { id: companyId } })
  const referer = request.headers.get('referer') ?? '/dashboard'
  const response = NextResponse.redirect(new URL(referer, request.url), { status: 303 })

  if (company) {
    response.cookies.set(ACTIVE_COMPANY_COOKIE, company.id, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 30,
    })
  }
  return response
}
