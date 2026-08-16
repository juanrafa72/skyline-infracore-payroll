'use client'

import { useActionState, useState } from 'react'
import { TIPO_REPORTE } from '@/lib/mail/reports'
import { addReportRecipient, editReportRecipient, toggleReportRecipient } from './actions'

export interface RecipientRow {
  id: string
  name: string
  email: string
  kinds: readonly string[]
  paymentRecipientName: string | null
  bcc: boolean
  active: boolean
}

function Aviso({ result }: { result: string | null }) {
  if (!result) return null
  const ok = result.startsWith('LISTO|')
  return (
    <p
      className={`mb-3 rounded-md border p-2.5 text-sm ${
        ok
          ? 'border-emerald-300 bg-emerald-50 text-emerald-900'
          : 'border-amber-300 bg-amber-50 text-amber-900'
      }`}
    >
      {result.replace(/^LISTO\|/, '')}
    </p>
  )
}

/**
 * Agregar a quién se le mandan los reportes.
 *
 * Dos formas, que son los dos casos que pidió el negocio: general (la auxiliar
 * contable, que recibe todo) o atado a una empresa receptora (que recibe SOLO
 * sus órdenes — a un contratista no se le manda el desprendible de otro).
 */
export function AddRecipientForm({
  paymentRecipients,
}: {
  paymentRecipients: ReadonlyArray<{ id: string; name: string }>
}) {
  const [result, action, saving] = useActionState(addReportRecipient, null)
  /*
   * Cerrado por defecto.
   *
   * El caso de todos los días es que el correo ya está puesto y no hay nada
   * que hacer. Un formulario de cuatro campos abierto encima de la lista hace
   * ver como trabajo pendiente algo que ya está resuelto.
   */
  const [abierto, setAbierto] = useState(false)

  if (!abierto) {
    return (
      <button
        type="button"
        onClick={() => setAbierto(true)}
        className="mb-4 inline-flex h-9 items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--surface)] px-4 text-sm font-medium hover:bg-[var(--hover)]"
      >
        <span aria-hidden className="text-base leading-none">+</span>
        Copiar a otro correo
      </button>
    )
  }

  return (
    <form
      action={action}
      className="mb-6 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4"
    >
      <Aviso result={result} />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="text-sm">
          <span className="mb-1 block text-[var(--muted)]">Nombre</span>
          <input
            name="name"
            required
            placeholder="Auxiliar contable"
            className="h-9 w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 text-sm"
          />
        </label>

        <label className="text-sm">
          <span className="mb-1 block text-[var(--muted)]">Correo</span>
          <input
            name="email"
            type="email"
            required
            placeholder="contabilidad@empresa.com"
            className="h-9 w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 text-sm"
          />
        </label>

        <label className="text-sm">
          <span className="mb-1 block text-[var(--muted)]">¿De qué empresa receptora?</span>
          <select
            name="paymentRecipientId"
            className="h-9 w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-2 text-sm"
          >
            <option value="">Todas — recibe todo</option>
            {paymentRecipients.map((r) => (
              <option key={r.id} value={r.id}>
                Solo las de {r.name}
              </option>
            ))}
          </select>
          <span className="mt-0.5 block text-[11px] text-[var(--muted)]">
            Si eliges una, solo recibe SUS órdenes.
          </span>
        </label>

        <fieldset className="text-sm">
          <legend className="mb-1 block text-[var(--muted)]">Qué recibe</legend>
          <div className="space-y-1">
            {Object.entries(TIPO_REPORTE).map(([code, etiqueta]) => (
              <label key={code} className="flex items-center gap-2 text-xs">
                <input type="checkbox" name="kinds" value={code} className="h-3.5 w-3.5" />
                {etiqueta}
              </label>
            ))}
            <span className="block text-[11px] text-[var(--muted)]">
              Sin marcar nada, recibe todo.
            </span>
          </div>
        </fieldset>
      </div>

      <label className="mt-3 flex items-center gap-2 text-sm">
        <input type="checkbox" name="bcc" className="h-4 w-4" />
        <span>
          Copia oculta
          <span className="ml-1 text-xs text-[var(--muted)]">
            — los demás no ven que también le llegó
          </span>
        </span>
      </label>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          type="submit"
          disabled={saving}
          className="brand-gradient inline-flex h-9 items-center rounded-full px-4 text-sm font-medium text-white shadow-sm hover:opacity-90 disabled:opacity-45"
        >
          {saving ? 'Guardando…' : 'Agregar destinatario'}
        </button>
        <button
          type="button"
          onClick={() => setAbierto(false)}
          className="inline-flex h-9 items-center rounded-full border border-[var(--border)] px-4 text-sm hover:bg-[var(--hover)]"
        >
          Cancelar
        </button>
      </div>
    </form>
  )
}

/**
 * Una fila de la lista, que se convierte en formulario al oprimir el lápiz.
 *
 * El formulario ocupa la fila ENTERA y no una celda: metido en la columna de
 * acciones, los campos apretaban las demás columnas y la tabla se movía de
 * sitio justo cuando uno va a leer el correo que está corrigiendo.
 */
