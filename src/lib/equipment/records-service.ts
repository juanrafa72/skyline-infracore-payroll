import type { CurrentUser } from '@/lib/auth/rbac'
import { prisma } from '@/lib/db/client'
import {
  estadoDe,
  ordenarPorUrgencia,
  requiereAtencion,
  type EstadoDocumento,
  type RecordKind,
} from './records'

/**
 * La hoja de vida de los equipos contra la base de datos.
 *
 * Las reglas de vencimiento viven en `./records.ts`, que es puro y recibe la
 * fecha de hoy como dato. Aquí solo lo que necesita Prisma.
 */

export interface RecordResult {
  ok: boolean
  message: string
}

export interface NuevoDocumento {
  equipmentId: string
  kind: RecordKind
  title: string
  reference?: string | null
  issuedAt?: string | null
  expiresAt?: string | null
  alertDaysBefore?: number
  meterAtService?: string | null
  nextServiceMeter?: string | null
  fileName?: string | null
  fileRef?: string | null
  cost?: string | null
  vendorId?: string | null
  notes?: string | null
}

/** Fecha `YYYY-MM-DD` a `Date` en UTC, o null. */
function fecha(iso: string | null | undefined): Date | null {
  if (!iso) return null
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null
  return new Date(`${iso}T00:00:00Z`)
}

function entero(raw: string | null | undefined): number | null {
  if (!raw || raw.trim() === '') return null
  const n = Number(raw)
  return Number.isInteger(n) && n >= 0 ? n : null
}

/**
 * Agrega un documento a la hoja de vida de un equipo.
 *
 * La fecha de vencimiento se teclea, no se adivina del PDF: un aviso que
 * dependa de leer un documento escaneado falla justo cuando importa.
 */
export async function agregarDocumento(
  user: CurrentUser,
  input: NuevoDocumento,
): Promise<RecordResult> {
  const equipo = await prisma.equipment.findFirst({
    where: { id: input.equipmentId, companyId: user.companyId },
  })
  if (!equipo) return { ok: false, message: 'Ese equipo no existe en esta compañía.' }

  const title = input.title.trim()
  if (!title) return { ok: false, message: 'Ponle un nombre al documento.' }

  const issuedAt = fecha(input.issuedAt)
  const expiresAt = fecha(input.expiresAt)
  if (issuedAt && expiresAt && expiresAt < issuedAt) {
    return { ok: false, message: 'La fecha de vencimiento no puede ser anterior a la de expedición.' }
  }

  const aviso = input.alertDaysBefore ?? 30
  if (aviso < 0 || aviso > 365) {
    return { ok: false, message: 'El aviso va entre 0 y 365 días antes del vencimiento.' }
  }

  let cost: string | null = null
  if (input.cost && input.cost.trim() !== '') {
    const limpio = input.cost.replace(/[$\s,]/g, '')
    if (!/^\d+(\.\d{1,2})?$/.test(limpio)) {
      return { ok: false, message: `«${input.cost}» no es un monto válido. Escríbelo como 850.00` }
    }
    cost = Number(limpio).toFixed(2)
  }

  await prisma.$transaction(async (tx) => {
    const creado = await tx.equipmentRecord.create({
      data: {
        companyId: user.companyId,
        equipmentId: input.equipmentId,
        kind: input.kind,
        title,
        reference: input.reference?.trim() || null,
        issuedAt,
        expiresAt,
        alertDaysBefore: aviso,
        meterAtService: entero(input.meterAtService),
        nextServiceMeter: entero(input.nextServiceMeter),
        fileName: input.fileName?.trim() || null,
        fileRef: input.fileRef?.trim() || null,
        cost,
        vendorId: input.vendorId || null,
        notes: input.notes?.trim() || null,
        createdById: user.id,
      },
    })

    await tx.auditLog.create({
      data: {
        companyId: user.companyId,
        userId: user.id,
        userEmailSnapshot: user.email,
        action: 'EQUIPMENT_RECORD_ADDED',
        entityType: 'EquipmentRecord',
        entityId: creado.id,
        newValueJson: { equipo: equipo.name, tipo: input.kind, title, expiresAt: input.expiresAt },
        changedFields: ['equipmentRecord'],
        reason: `Hoja de vida de ${equipo.name}`,
      },
    })
  })

  return { ok: true, message: `«${title}» quedó en la hoja de vida de ${equipo.name}.` }
}

/**
 * Marca un documento como reemplazado.
 *
 * No se borra: el histórico de pólizas de un camión es parte de su hoja de
 * vida. Solo deja de avisar.
 */
