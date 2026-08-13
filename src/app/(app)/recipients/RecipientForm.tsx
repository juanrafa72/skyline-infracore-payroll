'use client'

import { useActionState, useState } from 'react'
import { Button, Field } from '@/components/ui'
import { createRecipientAction, updateRecipientAction } from './actions'

export interface RecipientValues {
  id?: string
  name?: string
  legalName?: string | null
  taxId?: string | null
  contactName?: string | null
  email?: string | null
  phone?: string | null
  bankName?: string | null
  bankAccountLast4?: string | null
  paymentDetails?: string | null
  notes?: string | null
}

/**
 * Alta y edición de una empresa receptora.
 *
 * Lo único obligatorio es el nombre. Pedir EIN, banco y contacto para poder
 * registrar a quién se le manda plata frenaría el trabajo por datos que casi
 * siempre llegan después.
 */
export function RecipientForm({
  mode,
  values,
  onDone,
  compact = false,
}: {
  mode: 'create' | 'edit'
  values?: RecipientValues
  onDone?: (recipientName: string) => void
  compact?: boolean
}) {
  const action = mode === 'create' ? createRecipientAction : updateRecipientAction
  const [result, submit, pending] = useActionState(
    async (previous: string | null, formData: FormData) => {
      const message = await action(previous, formData)
      if (message.startsWith('LISTO|')) {
        onDone?.(String(formData.get('name') ?? ''))
      }
      return message
    },
    null,
  )

  // Un nombre parecido no bloquea: avisa, y quien conoce el negocio decide.
  const [insist, setInsist] = useState(false)
  const failed = result !== null && !result.startsWith('LISTO|')
  const looksSimilar = failed && result.includes('Se parece mucho')

  return (
    <form action={submit} className="space-y-3">
      {values?.id ? <input type="hidden" name="recipientId" value={values.id} /> : null}
      {insist ? <input type="hidden" name="confirmDifferent" value="1" /> : null}

      <Field
        label="Nombre de la empresa receptora"
        name="name"
        required
        defaultValue={values?.name ?? ''}
        hint="Con lo que la reconoces. Es lo único obligatorio."
      />

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Razón social" name="legalName" defaultValue={values?.legalName ?? ''} />
        <Field label="EIN / Tax ID" name="taxId" defaultValue={values?.taxId ?? ''} />
      </div>

      {compact ? null : (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Contacto" name="contactName" defaultValue={values?.contactName ?? ''} />
            <Field label="Teléfono" name="phone" defaultValue={values?.phone ?? ''} />
          </div>
          <Field label="Correo" name="email" type="email" defaultValue={values?.email ?? ''} />
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Banco / plataforma" name="bankName" defaultValue={values?.bankName ?? ''} />
            <Field
              label="Últimos 4 de la cuenta"
              name="bankAccountLast4"
              defaultValue={values?.bankAccountLast4 ?? ''}
              hint="Solo los últimos 4. El número completo no se guarda aquí."
            />
          </div>
          <Field
            label="Datos de pago"
            name="paymentDetails"
            defaultValue={values?.paymentDetails ?? ''}
            hint="Zelle, routing, o cómo se le transfiere."
          />
          <Field label="Notas" name="notes" defaultValue={values?.notes ?? ''} />
        </>
      )}

      {result ? (
        <p
          className={`rounded-md border p-2.5 text-sm ${
            failed
              ? 'border-amber-300 bg-amber-50 text-amber-900'
              : 'border-emerald-300 bg-emerald-50 text-emerald-900'
          }`}
        >
          {result.replace(/^LISTO\|/, '')}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button disabled={pending}>
          {pending ? 'Guardando…' : mode === 'create' ? 'Crear empresa receptora' : 'Guardar cambios'}
        </Button>

        {looksSimilar && !insist ? (
          <button
            type="button"
            onClick={() => setInsist(true)}
            className="h-9 rounded-md border border-[var(--border)] px-3 text-sm hover:bg-[var(--hover)]"
          >
            Es otra empresa, créala igual
          </button>
        ) : null}
      </div>
    </form>
  )
}
