import type { CurrentUser } from '@/lib/auth/rbac'
import { prisma } from '@/lib/db/client'
import { toIso } from '@/lib/payroll/week'
import {
  agruparRetenciones,
  cuadrarCheque,
  type ClaseDescuento,
  type Cuadre,
  type GrupoRetencion,
} from './index'

/** El mapeo entre lo que dice la base y lo que dice el negocio. */
const A_CLASE: Record<string, ClaseDescuento> = {
  RETENTION: 'RETENCION',
  MATERIAL: 'MATERIAL',
  DAMAGE: 'DANO',
  ADVANCE: 'ANTICIPO',
  OTHER: 'OTRO',
}
const A_BASE: Record<ClaseDescuento, 'RETENTION' | 'MATERIAL' | 'DAMAGE' | 'ADVANCE' | 'OTHER'> = {
  RETENCION: 'RETENTION',
  MATERIAL: 'MATERIAL',
  DANO: 'DAMAGE',
  ANTICIPO: 'ADVANCE',
  OTRO: 'OTHER',
}

export interface Resultado {
  ok: boolean
  message: string
  checkId?: string
}

/**
 * Registra un cheque con lo que dice el soporte.
 *
 * Lo que de verdad entró al banco se digita después: son dos momentos
 * distintos —llega el soporte, y días más tarde se ve el movimiento— y
 * juntarlos obligaría a esperar para poder anotar el primero.
 */
export async function registrarCheque(
  user: CurrentUser,
  input: {
    customerId: string
    reference?: string
    expectedAmount: string
    weekIds?: readonly string[]
    notes?: string
  },
): Promise<Resultado> {
  if (!/^\d+(\.\d{1,2})?$/.test(input.expectedAmount) || Number(input.expectedAmount) <= 0) {
    return { ok: false, message: 'Escribe el valor del cheque, en números. Ejemplo: 50000' }
  }

  const cliente = await prisma.customer.findFirst({
    where: { id: input.customerId, companyId: user.companyId },
    select: { id: true, name: true },
  })
  if (!cliente) return { ok: false, message: 'Ese cliente no existe en esta compañía.' }

  const cheque = await prisma.customerCheck.create({
    data: {
      companyId: user.companyId,
      customerId: cliente.id,
      reference: input.reference?.trim() || null,
      expectedAmount: input.expectedAmount,
      notes: input.notes?.trim() || null,
      createdById: user.id,
      weeks: {
        create: (input.weekIds ?? []).map((payrollWeekId) => ({ payrollWeekId })),
      },
    },
    select: { id: true },
  })

  return {
    ok: true,
    checkId: cheque.id,
    message: `Cheque de ${cliente.name} por $${input.expectedAmount} anotado. Cuando veas el banco, registra lo que entró.`,
  }
}

/**
 * Registra lo que de verdad entró al banco.
 *
 * No exige que cuadre: la diferencia se explica con descuentos, y puede que
 * falte agregar alguno. Lo que sí hace es DECIRLO — la pantalla muestra
 * cuánto falta por explicar hasta que quede en cero.
 */
export async function registrarLoQueEntro(
  user: CurrentUser,
  input: { checkId: string; receivedAmount: string; receivedDate: string },
): Promise<Resultado> {
  if (!/^\d+(\.\d{1,2})?$/.test(input.receivedAmount)) {
    return { ok: false, message: 'Escribe lo que entró al banco, en números.' }
  }

  const cheque = await prisma.customerCheck.findFirst({
    where: { id: input.checkId, companyId: user.companyId },
    select: { id: true },
  })
  if (!cheque) return { ok: false, message: 'Ese cheque no existe en esta compañía.' }

  await prisma.customerCheck.update({
    where: { id: cheque.id },
    data: {
      receivedAmount: input.receivedAmount,
      receivedDate: input.receivedDate ? new Date(`${input.receivedDate}T00:00:00Z`) : null,
    },
  })

  return { ok: true, message: `Quedó registrado que entraron $${input.receivedAmount}.` }
}

/** Anota un descuento del cheque, con su motivo. */
export async function anotarDescuento(
  user: CurrentUser,
  input: {
    checkId: string
    clase: ClaseDescuento
    amount: string
    reason: string
    projectId?: string | null
  },
): Promise<Resultado> {
  if (!/^\d+(\.\d{1,2})?$/.test(input.amount) || Number(input.amount) <= 0) {
    return { ok: false, message: 'Escribe cuánto descontaron, en números.' }
  }
  if (input.reason.trim().length < 3) {
    return {
      ok: false,
      message: 'Escribe por qué lo descontaron. Sin motivo, esa plata no se puede reclamar después.',
    }
  }

  const cheque = await prisma.customerCheck.findFirst({
    where: { id: input.checkId, companyId: user.companyId },
    select: { id: true },
  })
  if (!cheque) return { ok: false, message: 'Ese cheque no existe en esta compañía.' }

  /*
   * La retención SIN proyecto se permite pero se avisa: sin obra no se sabe
   * cuándo la devuelven, que es justo lo que se viene a consultar después.
   */
  await prisma.checkDeduction.create({
    data: {
      checkId: cheque.id,
      kind: A_BASE[input.clase],
      amount: input.amount,
      reason: input.reason.trim(),
      projectId: input.projectId || null,
      createdById: user.id,
    },
  })

  const aviso =
    input.clase === 'RETENCION' && !input.projectId
      ? ' OJO: sin proyecto no se sabrá cuándo la devuelven.'
      : ''

  return { ok: true, message: `Descuento de $${input.amount} anotado.${aviso}` }
}

