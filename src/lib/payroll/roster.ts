import { prisma } from '@/lib/db/client'

/**
 * Quiénes están en un período de nómina.
 *
 * Vive aparte de las acciones de pantalla para poder probarlo contra la base
 * sin depender de Next. Devuelve resultados, **no lanza excepciones**: un
 * error de uso ("esa persona ya tiene días") tiene que llegarle al usuario como
 * un mensaje, no como una pantalla roja.
 */

export interface RosterResult {
  ok: boolean
  message: string
  added: number
  removed: number
}

export async function setRoster(
  companyId: string,
  weekId: string,
  workerIds: readonly string[],
): Promise<RosterResult> {
  const week = await prisma.payrollWeek.findFirst({ where: { id: weekId, companyId } })
  if (!week) return { ok: false, message: 'No se encontró el período.', added: 0, removed: 0 }
  if (week.status === 'CLOSED') {
    return { ok: false, message: 'Esta semana ya está cerrada.', added: 0, removed: 0 }
  }
  if (workerIds.length === 0) {
    return { ok: false, message: 'No marcaste a nadie.', added: 0, removed: 0 }
  }

  /*
   * Quien ya tiene días marcados SIEMPRE queda en la lista, se haya marcado o
   * no en la pantalla.
   *
   * Elegir a cuatro personas significa "agrega estas cuatro", no "saca a todas
   * las demás". Interpretarlo como un reemplazo total hacía que la pantalla se
   * bloqueara cuando la semana ya traía gente del histórico. Para sacar a
   * alguien está el botón de quitar, donde la intención sí es inequívoca.
   */
  const withDays = await prisma.workEntry.findMany({
    where: { companyId, payrollWeekId: week.id },
    select: { workerId: true },
    distinct: ['workerId'],
  })

  const chosen = new Set([...workerIds, ...withDays.map((row) => row.workerId)])

  const existing = await prisma.payrollWeekMember.findMany({
    where: { companyId, payrollWeekId: week.id },
  })

  let added = 0
  const removed = 0 // setRoster ya no saca a nadie: para eso está removeFromRoster

  await prisma.$transaction(async (tx) => {
    for (const workerId of chosen) {
      const before = existing.find((row) => row.workerId === workerId)
      if (!before || before.removedAt) added += 1
      await tx.payrollWeekMember.upsert({
        where: { payrollWeekId_workerId: { payrollWeekId: week.id, workerId } },
        update: { removedAt: null, removedById: null, removalReason: null },
        create: { companyId, payrollWeekId: week.id, workerId },
      })
    }

    await tx.auditLog.create({
      data: {
        companyId,
        action: 'PERIOD_ROSTER_SET',
        entityType: 'PayrollWeek',
        entityId: week.id,
        payrollWeekId: week.id,
        newValueJson: { total: chosen.size, added, removed },
        changedFields: ['members'],
      },
    })
  })

  return {
    ok: true,
    added,
    removed,
    message:
      added > 0
        ? `${added} persona(s) agregada(s). Ahora hay ${chosen.size} en la semana.`
        : `Ya estaban todas. Hay ${chosen.size} personas en la semana.`,
  }
}

/**
 * Saca a una persona de la semana, con sus días.
 *
 * En un solo paso: obligar a borrar los días a mano antes era tedioso y no
 * protegía nada, porque igual se podían borrar. Lo que sí se protege es la
 * nómina ya aprobada o pagada: ahí no se toca nada, y se dice por qué.
 *
 * Todo queda en el registro de auditoría, con cuántos días se borraron.
 */
export async function removeFromRoster(
  companyId: string,
  weekId: string,
  workerId: string,
): Promise<RosterResult> {
  const week = await prisma.payrollWeek.findFirst({ where: { id: weekId, companyId } })
  if (!week) return { ok: false, message: 'No se encontró el período.', added: 0, removed: 0 }
  if (week.status === 'CLOSED') {
    return { ok: false, message: 'Esta semana ya está cerrada.', added: 0, removed: 0 }
  }

  const worker = await prisma.worker.findUnique({
    where: { id: workerId },
    select: { displayName: true },
  })
  const name = worker?.displayName ?? 'Esa persona'

  // Si su nómina ya salió de borrador, no se toca desde aquí.
  const payroll = await prisma.workerPayroll.findUnique({
    where: {
      companyId_payrollWeekId_workerId: { companyId, payrollWeekId: week.id, workerId },
    },
  })
  if (payroll && !['DRAFT', 'PREPARED', 'REJECTED'].includes(payroll.status)) {
    return {
      ok: false,
      added: 0,
      removed: 0,
      message:
        `La nómina de ${name} ya está ${payroll.status === 'PAID' ? 'pagada' : 'en aprobación'}. ` +
        'Para cambiarla hay que devolverla primero.',
    }
  }

  const marked = await prisma.workEntry.count({
    where: { companyId, payrollWeekId: week.id, workerId },
  })

  await prisma.$transaction(async (tx) => {
    if (marked > 0) {
      await tx.workEntry.deleteMany({ where: { companyId, payrollWeekId: week.id, workerId } })
    }
    if (payroll) {
      await tx.payrollLine.deleteMany({ where: { workerPayrollId: payroll.id } })
      await tx.workerPayroll.delete({ where: { id: payroll.id } })
    }
    await tx.payrollWeekMember.upsert({
      where: { payrollWeekId_workerId: { payrollWeekId: week.id, workerId } },
      update: { removedAt: new Date(), removalReason: 'No trabajó este período' },
      create: {
        companyId,
        payrollWeekId: week.id,
        workerId,
        removedAt: new Date(),
        removalReason: 'No trabajó este período',
      },
    })
    await tx.auditLog.create({
      data: {
        companyId,
        action: 'PERIOD_MEMBER_REMOVED',
        entityType: 'PayrollWeek',
        entityId: week.id,
        payrollWeekId: week.id,
        newValueJson: { workerId, name, diasBorrados: marked },
        changedFields: ['members', ...(marked > 0 ? ['workEntries'] : [])],
        reason: marked > 0 ? `Se sacó a ${name} y se borraron sus ${marked} día(s)` : null,
      },
    })
  })

  return {
    ok: true,
    added: 0,
    removed: 1,
    message: marked > 0 ? `${name} salió de la semana (${marked} día(s) borrados).` : `${name} salió de la semana.`,
  }
}

/** Quiénes están hoy en el período (los que salen en la rejilla). */
export async function currentRoster(companyId: string, weekId: string): Promise<string[]> {
  const [members, withDays] = await Promise.all([
    prisma.payrollWeekMember.findMany({
      where: { companyId, payrollWeekId: weekId, removedAt: null },
      select: { workerId: true },
    }),
    prisma.workEntry.findMany({
      where: { companyId, payrollWeekId: weekId },
      select: { workerId: true },
      distinct: ['workerId'],
    }),
  ])
  return [...new Set([...members, ...withDays].map((row) => row.workerId))]
}
