import type { CurrentUser } from '@/lib/auth/rbac'
import { prisma } from '@/lib/db/client'
import { nextNumber } from '@/lib/disbursement/sequence'
import { toDecimalString } from './engine/money'
import {
  formatSummaryNumber,
  resumirParaAprobacion,
  type RenglonResumen,
  type ResumenAprobacion,
} from './resumen-aprobacion'

/**
 * Lo que se va a mandar a aprobación, para revisarlo antes.
 *
 * Se arma de lo que está en estado editable —lo calculado y todavía no
 * enviado—, que es exactamente lo que va a viajar. Si se armara de otra
 * consulta, el papel diría una cosa y el botón mandaría otra.
 */
export async function loQueSeVaAMandar(
  companyId: string,
  payrollWeekId: string,
): Promise<ResumenAprobacion> {
  const EDITABLES = ['PREPARED', 'REJECTED'] as const

  const [personas, equipos, cuadrillas] = await Promise.all([
    prisma.workerPayroll.findMany({
      where: { companyId, payrollWeekId, status: { in: [...EDITABLES] } },
      include: { worker: { select: { displayName: true } } },
      orderBy: { worker: { displayName: 'asc' } },
    }),
    prisma.equipmentPayroll.findMany({
      where: { companyId, payrollWeekId, status: { in: [...EDITABLES] } },
      orderBy: { equipmentNameSnapshot: 'asc' },
    }),
    prisma.crewPayroll.findMany({
      where: { companyId, payrollWeekId, status: { in: [...EDITABLES] } },
      orderBy: { crewNameSnapshot: 'asc' },
    }),
  ])

  return resumirParaAprobacion({
    personal: personas.map((row) => ({
      nombre: row.worker.displayName,
      neto: row.netPay.toFixed(2),
    })),
    equipos: equipos.map((row) => ({
      nombre: row.equipmentNameSnapshot,
      neto: row.totalAmount.toFixed(2),
    })),
    cuadrillas: cuadrillas.map((row) => ({
      nombre: row.crewNameSnapshot,
      // Lo que se le paga al contratista por lo que construyó esa semana.
      neto: row.productionTotal.toFixed(2),
    })),
  })
}

/**
 * Congela el resumen al enviar, con su consecutivo.
 *
 * Se llama DESPUÉS de que la transición pasó: un resumen de algo que no se
 * mandó sería un papel que promete un pago inexistente. Si algo falla aquí, el
 * envío no se deshace —ya ocurrió—; se devuelve nulo y quien llama lo dice.
 */
export async function congelarResumen(
  user: CurrentUser,
  payrollWeekId: string,
  resumen: ResumenAprobacion,
): Promise<{ number: string; id: string } | null> {
  const company = await prisma.company.findUnique({
    where: { id: user.companyId },
    select: { code: true },
  })
  if (!company) return null

  const semana = await prisma.payrollWeek.findFirst({
    where: { id: payrollWeekId, companyId: user.companyId },
    select: { year: true },
  })
  if (!semana) return null

  const secuencia = await nextNumber(user.companyId, 'APPROVAL_SUMMARY', semana.year)
  const number = formatSummaryNumber(company.code, semana.year, secuencia)

  const copia = (renglones: readonly RenglonResumen[]) =>
    renglones.map((renglon) => ({ nombre: renglon.nombre, neto: renglon.neto }))

  const renglones = {
    personal: copia(resumen.personal.renglones),
    equipos: copia(resumen.equipos.renglones),
    cuadrillas: copia(resumen.cuadrillas.renglones),
  }

  const creado = await prisma.approvalSummary.create({
    data: {
      companyId: user.companyId,
      payrollWeekId,
      number,
      year: semana.year,
      sequence: secuencia,
      workersCount: resumen.personal.cuantos,
      workersTotal: toDecimalString(resumen.personal.total),
      equipmentCount: resumen.equipos.cuantos,
      equipmentTotal: toDecimalString(resumen.equipos.total),
      crewsCount: resumen.cuadrillas.cuantos,
      crewsTotal: toDecimalString(resumen.cuadrillas.total),
      grandTotal: toDecimalString(resumen.total),
      linesJson: renglones,
      preparedById: user.id,
      preparedByName: user.name,
      preparedByEmail: user.email,
    },
    select: { id: true, number: true },
  })

  return creado
}