/** Anota que devolvieron (parte de) una retención. */
export async function anotarDevolucion(
  user: CurrentUser,
  input: { deductionId: string; amount: string; date: string; note?: string },
): Promise<Resultado> {
  if (!/^\d+(\.\d{1,2})?$/.test(input.amount) || Number(input.amount) <= 0) {
    return { ok: false, message: 'Escribe cuánto devolvieron, en números.' }
  }

  const descuento = await prisma.checkDeduction.findFirst({
    where: { id: input.deductionId, check: { companyId: user.companyId } },
    select: { id: true, amount: true, releasedAmount: true, kind: true },
  })
  if (!descuento) return { ok: false, message: 'Ese descuento no existe en esta compañía.' }
  if (descuento.kind !== 'RETENTION') {
    return { ok: false, message: 'Solo las retenciones se devuelven. Lo demás no vuelve.' }
  }

  const yaDevuelto = Number(descuento.releasedAmount)
  const nuevo = yaDevuelto + Number(input.amount)
  if (nuevo > Number(descuento.amount)) {
    return {
      ok: false,
      message: `No pueden devolver más de lo que retuvieron: quedan $${(Number(descuento.amount) - yaDevuelto).toFixed(2)}.`,
    }
  }

  await prisma.checkDeduction.update({
    where: { id: descuento.id },
    data: {
      releasedAmount: nuevo.toFixed(2),
      releasedAt: input.date ? new Date(`${input.date}T00:00:00Z`) : new Date(),
      releaseNote: input.note?.trim() || null,
    },
  })

  return { ok: true, message: `Quedó anotado que devolvieron $${input.amount}.` }
}

export interface ChequeEnPantalla {
  id: string
  customerName: string
  reference: string | null
  expectedAmount: string
  receivedAmount: string | null
  receivedDate: string | null
  semanas: readonly string[]
  descuentos: ReadonlyArray<{
    id: string
    clase: ClaseDescuento
    amount: string
    reason: string
    projectName: string | null
    releasedAmount: string
  }>
  /** Cómo va el cuadre. Nulo mientras no se haya registrado lo que entró. */
  cuadre: Cuadre | null
}

/** Los cheques de la compañía, del más nuevo al más viejo. */
export async function chequesDe(companyId: string): Promise<ChequeEnPantalla[]> {
  const filas = await prisma.customerCheck.findMany({
    where: { companyId },
    include: {
      customer: { select: { name: true } },
      weeks: { include: { payrollWeek: { select: { label: true, weekNumber: true, year: true } } } },
      deductions: { include: { project: { select: { name: true } } }, orderBy: { createdAt: 'asc' } },
    },
    orderBy: { createdAt: 'desc' },
    take: 100,
  })

  return filas.map((fila) => {
    const descuentos = fila.deductions.map((d) => ({
      id: d.id,
      clase: A_CLASE[d.kind] ?? 'OTRO',
      amount: d.amount.toFixed(2),
      reason: d.reason,
      projectName: d.project?.name ?? null,
      releasedAmount: d.releasedAmount.toFixed(2),
    }))

    return {
      id: fila.id,
      customerName: fila.customer.name,
      reference: fila.reference,
      expectedAmount: fila.expectedAmount.toFixed(2),
      receivedAmount: fila.receivedAmount ? fila.receivedAmount.toFixed(2) : null,
      receivedDate: fila.receivedDate ? toIso(fila.receivedDate) : null,
      semanas: fila.weeks.map(
        (w) => `${w.payrollWeek.label ?? `Semana ${w.payrollWeek.weekNumber}`} · ${w.payrollWeek.year}`,
      ),
      descuentos,
      cuadre: fila.receivedAmount
        ? cuadrarCheque({
            esperado: fila.expectedAmount.toFixed(2),
            recibido: fila.receivedAmount.toFixed(2),
            descuentos: descuentos.map((d) => ({
              clase: d.clase,
              monto: d.amount,
              motivo: d.reason,
            })),
          })
        : null,
    }
  })
}

/**
 * Las retenciones vivas, agrupadas por cliente y proyecto.
 *
 * La fecha desde la que se cuenta es la del cheque —cuándo nos retuvieron—, no
 * la de captura: si se contara desde que alguien lo digitó, una retención de
 * hace seis meses aparecería como nueva.
 */
export async function retencionesVivas(
  companyId: string,
  hoy: string,
): Promise<GrupoRetencion[]> {
  const filas = await prisma.checkDeduction.findMany({
    where: { kind: 'RETENTION', check: { companyId } },
    include: {
      project: { select: { id: true, name: true } },
      check: {
        select: {
          receivedDate: true,
          createdAt: true,
          customerId: true,
          customer: { select: { name: true } },
        },
      },
    },
  })

  return agruparRetenciones(
    filas.map((fila) => ({
      customerId: fila.check.customerId,
      customerName: fila.check.customer.name,
      projectId: fila.project?.id ?? null,
      projectName: fila.project?.name ?? null,
      monto: fila.amount.toFixed(2),
      devuelta: fila.releasedAmount.toFixed(2),
      desde: toIso(fila.check.receivedDate ?? fila.check.createdAt),
    })),
    hoy,
  )
}

/** El detalle de una retención, para poder anotar la devolución. */
export async function retencionesDetalle(companyId: string) {
  return prisma.checkDeduction.findMany({
    where: { kind: 'RETENTION', check: { companyId } },
    include: {
      project: { select: { name: true } },
      check: { select: { reference: true, receivedDate: true, customer: { select: { name: true } } } },
    },
    orderBy: { createdAt: 'desc' },
  })
}
