import type { CurrentUser } from '@/lib/auth/rbac'
import { prisma } from '@/lib/db/client'
import { detachPayable } from '@/lib/disbursement/detach'
import { FROZEN } from '@/lib/payroll/workflow'

/**
 * Volver una semana al principio.
 *
 * Sin esto no se puede ENSAYAR: se calcula, algo queda mal, y la semana se
 * queda a medias para siempre porque no hay camino de vuelta. Quien está
 * aprendiendo la aplicación necesita poder equivocarse y repetir.
 *
 * Dos cosas que NO hace, y son la razón de que se pueda ofrecer un botón así:
 *
 *  1. **Jamás toca dinero que ya salió.** Si algún pago está PAID, RECONCILED
 *     o CLOSED, no borra nada y lo dice. Corregir un pago hecho es un ajuste
 *     con rastro (regla 6), nunca un borrón.
 *  2. **Nunca borra los días marcados.** Deshace el CÁLCULO, no el trabajo:
 *     quién trabajó y en qué proyecto es información capturada, y volver a
 *     teclearla es justamente lo que hace odiosa una aplicación.
 */

export interface ResetResult {
  ok: boolean
  message: string
}

/** Qué se puede deshacer de esta semana, y qué lo impide. Sin tocar nada. */
export async function puedeReiniciar(
  companyId: string,
  weekId: string,
): Promise<{ ok: boolean; motivo?: string; cuenta: number }> {
  const [personas, cuadrillas, equipos] = await Promise.all([
    prisma.workerPayroll.findMany({
      where: { companyId, payrollWeekId: weekId },
      select: { status: true },
    }),
    prisma.crewPayroll.findMany({
      where: { companyId, payrollWeekId: weekId },
      select: { status: true },
    }),
    prisma.equipmentPayroll.findMany({
      where: { companyId, payrollWeekId: weekId },
      select: { status: true },
    }),
  ])

  const todos = [...personas, ...cuadrillas, ...equipos]
  const congelados = todos.filter((p) => FROZEN.includes(p.status as never))

  if (congelados.length > 0) {
    return {
      ok: false,
      cuenta: todos.length,
      motivo:
        `${congelados.length} pago(s) de esta semana ya se hicieron. ` +
        'Lo pagado no se borra: si hay que corregirlo se hace con un ajuste, que queda registrado.',
    }
  }

  return { ok: true, cuenta: todos.length }
}

/**
 * Borra los cálculos de la semana y la deja como antes de calcular.
 *
 * Se van: las liquidaciones de las tres clases (persona, cuadrilla, equipo),
 * sus renglones, los avisos de la semana y los renglones de orden que las
 * referenciaban. Se quedan: los días marcados, la gente elegida, la producción
 * capturada y los descuentos y adicionales que se anotaron a mano.
 */
export async function reiniciarSemana(
  user: CurrentUser,
  weekId: string,
  motivo: string,
): Promise<ResetResult> {
  const week = await prisma.payrollWeek.findFirst({
    where: { id: weekId, companyId: user.companyId },
    select: { id: true, label: true, year: true },
  })
  if (!week) return { ok: false, message: 'Esa semana no existe en esta compañía.' }

  const permiso = await puedeReiniciar(user.companyId, weekId)
  if (!permiso.ok) return { ok: false, message: permiso.motivo ?? 'No se puede reiniciar.' }
  if (permiso.cuenta === 0) {
    return { ok: false, message: 'Esta semana todavía no tiene nada calculado.' }
  }

  const razon = motivo.trim() || 'Se reinició la semana para volver a calcularla.'

  const [personas, cuadrillas, equipos] = await Promise.all([
    prisma.workerPayroll.findMany({
      where: { companyId: user.companyId, payrollWeekId: weekId },
      select: { id: true },
    }),
    prisma.crewPayroll.findMany({
      where: { companyId: user.companyId, payrollWeekId: weekId },
      select: { id: true },
    }),
    prisma.equipmentPayroll.findMany({
      where: { companyId: user.companyId, payrollWeekId: weekId },
      select: { id: true },
    }),
  ])

  await prisma.$transaction(async (tx) => {
    /*
     * Primero sacarlos de sus órdenes. Borrar la liquidación de una vez choca
     * con el FK RESTRICT del renglón, y con razón: una orden no puede quedar
     * apuntando al vacío. `detachPayable` además recalcula el total de la
     * orden y la anula si se queda sin renglones.
     */
    for (const p of personas) {
      await detachPayable(tx, { kind: 'WORKER', payableId: p.id }, razon)
    }
    for (const c of cuadrillas) {
      await detachPayable(tx, { kind: 'CREW', payableId: c.id }, razon)
    }
    for (const e of equipos) {
      await detachPayable(tx, { kind: 'EQUIPMENT', payableId: e.id }, razon)
    }

    // Los descuentos y adicionales que generó el motor se van con el cálculo;
    // los que alguien capturó a mano se quedan (`sourceType: MANUAL`).
    await tx.deduction.deleteMany({
      where: {
        companyId: user.companyId,
        workerPayroll: { payrollWeekId: weekId },
        sourceType: { not: 'MANUAL' },
      },
    })

    await tx.workerPayroll.deleteMany({ where: { companyId: user.companyId, payrollWeekId: weekId } })
    await tx.crewPayroll.deleteMany({ where: { companyId: user.companyId, payrollWeekId: weekId } })
    await tx.equipmentPayroll.deleteMany({
      where: { companyId: user.companyId, payrollWeekId: weekId },
    })

    // Los avisos de esta semana pierden su objeto: se van con él.
    await tx.exception.deleteMany({
      where: { companyId: user.companyId, payrollWeekId: weekId, status: 'OPEN' },
    })

    await tx.auditLog.create({
      data: {
        companyId: user.companyId,
        userId: user.id,
        userEmailSnapshot: user.email,
        action: 'WEEK_RESET',
        entityType: 'PayrollWeek',
        entityId: weekId,
        payrollWeekId: weekId,
        oldValueJson: {
          personas: personas.length,
          cuadrillas: cuadrillas.length,
          equipos: equipos.length,
        },
        changedFields: ['workerPayroll', 'crewPayroll', 'equipmentPayroll'],
        reason: razon,
      },
    })
  })

  const total = personas.length + cuadrillas.length + equipos.length
  return {
    ok: true,
    message:
      `${week.label} volvió al principio: se borraron ${total} liquidación(es). ` +
      'Los días marcados y la producción siguen ahí — solo hay que volver a calcular.',
  }
}
