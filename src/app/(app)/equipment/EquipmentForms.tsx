'use client'

import { useActionState, useState } from 'react'
import { createEquipment, createVendor, updateEquipment } from './actions'

export interface VendorOption {
  id: string
  name: string
}

export interface EquipmentListRow {
  id: string
  code: string
  name: string
  kindLabel: string
  ownership: string
  dailyCost: string | null
  vendorId: string | null
  vendorName: string | null
  /** Documentos de su hoja de vida vencidos o por vencer. */
  alertas: number
  /** Fuera de las listas = no se ofrece al armar la semana. */
  active: boolean
}

const OWNERSHIP = [
  ['RENTED', 'Rentado (se paga al proveedor)'],
  ['OWNED', 'Propio (costo interno)'],
  ['SUBCONTRACTED', 'Subcontratado'],
] as const

const KINDS = [
  ['MACHINE', 'Máquina'],
  ['VEHICLE', 'Vehículo'],
  ['TOOL', 'Herramienta'],
] as const

function Banner({ message }: { message: string | null }) {
  if (!message) return null
  const ok = message.startsWith('LISTO|')
  return (
    <p
      className={`mb-3 rounded-md border p-2.5 text-sm ${
        ok
          ? 'border-emerald-300 bg-emerald-50 text-emerald-900'
          : 'border-amber-300 bg-amber-50 text-amber-900'
      }`}
    >
      {message.replace(/^LISTO\|/, '')}
    </p>
  )
}

const INPUT =
  'h-9 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2.5 text-sm outline-none focus:border-[var(--accent)]'

/** Ajustar costo diario, proveedor y modalidad de un equipo existente. */
export function EquipmentRowForm({
  row,
  vendors,
}: {
  row: EquipmentListRow
  vendors: readonly VendorOption[]
}) {
  const [result, action, saving] = useActionState(updateEquipment, null)

  return (
    <div>
      <Banner message={result} />
      <form action={action} className="flex flex-wrap items-center gap-2">
        <input type="hidden" name="equipmentId" value={row.id} />
        <label className="flex items-center gap-1 text-xs text-[var(--muted)]">
          $
          <input
            name="dailyCost"
            defaultValue={row.dailyCost ?? ''}
            placeholder="450.00"
            inputMode="decimal"
            className={`${INPUT} w-24 tabular-nums`}
          />
          /día
        </label>
        <select name="vendorId" defaultValue={row.vendorId ?? ''} className={INPUT}>
          <option value="">— sin proveedor —</option>
          {vendors.map((vendor) => (
            <option key={vendor.id} value={vendor.id}>
              {vendor.name}
            </option>
          ))}
        </select>
        <select name="ownership" defaultValue={row.ownership} className={INPUT}>
          {OWNERSHIP.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <button
          type="submit"
          disabled={saving}
          className="h-9 rounded-md border border-[var(--border)] px-3 text-sm hover:bg-[var(--hover)] disabled:opacity-45"
        >
          {saving ? 'Guardando…' : 'Guardar'}
        </button>
      </form>
    </div>
  )
}

/** Crear equipo y proveedor sin salir de la pantalla. */
export function EquipmentCreatePanel({ vendors }: { vendors: readonly VendorOption[] }) {
  const [showVendor, setShowVendor] = useState(false)
  const [createResult, create, creating] = useActionState(createEquipment, null)
  const [vendorResult, addVendor, addingVendor] = useActionState(createVendor, null)

  return (
    <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
      <h2 className="text-sm font-semibold">Nuevo equipo</h2>
      <p className="mb-3 mt-0.5 text-xs text-[var(--muted)]">
        Solo los RENTADOS generan pago (al proveedor). Los propios son costo interno.
      </p>

      <Banner message={createResult} />
      <form action={create} className="flex flex-wrap items-end gap-2">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-[var(--muted)]">Nombre *</span>
          <input name="name" required placeholder="INTERNACIONAL 2014" className={`${INPUT} w-52`} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-[var(--muted)]">Código *</span>
          <input name="code" required placeholder="EQ-01" className={`${INPUT} w-24`} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-[var(--muted)]">Tipo</span>
          <select name="kind" className={INPUT}>
            {KINDS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-[var(--muted)]">Modalidad</span>
          <select name="ownership" defaultValue="RENTED" className={INPUT}>
            {OWNERSHIP.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-[var(--muted)]">Costo diario</span>
          <input name="dailyCost" placeholder="450.00" inputMode="decimal" className={`${INPUT} w-24`} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-[var(--muted)]">Proveedor</span>
          <select name="vendorId" className={INPUT}>
            <option value="">— sin proveedor —</option>
            {vendors.map((vendor) => (
              <option key={vendor.id} value={vendor.id}>
                {vendor.name}
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          disabled={creating}
          className="h-9 rounded-full bg-[var(--accent)] px-4 text-sm font-medium text-white hover:opacity-90 disabled:opacity-45"
        >
          {creating ? 'Creando…' : 'Crear equipo'}
        </button>
      </form>

      <div className="mt-4 border-t border-[var(--border)] pt-3">
        <button
          type="button"
          onClick={() => setShowVendor((value) => !value)}
          className="text-sm text-[var(--accent)] underline"
        >
          {showVendor ? 'Ocultar proveedor nuevo' : '+ Crear proveedor (quien cobra el alquiler)'}
        </button>

        {showVendor ? (
          <div className="mt-2">
            <Banner message={vendorResult} />
            <form action={addVendor} className="flex flex-wrap items-end gap-2">
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-[var(--muted)]">Nombre *</span>
                <input name="name" required placeholder="Rentas El Progreso" className={`${INPUT} w-52`} />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-[var(--muted)]">EIN / Tax ID</span>
                <input name="taxId" className={`${INPUT} w-32`} />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-[var(--muted)]">Contacto</span>
                <input name="contact" className={`${INPUT} w-40`} />
              </label>
              <button
                type="submit"
                disabled={addingVendor}
                className="h-9 rounded-md border border-[var(--border)] px-3 text-sm hover:bg-[var(--hover)] disabled:opacity-45"
              >
                {addingVendor ? 'Creando…' : 'Crear proveedor'}
              </button>
            </form>
          </div>
        ) : null}
      </div>
    </section>
  )
}
