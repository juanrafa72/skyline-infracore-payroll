import { prisma } from '@/lib/db/client'
import { type EstadoDeLaSemana } from './concurrencia'

/**
 * Quién tocó esta semana de último, y cuándo.
 *
 * Vive aparte de la acción a propósito: lo que decide si un guardado pisa el
 * trabajo ajeno tiene que poder probarse contra la base real. Una comprobación
 * que consulte por su cuenta no probaría nada — pasaría en verde con la
 * consulta equivocada.
 */
export async function estadoDeLaSemana(
  companyId: string,
  payrollWeekId: string,
): Promise<EstadoDeLaSemana> {
  const ultimo = await prisma.workEntry.findFirst({
    where: { companyId, payrollWeekId },
    orderBy: { updatedAt: 'desc' },
    select: { updatedAt: true, updatedById: true },
  })

  /*
   * Sin autor conocido no se acusa a nadie.
   *
   * Los días viejos —los que trajo el Excel y los guardados antes de que
   * existiera esta protección— no tienen quién los tocó. Tratarlos como «otra
   * persona» le pondría una pared a quien está capturando solo, que es el caso
   * de casi todos los días.
   */
  const tocadaPor = ultimo?.updatedById ?? null
  if (!tocadaPor) return { tocadaEn: null, tocadaPor: null, tocadaPorNombre: null }

  const otro = await prisma.user.findUnique({
    where: { id: tocadaPor },
    select: { name: true },
  })

  return {
    tocadaEn: ultimo?.updatedAt ?? null,
    tocadaPor,
    tocadaPorNombre: otro?.name ?? null,
  }
}
