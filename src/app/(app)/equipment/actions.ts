'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { assertCan } from '@/lib/auth/rbac'
import { getActiveCompany } from '@/lib/company/context'
import { prisma } from '@/lib/db/client'

/**
 * Catálogo de equipos y sus proveedores.
 *
 * Un equipo JAMÁS es una persona (regla 9) y jamás recibe pagos (BR-121): el
 * dinero de un alquiler es para su PROVEEDOR. Por eso el proveedor se
 * administra aquí mismo — sin él, la liquidación del equipo no se puede
 * aprobar.
 */

const MONEY = /^\d+(\.\d{1,2})?$/

const equipmentSchema = z.object({
  name: z.string().trim().min(1, 'El nombre es obligatorio'),
  code: z.string().trim().min(1, 'El código es obligatorio'),
  kind: z.enum(['MACHINE', 'VEHICLE', 'TOOL']),
  ownership: z.enum(['OWNED', 'RENTED', 'SUBCONTRACTED']),
  dailyCost: z.string().trim().optional(),
  vendorId: z.string().trim().optional(),
})

export async function createEquipment(
  _previous: string | null,
  formData: FormData,
): Promise<string> {
  const user = await assertCan('equipment:manage')
  const company = await getActiveCompany()

  const parsed = equipmentSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return parsed.error.issues[0]?.message ?? 'Faltan datos.'

  const data = parsed.data
  if (data.dailyCost && !MONEY.test(data.dailyCost)) {
    return 'El costo diario va en números con máximo 2 decimales.'
  }

  const duplicate = await prisma.equipment.findUnique({
    where: { companyId_code: { companyId: company.id, code: data.code } },
  })
  if (duplicate) return `Ya existe un equipo con el código ${data.code}.`

  const created = await prisma.equipment.create({
    data: {
      companyId: company.id,
      code: data.code,
      name: data.name,
      kind: data.kind,
      ownership: data.ownership,
      dailyCost: data.dailyCost || null,
      vendorId: data.vendorId || null,
    },
  })

  await prisma.auditLog.create({
    data: {
      companyId: company.id,
      userId: user.id,
      userEmailSnapshot: user.email,
      action: 'EQUIPMENT_CREATED',
      entityType: 'Equipment',
      entityId: created.id,
      newValueJson: { name: data.name, ownership: data.ownership, dailyCost: data.dailyCost ?? null },
      changedFields: ['name', 'ownership'],
    },
  })

  revalidatePath('/equipment')
  return `LISTO|Equipo ${data.name} creado.`
}

/**
 * Actualiza costo diario, proveedor y modalidad de un equipo.
 *
 * No toca liquidaciones pasadas: el costo se congela al calcular cada semana
 * (BR-032 aplicado a equipos), así que cambiarlo aquí solo afecta lo que se
 * calcule de aquí en adelante.
 */
export async function updateEquipment(
  _previous: string | null,
  formData: FormData,
): Promise<string> {
  const user = await assertCan('equipment:manage')
  const company = await getActiveCompany()

  const id = String(formData.get('equipmentId') ?? '')
  const dailyCost = String(formData.get('dailyCost') ?? '').trim()
  const vendorId = String(formData.get('vendorId') ?? '').trim()
  const ownership = String(formData.get('ownership') ?? '')

  const machine = await prisma.equipment.findFirst({ where: { id, companyId: company.id } })
  if (!machine) return 'Ese equipo no existe.'
  if (!['OWNED', 'RENTED', 'SUBCONTRACTED'].includes(ownership)) return 'Modalidad inválida.'
  if (dailyCost && !MONEY.test(dailyCost)) {
    return 'El costo diario va en números con máximo 2 decimales.'
  }

  await prisma.$transaction([
    prisma.equipment.update({
      where: { id },
      data: {
        dailyCost: dailyCost || null,
        vendorId: vendorId || null,
        ownership: ownership as 'OWNED' | 'RENTED' | 'SUBCONTRACTED',
      },
    }),
    prisma.auditLog.create({
      data: {
        companyId: company.id,
        userId: user.id,
        userEmailSnapshot: user.email,
        action: 'EQUIPMENT_UPDATED',
        entityType: 'Equipment',
        entityId: id,
        oldValueJson: {
          dailyCost: machine.dailyCost?.toFixed(2) ?? null,
          vendorId: machine.vendorId,
          ownership: machine.ownership,
        },
        newValueJson: { dailyCost: dailyCost || null, vendorId: vendorId || null, ownership },
        changedFields: ['dailyCost', 'vendorId', 'ownership'],
      },
    }),
  ])

  revalidatePath('/equipment')
  revalidatePath('/payroll')
  return `LISTO|${machine.name} actualizado. Las semanas ya calculadas no cambian.`
}

export async function createVendor(
  _previous: string | null,
  formData: FormData,
): Promise<string> {
  const user = await assertCan('equipment:manage')
  const company = await getActiveCompany()

  const name = String(formData.get('name') ?? '').trim()
  const taxId = String(formData.get('taxId') ?? '').trim()
  const contact = String(formData.get('contact') ?? '').trim()
  if (!name) return 'El nombre del proveedor es obligatorio.'

  const duplicate = await prisma.vendor.findUnique({
    where: { companyId_name: { companyId: company.id, name } },
  })
  if (duplicate) return `Ya existe un proveedor llamado ${name}.`

  const created = await prisma.vendor.create({
    data: {
      companyId: company.id,
      name,
      taxId: taxId || null,
      contact: contact || null,
      category: 'EQUIPO',
    },
  })

  await prisma.auditLog.create({
    data: {
      companyId: company.id,
      userId: user.id,
      userEmailSnapshot: user.email,
      action: 'VENDOR_CREATED',
      entityType: 'Vendor',
      entityId: created.id,
      newValueJson: { name },
      changedFields: ['name'],
    },
  })

  revalidatePath('/equipment')
  return `LISTO|Proveedor ${name} creado. Ya lo puedes asignar a un equipo.`
}
