import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db/client'

/**
 * Consecutivos de documentos.
 *
 * El número se saca con UNA sola instrucción atómica. Leer el último y sumarle
 * uno desde la aplicación parece equivalente y no lo es: dos personas
 * aprobando al mismo tiempo sacarían el mismo número, y dos órdenes con el
 * mismo consecutivo hacen imposible rastrear un movimiento de dinero.
 */

export type SequenceKind = 'DISBURSEMENT_ORDER'

interface Row {
  lastNumber: number
}

/** Siguiente número de la serie (compañía + tipo + año). */
export async function nextNumber(
  companyId: string,
  kind: SequenceKind,
  year: number,
  tx: Prisma.TransactionClient = prisma,
): Promise<number> {
  const rows = await tx.$queryRaw<Row[]>`
    INSERT INTO document_sequence ("id", "companyId", "kind", "year", "lastNumber", "updatedAt")
    VALUES (gen_random_uuid()::text, ${companyId}, ${kind}, ${year}, 1, now())
    ON CONFLICT ("companyId", "kind", "year")
    DO UPDATE SET "lastNumber" = document_sequence."lastNumber" + 1, "updatedAt" = now()
    RETURNING "lastNumber"
  `

  const row = rows[0]
  if (!row) throw new Error('No se pudo generar el consecutivo.')
  return row.lastNumber
}

/**
 * Consecutivo legible de una orden de desembolso.
 *
 * `OD-SKYLINE-2026-0007`. Lleva la compañía y el año adentro para que, viendo
 * solo el número en un extracto bancario o en un correo de contabilidad, se
 * sepa de dónde salió sin tener que abrir el sistema.
 */
export function formatOrderNumber(companyCode: string, year: number, number: number): string {
  return `OD-${companyCode}-${year}-${String(number).padStart(4, '0')}`
}
