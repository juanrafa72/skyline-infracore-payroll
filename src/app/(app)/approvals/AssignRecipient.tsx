'use client'

import { useActionState, useState } from 'react'
import { assignRecipientAction, createAndAssignRecipient } from './actions'

export interface RecipientOption {
  id: string
  name: string
  taxId: string | null
}

/** Campos de una empresa receptora nueva. Solo el nombre es obligatorio. */
const NEW_FIELDS = [
  ['name', 'Nombre', true],
  ['legalName', 'Razón social', false],
  ['taxId', 'EIN / Tax ID', false],
  ['contactName', 'Contacto', false],
  ['email', 'Correo', false],
  ['phone', 'Teléfono', false],
  ['bankName', 'Banco / plataforma', false],
  ['bankAccountLast4', 'Últimos 4 de la cuenta', false],
  ['paymentDetails', 'Datos de pago', false],
  ['notes', 'Notas', false],
] as const

type NewRecipient = Record<(typeof NEW_FIELDS)[number][0], string>

const EMPTY: NewRecipient = {
  name: '',
  legalName: '',
  taxId: '',
  contactName: '',
  email: '',
  phone: '',
  bankName: '',
  bankAccountLast4: '',
  paymentDetails: '',
  notes: '',
}

/**
 * Asignar la empresa receptora a las personas marcadas, o crear una nueva sin
 * salir de aquí.
 *
 * No usa `<form>`: esta barra vive dentro del formulario de aprobación, y un
 * formulario dentro de otro es HTML inválido — el navegador descarta el de
 * adentro y el botón termina enviando el de afuera.
 *
 * La receptora elegida (`choice`) la controla el panel de arriba: así el botón
 * de "usar sugerencia" puede precargarla. Precargar NO asigna — asignar sigue
 * siendo el clic explícito de este botón (BR-181).
 */
export function AssignRecipient({
  recipients,
  selectedIds,
  selectedCount,
  choice,
  onChoiceChange,
}: {
  recipients: readonly RecipientOption[]
  selectedIds: readonly string[]
  selectedCount: number
  choice: string
  onChoiceChange: (recipientId: string) => void
}) {
  const [creating, setCreating] = useState(false)
  const [insist, setInsist] = useState(false)
  const [draft, setDraft] = useState<NewRecipient>(EMPTY)

  const [assignResult, assign, assigning] = useActionState(assignRecipientAction, null)
  const [createResult, create, savingNew] = useActionState(createAndAssignRecipient, null)

  const result = createResult ?? assignResult
  const ok = result?.startsWith('LISTO|')
  const looksSimilar = result !== null && !ok && result.includes('Se parece mucho')

  const nothingSelected = selectedCount === 0

  function withSelection(): FormData {
    const data = new FormData()
    for (const id of selectedIds) data.append('payrollId', id)
    return data
  }

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
      <p className="text-sm font-semibold">Empresa receptora de los fondos</p>
      <p className="mt-0.5 text-xs text-[var(--muted)]">
        A quién se le transfiere el dinero para cubrir a las personas marcadas. Marca a todas las
        que se pagan igual y asígnalas de una sola vez.
      </p>

      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        <select
          value={choice}
          onChange={(event) => onChoiceChange(event.target.value)}
          className="h-9 min-w-[220px] flex-1 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2.5 text-sm"
        >
          <option value="">Escoge la empresa receptora…</option>
          {recipients.map((recipient) => (
            <option key={recipient.id} value={recipient.id}>
              {recipient.name}
              {recipient.taxId ? ` · ${recipient.taxId}` : ''}
            </option>
          ))}
        </select>

        <button
          type="button"
          disabled={nothingSelected || !choice || assigning}
          onClick={() => {
            const data = withSelection()
            data.set('recipientId', choice)
            assign(data)
          }}
          className="h-9 rounded-md bg-[var(--accent)] px-3.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-45"
        >
          {assigning
            ? 'Asignando…'
            : `Asignar a ${selectedCount} marcada${selectedCount === 1 ? '' : 's'}`}
        </button>

        <button
          type="button"
          onClick={() => setCreating((value) => !value)}
          className="h-9 rounded-md border border-[var(--border)] px-3 text-sm hover:bg-[var(--hover)]"
        >
          {creating ? 'Cancelar' : '+ Crear nueva empresa receptora'}
        </button>
      </div>

      {nothingSelected ? (
        <p className="mt-2 text-xs text-[var(--muted)]">
          Marca primero a las personas que se pagan con fondos a esa empresa.
        </p>
      ) : null}

      {creating ? (
        <div className="mt-3 rounded-md border border-[var(--border)] bg-[var(--hover)] p-3">
          <p className="text-xs font-semibold">Nueva empresa receptora</p>
          <p className="mb-2.5 mt-0.5 text-xs text-[var(--muted)]">
            Solo el nombre es obligatorio. Al crearla queda asignada a las {selectedCount}{' '}
            persona(s) marcadas.
          </p>

          <div className="grid gap-2 sm:grid-cols-2">
            {NEW_FIELDS.map(([field, label, required]) => (
              <label key={field} className="block">
                <span className="mb-1 block text-xs font-medium text-[var(--muted)]">
                  {label}
                  {required ? <span className="text-red-600"> *</span> : null}
                </span>
                <input
                  value={draft[field]}
                  onChange={(event) =>
                    setDraft((previous) => ({ ...previous, [field]: event.target.value }))
                  }
                  className="h-9 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-2.5 text-sm outline-none focus:border-[var(--accent)]"
                />
              </label>
            ))}
          </div>

          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={savingNew || draft.name.trim() === ''}
              onClick={() => {
                const data = withSelection()
                for (const [field] of NEW_FIELDS) data.set(field, draft[field])
                if (insist) data.set('confirmDifferent', '1')
                create(data)
              }}
              className="h-9 rounded-md bg-[var(--accent)] px-3.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-45"
            >
              {savingNew ? 'Creando…' : 'Crear y asignar'}
            </button>

            {looksSimilar && !insist ? (
              <button
                type="button"
                onClick={() => setInsist(true)}
                className="h-9 rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 text-sm hover:bg-[var(--hover)]"
              >
                Es otra empresa, créala igual
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {result ? (
        <p
          className={`mt-2.5 rounded-md border p-2.5 text-sm ${
            ok
              ? 'border-emerald-300 bg-emerald-50 text-emerald-900'
              : 'border-amber-300 bg-amber-50 text-amber-900'
          }`}
        >
          {result.replace(/^LISTO\|/, '')}
        </p>
      ) : null}
    </div>
  )
}
