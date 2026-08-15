import type { CurrentUser } from '@/lib/auth/rbac'
import { prisma } from '@/lib/db/client'
import { bloquea, type CierreAviso } from './index'

/**
 * Cerrar avisos contra la base de datos.
 *
 * La regla de qué bloquea vive en `./index.ts`, que es puro. Aquí solo lo que
 * necesita Prisma.
 */

export interface AvisoResult {
  ok: boolean
  message: string
}

/**
 * Cierra un aviso dejando dicho quién y por qué.
 *
 * La nota es OBLIGATORIA. Un aviso que se cierra sin explicación deja el mismo
 * hueco que no poder cerrarlo: dentro de un mes nadie sabe si se corrigió el
 * problema o si alguien lo tapó para poder seguir.
 */
export async function cerrarAviso(
  user: CurrentUser,
  input: { id: string; cierre: CierreAviso; nota: string },
): Promise<AvisoResult> {
  const nota = input.nota.trim()
  if (nota.length < 3) {
    return { ok: false, message: 'Escribe qué pasó con este aviso: sin nota no se cierra.' }
  }

  const aviso = await prisma.exception.findFirst({
    where: { id: input.id, companyId: user.companyId },
  })
  if (!aviso) return { ok: false, message: 'Ese aviso no existe en esta compañía.' }
  if (aviso.status !== 'OPEN') return { ok: false, message: 'Ese aviso ya estaba cerrado.' }

  await prisma.$transaction(async (tx) => {
    await tx.exception.update({
      where: { id: aviso.id },
      data: {
        status: input.cierre,
        resolvedById: user.id,
        resolvedAt: new Date(),
        resolutionNote: nota,
      },
    })

    await tx.auditLog.create({
      data: {
        companyId: user.companyId,
        userId: user.id,
        userEmailSnapshot: user.email,
        action: input.cierre === 'RESOLVED' ? 'EXCEPTION_RESOLVED' : 'EXCEPTION_DISMISSED',
        entityType: 'Exception',
        entityId: aviso.id,
        payrollWeekId: aviso.payrollWeekId,
        oldValueJson: { status: 'OPEN' },
        newValueJson: { status: input.cierre, code: aviso.code },
        changedFields: ['status'],
        reason: nota,
      },
    })
  })

  return {
    ok: true,
    message:
      input.cierre === 'RESOLVED'
        ? 'Aviso cerrado como resuelto.'
        : 'Aviso archivado. Queda el registro de quién y por qué.',
  }
}

/**
 * Cierra de una sola vez todos los avisos que trajo la importación del Excel.
 *
 * Son 41 de los 43 que hay hoy y NINGUNO se refiere a la semana en curso.
 * Cerrarlos uno por uno sería media hora de clics para dejar la pantalla como
 * debió estar desde el principio.
 */
export async function archivarAvisosDelHistorico(
  user: CurrentUser,
  nota: string,
): Promise<AvisoResult> {
  const texto = nota.trim() || 'Archivo del Excel: revisado en bloque, no afecta las semanas nuevas.'

  const abiertos = await prisma.exception.findMany({
    where: { companyId: user.companyId, status: 'OPEN', entityType: 'ImportBatch' },
    select: { id: true, code: true },
  })
  if (abiertos.length === 0) {
    return { ok: true, message: 'No quedaban avisos del histórico.' }
  }

  await prisma.$transaction(async (tx) => {
    await tx.exception.updateMany({
      where: { id: { in: abiertos.map((a) => a.id) } },
      data: {
        status: 'DISMISSED',
        resolvedById: user.id,
        resolvedAt: new Date(),
        resolutionNote: texto,
      },
    })

    await tx.auditLog.create({
      data: {
        companyId: user.companyId,
        userId: user.id,
        userEmailSnapshot: user.email,
        action: 'EXCEPTION_DISMISSED',
        entityType: 'Exception',
        newValueJson: { archivados: abiertos.length, codes: abiertos.map((a) => a.code) },
        changedFields: ['status'],
        reason: texto,
      },
    })
  })

  return { ok: true, message: `${abiertos.length} aviso(s) del histórico archivados.` }
}

/**
 * Los avisos abiertos de la compañía, ya clasificados por si frenan o no.
 *
 * `Exception` guarda `workerId` y `payrollWeekId` sueltos, sin relación de
 * Prisma, así que el nombre de la persona y la semana se buscan aparte: sin
 * ellos la pantalla diría «hay un aviso» sin decir de quién.
 */
export async function avisosAbiertos(companyId: string) {
  const filas = await prisma.exception.findMany({
    where: { companyId, status: 'OPEN' },
    orderBy: [{ level: 'asc' }, { detectedAt: 'desc' }],
  })

  const workerIds = [...new Set(filas.map((f) => f.workerId).filter((id): id is string => !!id))]
  const weekIds = [...new Set(filas.map((f) => f.payrollWeekId).filter((id): id is string => !!id))]

  const [workers, weeks] = await Promise.all([
    workerIds.length
      ? prisma.worker.findMany({
          where: { id: { in: workerIds } },
          select: { id: true, displayName: true },
        })
      : [],
    weekIds.length
      ? prisma.payrollWeek.findMany({
          where: { id: { in: weekIds } },
          select: { id: true, label: true, year: true },
        })
      : [],
  ])

  const workerById = new Map(workers.map((w) => [w.id, w]))
  const weekById = new Map(weeks.map((w) => [w.id, w]))

  return filas.map((fila) => ({
    ...fila,
    frena: bloquea(fila),
    worker: fila.workerId ? (workerById.get(fila.workerId) ?? null) : null,
    payrollWeek: fila.payrollWeekId ? (weekById.get(fila.payrollWeekId) ?? null) : null,
  }))
}

/**
 * Cuántos avisos frenan de verdad el trabajo de la semana.
 *
 * Se usa en la pantalla de inicio. Contar TODOS los críticos —como se hacía—
 * mostraba «4 errores que bloquean» cuando dos venían del Excel y no
 * bloqueaban nada, y mandaba a una pantalla sin nada que hacer.
 */
export async function cuantosFrenan(companyId: string): Promise<number> {
  const criticos = await prisma.exception.findMany({
    where: { companyId, status: 'OPEN', level: 'CRITICAL' },
    select: { level: true, status: true, code: true, entityType: true, entityId: true },
  })
  return criticos.filter(bloquea).length
}