export async function reemplazarDocumento(
  user: CurrentUser,
  id: string,
): Promise<RecordResult> {
  const doc = await prisma.equipmentRecord.findFirst({
    where: { id, companyId: user.companyId },
  })
  if (!doc) return { ok: false, message: 'Ese documento no existe en esta compañía.' }
  if (!doc.active) return { ok: true, message: 'Ese documento ya estaba archivado.' }

  await prisma.$transaction(async (tx) => {
    await tx.equipmentRecord.update({ where: { id }, data: { active: false } })
    await tx.auditLog.create({
      data: {
        companyId: user.companyId,
        userId: user.id,
        userEmailSnapshot: user.email,
        action: 'EQUIPMENT_RECORD_ARCHIVED',
        entityType: 'EquipmentRecord',
        entityId: id,
        oldValueJson: { active: true, title: doc.title },
        changedFields: ['active'],
        reason: 'Reemplazado por su renovación',
      },
    })
  })

  return { ok: true, message: `«${doc.title}» quedó archivado y deja de avisar.` }
}

export interface DocumentoView {
  id: string
  kind: RecordKind
  title: string
  reference: string | null
  issuedAt: string | null
  expiresAt: string | null
  alertDaysBefore: number
  fileName: string | null
  fileRef: string | null
  cost: string | null
  vendorName: string | null
  notes: string | null
  active: boolean
  estado: EstadoDocumento
}

const iso = (d: Date | null): string | null => (d ? d.toISOString().slice(0, 10) : null)

/** La hoja de vida completa de un equipo, ordenada por urgencia. */
export async function hojaDeVida(
  companyId: string,
  equipmentId: string,
  hoy: string,
): Promise<DocumentoView[]> {
  const filas = await prisma.equipmentRecord.findMany({
    where: { companyId, equipmentId },
    include: { vendor: { select: { name: true } } },
  })

  const vistas = filas.map((fila) => ({
    id: fila.id,
    kind: fila.kind as RecordKind,
    title: fila.title,
    reference: fila.reference,
    issuedAt: iso(fila.issuedAt),
    expiresAt: iso(fila.expiresAt),
    alertDaysBefore: fila.alertDaysBefore,
    fileName: fila.fileName,
    fileRef: fila.fileRef,
    cost: fila.cost ? fila.cost.toFixed(2) : null,
    vendorName: fila.vendor?.name ?? null,
    notes: fila.notes,
    active: fila.active,
    estado: estadoDe(
      { kind: fila.kind as RecordKind, expiresAt: iso(fila.expiresAt), alertDaysBefore: fila.alertDaysBefore, active: fila.active },
      hoy,
    ),
  }))

  return ordenarPorUrgencia(
    vistas.map((v) => ({ ...v, active: v.active })),
    hoy,
  ) as DocumentoView[]
}

export interface AvisoEquipo {
  equipmentId: string
  equipmentName: string
  recordId: string
  kind: RecordKind
  title: string
  expiresAt: string
  estado: EstadoDocumento
}

/**
 * Todo lo que está vencido o por vencer en la compañía.
 *
 * Alimenta el tablero de inicio: el negocio quiere enterarse ANTES, sin tener
 * que entrar equipo por equipo a revisar.
 */
export async function vencimientosPendientes(
  companyId: string,
  hoy: string,
): Promise<AvisoEquipo[]> {
  /*
   * Se traen solo los que tienen fecha y no están archivados, y el filtro fino
   * lo hace la regla pura: el plazo de aviso es por documento, así que no se
   * puede resolver con una sola comparación en SQL sin repetir la regla.
   */
  const filas = await prisma.equipmentRecord.findMany({
    where: { companyId, active: true, expiresAt: { not: null } },
    include: { equipment: { select: { id: true, name: true, status: true } } },
  })

  const avisos = filas
    .filter((fila) => fila.equipment.status === 'ACTIVE')
    .filter((fila) =>
      requiereAtencion(
        {
          kind: fila.kind as RecordKind,
          expiresAt: iso(fila.expiresAt),
          alertDaysBefore: fila.alertDaysBefore,
          active: fila.active,
        },
        hoy,
      ),
    )
    .map((fila) => ({
      equipmentId: fila.equipment.id,
      equipmentName: fila.equipment.name,
      recordId: fila.id,
      kind: fila.kind as RecordKind,
      title: fila.title,
      expiresAt: iso(fila.expiresAt)!,
      estado: estadoDe(
        {
          kind: fila.kind as RecordKind,
          expiresAt: iso(fila.expiresAt),
          alertDaysBefore: fila.alertDaysBefore,
          active: fila.active,
        },
        hoy,
      ),
    }))

  return avisos.sort(
    (a, b) => (a.estado.diasRestantes ?? 0) - (b.estado.diasRestantes ?? 0),
  )
}
