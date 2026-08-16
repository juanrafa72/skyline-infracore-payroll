/** Intentar hacer lo que NO debe dejarse. Cada "bloqueado" es un candado vivo. */
import 'dotenv/config'
import { prisma } from '@/lib/db/client'

const huecos: string[] = []
async function intentar(que: string, f: () => Promise<unknown>) {
  try {
    await f()
    console.log(`   HUECO  ${que}\n          ¡lo permitió!`)
    huecos.push(que)
  } catch (e) {
    const m = String((e as Error).message).match(/[A-Z][^\n]{10,110}/)?.[0] ?? 'bloqueado'
    console.log(`   ok     ${que}\n          ${m.slice(0, 100)}`)
  }
}

const company = await prisma.company.findFirstOrThrow({ where: { code: 'SKYLINE' } })

console.log('\n1. Tocar dinero ya pagado')
const pagada = await prisma.workerPayroll.findFirst({ where: { companyId: company.id, status: 'PAID' } })
if (pagada) {
  await intentar('cambiar el neto de una nómina PAGADA', () =>
    prisma.workerPayroll.update({ where: { id: pagada.id }, data: { netPay: '99999.00' } }))
  await intentar('borrar una nómina PAGADA', () =>
    prisma.workerPayroll.delete({ where: { id: pagada.id } }))
}

const ordenPagada = await prisma.disbursementOrder.findFirst({ where: { companyId: company.id, status: 'PAID' } })
if (ordenPagada) {
  await intentar('cambiar el total de una orden PAGADA', () =>
    prisma.disbursementOrder.update({ where: { id: ordenPagada.id }, data: { totalAmount: '1.00' } }))
  await intentar('borrar un renglón de una orden PAGADA', async () => {
    const item = await prisma.disbursementOrderItem.findFirstOrThrow({ where: { disbursementOrderId: ordenPagada.id } })
    return prisma.disbursementOrderItem.delete({ where: { id: item.id } })
  })
}

console.log('\n2. Falsear el registro de auditoría')
const log = await prisma.auditLog.findFirst({ where: { companyId: company.id } })
if (log) {
  await intentar('cambiar una entrada de auditoría', () =>
    prisma.auditLog.update({ where: { id: log.id }, data: { reason: 'lo cambié yo' } }))
  await intentar('borrar una entrada de auditoría', () =>
    prisma.auditLog.delete({ where: { id: log.id } }))
}

console.log('\n3. Saltarse el flujo de estados')
const enProceso = await prisma.workerPayroll.findFirst({ where: { companyId: company.id, status: 'PREPARED' } })
if (enProceso) {
  await intentar('saltar de PREPARADA directo a PAGADA', () =>
    prisma.workerPayroll.update({ where: { id: enProceso.id }, data: { status: 'PAID' } }))
}
const pag = await prisma.workerPayroll.findFirst({ where: { companyId: company.id, status: 'PAID' } })
if (pag) {
  await intentar('devolver una PAGADA a borrador', () =>
    prisma.workerPayroll.update({ where: { id: pag.id }, data: { status: 'DRAFT' } }))
}

console.log('\n4. Pagos sin destinatario o con dos')
await intentar('un pago sin nadie a quién pagarle', () =>
  prisma.payment.create({ data: {
    companyId: company.id, paymentNumber: `HUECO-${Date.now()}`,
    payeeType: 'WORKER', approvedAmount: '100.00',
  }}))

const w = await prisma.worker.findFirstOrThrow({ where: { companyId: company.id } })
const v = await prisma.vendor.findFirst({ where: { companyId: company.id } })
if (v) {
  await intentar('un pago a DOS beneficiarios a la vez', () =>
    prisma.payment.create({ data: {
      companyId: company.id, paymentNumber: `HUECO2-${Date.now()}`,
      payeeType: 'WORKER', workerId: w.id, vendorId: v.id, approvedAmount: '100.00',
    }}))
}

console.log('\n5. Datos imposibles')
await intentar('una tarifa negativa', () =>
  prisma.workerRate.create({ data: {
    companyId: company.id, workerId: w.id, rateType: 'DAILY',
    amount: '-500.00', effectiveFrom: new Date('2027-01-01'),
  }}))

const crew = await prisma.crew.findFirst({ where: { companyId: company.id } })
if (crew) {
  await intentar('tarifa diaria de cuadrilla negativa', () =>
    prisma.crew.update({ where: { id: crew.id }, data: { dailyRate: '-100.00' } }))
}

await intentar('un documento de equipo que vence antes de expedirse', async () => {
  const eq = await prisma.equipment.findFirstOrThrow({ where: { companyId: company.id } })
  return prisma.equipmentRecord.create({ data: {
    companyId: company.id, equipmentId: eq.id, kind: 'INSURANCE', title: 'X',
    issuedAt: new Date('2026-06-01'), expiresAt: new Date('2026-01-01'), updatedAt: new Date(),
  }})
})

await intentar('un destinatario de reportes sin arroba', () =>
  prisma.reportRecipient.create({ data: {
    companyId: company.id, name: 'X', email: 'sin-arroba', updatedAt: new Date(),
  }}))

console.log('\n6. Duplicados que descuadrarían la cuenta')
const dia = await prisma.workEntry.findFirst({ where: { companyId: company.id } })
if (dia) {
  await intentar('el mismo día dos veces para la misma persona', () =>
    prisma.workEntry.create({ data: {
      companyId: company.id, payrollWeekId: dia.payrollWeekId, workerId: dia.workerId,
      workDate: dia.workDate, dayType: 'FULL_DAY',
    }}))
}

console.log(`\n${'━'.repeat(60)}`)
console.log(huecos.length === 0 ? 'Todos los candados aguantaron.' : `${huecos.length} HUECO(S): ${huecos.join(' · ')}`)
await prisma.$disconnect()
