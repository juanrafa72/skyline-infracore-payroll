import type { CurrentUser } from '@/lib/auth/rbac'
import { prisma } from '@/lib/db/client'

/**
 * Sacar a alguien —o algo— de las listas, sin borrar nada.
 *
 * El negocio lo pidió por un caso concreto: cuando a una persona le suben la
 * tarifa se crea una ficha nueva —JHON $100 pasa a ser JHON1 $130— y la vieja
 * sigue apareciendo al escoger gente. Con dos JHON en la lista es cuestión de
 * tiempo marcar el equivocado y pagarle la tarifa vieja.
 *
 * Desactivar NO borra: los días, las nóminas, los pagos y la hoja de vida
 * quedan intactos, y el histórico sigue diciendo lo mismo. Solo deja de
 * ofrecerse al armar una semana nueva. Borrar la ficha rompería los pagos que
 * ya se le hicieron — por eso es un cambio de estado y jamás un DELETE.
 */

export interface AvailabilityResult {
  ok: boolean
  message: string
}

/** Estados en los que algo está a medio camino y no se puede retirar. */
const EN_PROCESO = [
  'PREPARED',
  'PENDING_APPROVAL',
  'APPROVED',
  'READY_TO_PAY',
  'PAYMENT_IN_PROCESS',
] as const

/**
 * Activa o desactiva a una persona.
 *
 * Se niega si tiene una nómina a mitad del proceso: quitarla de las listas la
 * dejaría a medio camino, y quien aprueba la vería sin poder encontrarla en
 * ninguna parte. Primero se termina de pagarle.
 */
export async function toggleWorker(
  user: CurrentUser,
  workerId: string,
): Promise<AvailabilityResult> {
  const worker = await prisma.worker.findFirst({
    where: { id: workerId, companyId: user.companyId },
  })
  if (!worker) return { ok: false, message: 'Esa persona no existe en esta compañía.' }

  const activar = worker.status !== 'ACTIVE'

  if (!activar) {
    const enProceso = await prisma.workerPayroll.count({
      where: { companyId: user.companyId, workerId, status: { in: [...EN_PROCESO] } },
    })
    if (enProceso > 0) {
      return {
        ok: false,
        message: `${worker.displayName} tiene ${enProceso} nómina(s) sin terminar de pagar. Termina el proceso antes de sacarlo de las listas.`,
      }
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.worker.update({
      where: { id: workerId },
      data: { status: activar ? 'ACTIVE' : 'INACTIVE' },
    })

    await tx.auditLog.create({
      data: {
        companyId: user.companyId,
        userId: user.id,
        userEmailSnapshot: user.email,
        action: activar ? 'WORKER_ACTIVATED' : 'WORKER_DEACTIVATED',
        entityType: 'Worker',
        entityId: workerId,
        oldValueJson: { status: worker.status },
        newValueJson: { status: activar ? 'ACTIVE' : 'INACTIVE' },
        changedFields: ['status'],
        reason: activar ? 'Vuelve a las listas' : 'Sale de las listas; su historia se conserva',
      },
    })
  })

  return {
    ok: true,
    message: activar
      ? `${worker.displayName} vuelve a aparecer al armar una semana.`
      : `${worker.displayName} ya no aparece al armar una semana. Su historia y sus pagos quedan intactos.`,
  }
}

/**
 * Activa o retira un equipo.
 *
 * Igual que con las personas: una máquina que ya no se usa estorba para
 * encontrar la que sí, y retirarla no toca sus días, sus liquidaciones ni su
 * hoja de vida.
 */
export async function toggleEquipment(
  user: CurrentUser,
  equipmentId: string,
): Promise<AvailabilityResult> {
  const machine = await prisma.equipment.findFirst({
    where: { id: equipmentId, companyId: user.companyId },
  })
  if (!machine) return { ok: false, message: 'Ese equipo no existe en esta compañía.' }

  const activar = machine.status !== 'ACTIVE'

  if (!activar) {
    const enProceso = await prisma.equipmentPayroll.count({
      where: { companyId: user.companyId, equipmentId, status: { in: [...EN_PROCESO] } },
    })
    if (enProceso > 0) {
      return {
        ok: false,
        message: `${machine.name} tiene ${enProceso} liquidación(es) sin terminar de pagar. Termina el proceso antes de retirarlo.`,
      }
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.equipment.update({
      where: { id: equipmentId },
      data: { status: activar ? 'ACTIVE' : 'RETIRED' },
    })

    await tx.auditLog.create({
      data: {
        companyId: user.companyId,
        userId: user.id,
        userEmailSnapshot: user.email,
        action: activar ? 'EQUIPMENT_ACTIVATED' : 'EQUIPMENT_RETIRED',
        entityType: 'Equipment',
        entityId: equipmentId,
        oldValueJson: { status: machine.status },
        newValueJson: { status: activar ? 'ACTIVE' : 'RETIRED' },
        changedFields: ['status'],
        reason: activar ? 'Vuelve a las listas' : 'Sale de las listas; su historia se conserva',
      },
    })
  })

  return {
    ok: true,
    message: activar
      ? `${machine.name} vuelve a aparecer en la semana.`
      : `${machine.name} ya no aparece en la semana. Su hoja de vida y sus pagos quedan intactos.`,
  }
}
