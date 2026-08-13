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

/** Saca a una persona del período. No borra sus días si los tiene: avisa. */
export async function removeFromRoster(
  companyId: string,
  weekId: string,
  workerId: string,
): Promise<RosterResult> {
  const week = await prisma.payrollWeek.findFirst({ where: { id: weekId, companyId } })
  if (!week) return { ok: false, message: 'No se encontró el período.', added: 0, removed: 0 }

  const marked = await prisma.workEntry.count({
    where: { companyId, payrollWeekId: week.id, workerId },
  })
  if (marked > 0) {
    const worker = await prisma.worker.findUnique({
      where: { id: workerId },
      select: { displayName: true },
    })
    return {
      ok: false,
      added: 0,
      removed: 0,
      message:
        `${worker?.displayName ?? 'Esa persona'} tiene ${marked} día(s) marcado(s) esta semana. ` +
        'Déjalos en «—» y guarda antes de sacarla.',
    }
  }

  await prisma.$transaction(async (tx) => {
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
        newValueJson: { workerId },
        changedFields: ['members'],
      },
    })
  })

  return { ok: true, added: 0, removed: 1, message: 'Sacada del período.' }
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
