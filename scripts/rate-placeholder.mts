/**
 * Tarifa PROVISIONAL de $1 a quien no tiene ninguna.
 *
 * Sirve para destrabar: sin tarifa, una sola persona bloquea el envío de la
 * semana entera. Pero $1 NO es la tarifa de nadie — quien se quede así cobra
 * $5 por una semana de trabajo en vez de $650, y eso no lo avisa nadie.
 *
 * Por eso cada una queda marcada como provisional en su nota de origen y en
 * la auditoría, y este mismo guion las lista con `--pendientes` para poder
 * perseguirlas después.
 *
 * Uso:
 *   npx tsx scripts/rate-placeholder.mts              (muestra a quién le tocaría)
 *   npx tsx scripts/rate-placeholder.mts --aplicar    (las escribe)
 *   npx tsx scripts/rate-placeholder.mts --pendientes (quiénes siguen en $1)
 */
import 'dotenv/config'
import { prisma } from '@/lib/db/client'
import { ratesStatus, saveMissingRate } from '@/lib/payroll/rates-status/service'
import { NOTA_PROVISIONAL } from '@/lib/payroll/rates-status'
import type { CurrentUser } from '@/lib/auth/rbac'

/** La marca que las hace rastreables: la misma que reconoce la pantalla. */
const NOTA = NOTA_PROVISIONAL
const MONTO = '1.00'

const aplicar = process.argv.includes('--aplicar')
const soloPendientes = process.argv.includes('--pendientes')

const admin = await prisma.user.findFirstOrThrow({
  where: { status: 'ACTIVE', companyRoles: { some: { role: { code: 'SUPER_ADMIN' } } } },
})

if (soloPendientes) {
  const filas = await prisma.workerRate.findMany({
    where: { sourceNote: NOTA, active: true, effectiveTo: null },
    include: { worker: { select: { displayName: true, companyId: true } } },
  })
  const companies = new Map(
    (await prisma.company.findMany()).map((c) => [c.id, c.displayName]),
  )
  console.log(`${filas.length} tarifa(s) siguen en $1 provisional:\n`)
  for (const r of filas.sort((a, b) => a.worker.displayName.localeCompare(b.worker.displayName))) {
    console.log(`  ${companies.get(r.worker.companyId) ?? '—'} · ${r.worker.displayName}`)
  }
  await prisma.$disconnect()
  process.exit(0)
}

const hoy = new Date().toISOString().slice(0, 10)
const companies = await prisma.company.findMany({ orderBy: { code: 'asc' } })

let total = 0

for (const company of companies) {
  const status = await ratesStatus(company.id, hoy)
  if (status.missing.length === 0) continue

  console.log(`\n${company.displayName} — ${status.missing.length} sin tarifa`)

  const user: CurrentUser = {
    id: admin.id,
    name: admin.name,
    email: admin.email,
    companyId: company.id,
    companyCode: company.code,
    companyName: company.displayName,
    roleCodes: ['SUPER_ADMIN'],
    permissions: new Set(['rate:manage']),
    availableCompanies: [],
  }

  for (const fila of status.missing) {
    if (!aplicar) {
      console.log(`   [prueba] ${fila.name}`)
      total += 1
      continue
    }

    const r = await saveMissingRate(user, {
      workerId: fila.workerId,
      amount: MONTO,
      // Desde el inicio de los tiempos del sistema: la tarifa tiene que
      // aplicar también a los días ya marcados, o seguirían sin resolverse.
      effectiveFrom: '2024-01-01',
      sourceNote: NOTA,
    })
    console.log(`   ${r.ok ? '✓' : '✗'} ${fila.name}${r.ok ? '' : ` — ${r.message}`}`)
    if (r.ok) total += 1
  }
}

console.log(
  aplicar
    ? `\n${total} tarifa(s) provisionales puestas. Para ver quiénes siguen así:\n   npx tsx scripts/rate-placeholder.mts --pendientes`
    : `\n${total} tarifa(s) se pondrían. Para hacerlo de verdad:\n   npx tsx scripts/rate-placeholder.mts --aplicar`,
)

await prisma.$disconnect()