export function RecipientRowView({
  row,
  canManage,
}: {
  row: RecipientRow
  canManage: boolean
}) {
  const [result, action, saving] = useActionState(editReportRecipient, null)
  const [editando, setEditando] = useState(false)

  if (editando) {
    return (
      <tr className="border-t border-[var(--border)] bg-[var(--hover)]">
        <td colSpan={5} className="px-3 py-3">
          <form action={action} className="flex flex-wrap items-end gap-3">
            <input type="hidden" name="id" value={row.id} />

            <label className="text-sm">
              <span className="mb-1 block text-xs text-[var(--muted)]">Nombre</span>
              <input
                name="name"
                defaultValue={row.name}
                required
                className="h-9 w-48 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 text-sm"
              />
            </label>

            <label className="text-sm">
              <span className="mb-1 block text-xs text-[var(--muted)]">Correo</span>
              <input
                name="email"
                type="email"
                defaultValue={row.email}
                required
                className="h-9 w-72 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 text-sm"
              />
            </label>

            <label className="flex h-9 items-center gap-2 text-sm">
              <input type="checkbox" name="bcc" defaultChecked={row.bcc} className="h-4 w-4" />
              copia oculta
            </label>

            <button
              type="submit"
              disabled={saving}
              className="brand-gradient inline-flex h-9 items-center rounded-full px-4 text-sm font-medium text-white disabled:opacity-45"
            >
              {saving ? 'Guardando…' : 'Guardar'}
            </button>
            <button
              type="button"
              onClick={() => setEditando(false)}
              className="inline-flex h-9 items-center rounded-full border border-[var(--border)] px-4 text-sm hover:bg-[var(--surface)]"
            >
              {/* Ya guardado, «cancelar» sonaría a deshacer lo que se acaba de hacer. */}
              {result?.startsWith('LISTO|') ? 'Cerrar' : 'Cancelar'}
            </button>

            {result ? (
              <span
                className={`text-sm ${
                  result.startsWith('LISTO|') ? 'text-emerald-800' : 'text-amber-800'
                }`}
              >
                {result.replace(/^LISTO\|/, '')}
              </span>
            ) : null}

            {/*
              A qué empresa receptora está atado NO se toca aquí: eso decide
              qué órdenes recibe, y cambiarlo junto con el correo haría que
              alguien empiece a ver desprendibles de un tercero sin notarlo.
            */}
            <span className="text-xs text-[var(--muted)]">
              {row.paymentRecipientName
                ? `Sigue recibiendo solo las órdenes de ${row.paymentRecipientName}.`
                : 'Sigue recibiendo todas las órdenes.'}
            </span>
          </form>
        </td>
      </tr>
    )
  }

  return (
    <tr className={`border-t border-[var(--border)] ${row.active ? '' : 'opacity-55'}`}>
      <td className="px-3 py-2.5">
        <span className="font-medium">{row.name}</span>
        {row.bcc ? <span className="ml-2 text-xs text-[var(--muted)]">copia oculta</span> : null}
        {!row.active ? (
          <span className="ml-2 text-xs text-[var(--muted)]">· desactivado</span>
        ) : null}
      </td>
      <td className="px-3 py-2.5">{row.email}</td>
      <td className="px-3 py-2.5 text-xs text-[var(--muted)]">
        {row.kinds.length === 0
          ? 'todo'
          : row.kinds.map((k) => TIPO_REPORTE[k as keyof typeof TIPO_REPORTE] ?? k).join(' · ')}
      </td>
      <td className="px-3 py-2.5 text-xs">
        {row.paymentRecipientName ? (
          <>solo {row.paymentRecipientName}</>
        ) : (
          <span className="text-[var(--muted)]">todas</span>
        )}
      </td>
      <td className="whitespace-nowrap px-3 py-2.5 text-right">
        {canManage ? (
          <>
            <button
              type="button"
              onClick={() => setEditando(true)}
              title={`Cambiar el nombre o el correo de ${row.name}`}
              className="rounded px-2 py-1 text-xs text-[var(--muted)] hover:bg-[var(--hover)]"
            >
              ✏️ editar
            </button>
            <ToggleRecipient row={row} />
          </>
        ) : null}
      </td>
    </tr>
  )
}

/** Activar o desactivar un destinatario. Nunca se borra: hay envíos que lo citan. */
export function ToggleRecipient({ row }: { row: RecipientRow }) {
  const [result, action, saving] = useActionState(toggleReportRecipient, null)

  return (
    <form action={action} className="inline">
      <input type="hidden" name="id" value={row.id} />
      <button
        type="submit"
        disabled={saving}
        className="rounded px-2 py-1 text-xs text-[var(--muted)] hover:bg-[var(--hover)] disabled:opacity-45"
        title={
          row.active
            ? 'Deja de recibir reportes. No se borra: los envíos ya hechos lo citan.'
            : 'Vuelve a recibir reportes.'
        }
      >
        {saving ? '…' : row.active ? 'desactivar' : 'activar'}
      </button>
      {result && !result.startsWith('LISTO|') ? (
        <span className="ml-2 text-xs text-amber-800">{result}</span>
      ) : null}
    </form>
  )
}
