'use client'

import { useActionState, useState } from 'react'
import {
  AVISO_POR_DEFECTO,
  ETIQUETA_VENCIMIENTO,
  TIPO_DOCUMENTO,
  TONO_VENCIMIENTO,
  type RecordKind,
} from '@/lib/equipment/records'
import { addRecord, archiveRecord } from './actions'

export interface RecordRow {
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
  estado: { estado: string; diasRestantes: number | null; mensaje: string }
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
 * Agregar un documento a la hoja de vida.
 *
 * La fecha de vencimiento se TECLEA. El negocio pidió que el sistema avise
 * antes de que se venza un seguro, y un aviso que dependa de que un robot
 * adivine la fecha dentro de un PDF escaneado falla justo cuando importa: se
 * equivoca una vez y uno se entera cuando ya venció.
 */
export function AddRecordForm({
  equipmentId,
  vendors,
}: {
  equipmentId: string
  vendors: ReadonlyArray<{ id: string; name: string }>
}) {
  const [result, action, saving] = useActionState(addRecord, null)
  const [kind, setKind] = useState<RecordKind>('INSURANCE')
  const [abierto, setAbierto] = useState(false)

  const esMantenimiento = kind === 'MAINTENANCE'

  if (!abierto) {
    return (
      <div className="mb-5">
        <Aviso result={result} />
        <button
          type="button"
          onClick={() => setAbierto(true)}
          className="brand-gradient inline-flex h-9 items-center rounded-full px-4 text-sm font-medium text-white shadow-sm hover:opacity-90"
        >
          + Agregar documento
        </button>
      </div>
    )
  }

  return (
    <form
      action={action}
      className="mb-5 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4"
    >
      <Aviso result={result} />
      <input type="hidden" name="equipmentId" value={equipmentId} />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <label className="text-sm">
          <span className="mb-1 block text-[var(--muted)]">Qué es</span>
          <select
            name="kind"
            value={kind}
            onChange={(e) => setKind(e.target.value as RecordKind)}
            className="h-9 w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-2 text-sm"
          >
            {Object.entries(TIPO_DOCUMENTO).map(([code, label]) => (
              <option key={code} value={code}>
                {label}
              </option>
            ))}
          </select>
        </label>

        <label className="text-sm sm:col-span-2">
          <span className="mb-1 block text-[var(--muted)]">Cómo se llama</span>
          <input
            name="title"
            required
            placeholder={
              esMantenimiento ? 'Ej.: Cambio de aceite' : 'Ej.: Póliza todo riesgo 2026'
            }
            className="h-9 w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 text-sm"
          />
        </label>

        <label className="text-sm">
          <span className="mb-1 block text-[var(--muted)]">
            Número {esMantenimiento ? '(factura)' : '(póliza, placa)'}
          </span>
          <input
            name="reference"
            className="h-9 w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 text-sm"
          />
        </label>

        <label className="text-sm">
          <span className="mb-1 block text-[var(--muted)]">Desde</span>
          <input
            type="date"
            name="issuedAt"
            className="h-9 w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 text-sm"
          />
        </label>

        <label className="text-sm">
          <span className="mb-1 block text-[var(--muted)]">
            {esMantenimiento ? 'Próximo servicio' : 'Vence'}
          </span>
          <input
            type="date"
            name="expiresAt"
            className="h-9 w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 text-sm"
          />
          <span className="mt-0.5 block text-[11px] text-[var(--muted)]">
            Déjalo vacío si no vence (un título de propiedad).
          </span>
        </label>

        <label className="text-sm">
          <span className="mb-1 block text-[var(--muted)]">Avisarme con</span>
          <div className="flex items-center gap-2">
            <input
              type="number"
              name="alertDaysBefore"
              min={0}
              max={365}
              defaultValue={AVISO_POR_DEFECTO[kind]}
              key={kind}
              className="h-9 w-20 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 text-right text-sm tabular-nums"
            />
            <span className="text-sm text-[var(--muted)]">días de anticipación</span>
          </div>
        </label>

        <label className="text-sm">
          <span className="mb-1 block text-[var(--muted)]">Cuánto costó</span>
          <input
            name="cost"
            inputMode="decimal"
            placeholder="0.00"
            className="h-9 w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 text-right text-sm tabular-nums"
          />
        </label>

        <label className="text-sm">
          <span className="mb-1 block text-[var(--muted)]">Quién lo expidió / lo hizo</span>
          <select
            name="vendorId"
            className="h-9 w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-2 text-sm"
          >
            <option value="">— sin especificar —</option>
            {vendors.map((vendor) => (
              <option key={vendor.id} value={vendor.id}>
                {vendor.name}
              </option>
            ))}
          </select>
        </label>

        {esMantenimiento ? (
          <>
            <label className="text-sm">
              <span className="mb-1 block text-[var(--muted)]">Kilometraje / horas ahora</span>
              <input
                name="meterAtService"
                inputMode="numeric"
                className="h-9 w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 text-right text-sm tabular-nums"
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-[var(--muted)]">Próximo servicio a los</span>
              <input
                name="nextServiceMeter"
                inputMode="numeric"
                className="h-9 w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 text-right text-sm tabular-nums"
              />
            </label>
          </>
        ) : null}

        <label className="text-sm sm:col-span-2">
          <span className="mb-1 block text-[var(--muted)]">Nombre del archivo</span>
          <input
            name="fileName"
            placeholder="poliza-2026.pdf"
            className="h-9 w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 text-sm"
          />
        </label>

        <label className="text-sm sm:col-span-2 lg:col-span-3">
          <span className="mb-1 block text-[var(--muted)]">Enlace al archivo en SharePoint</span>
          <input
            name="fileRef"
            placeholder="https://…"
            className="h-9 w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 text-sm"
          />
          <span className="mt-0.5 block text-[11px] text-[var(--muted)]">
            El archivo vive en SharePoint; aquí queda la referencia para encontrarlo. El aviso de
            vencimiento funciona igual aunque todavía no lo hayas subido.
          </span>
        </label>

        <label className="text-sm sm:col-span-2 lg:col-span-3">
          <span className="mb-1 block text-[var(--muted)]">Notas</span>
          <input
            name="notes"
            className="h-9 w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 text-sm"
          />
        </label>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="submit"
          disabled={saving}
          className="brand-gradient inline-flex h-9 items-center rounded-full px-4 text-sm font-medium text-white shadow-sm hover:opacity-90 disabled:opacity-45"
        >
          {saving ? 'Guardando…' : 'Guardar documento'}
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

/** Un documento de la hoja de vida, con su estado y el botón de archivar. */
export function RecordCard({
  equipmentId,
  record,
  canManage,
}: {
  equipmentId: string
  record: RecordRow
  canManage: boolean
}) {
  const [result, action, saving] = useActionState(archiveRecord, null)
  const tono = TONO_VENCIMIENTO[record.estado.estado as keyof typeof TONO_VENCIMIENTO]

  const marco =
    tono === 'critical'
      ? 'border-red-300 bg-red-50'
      : tono === 'warning'
        ? 'border-amber-300 bg-amber-50'
        : 'border-[var(--border)] bg-[var(--surface)]'

  return (
    <li className={`rounded-lg border p-3.5 text-sm ${record.active ? marco : 'border-[var(--border)] bg-[var(--bg)] opacity-70'}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <span className="font-medium">{record.title}</span>
          <span className="ml-2 text-xs text-[var(--muted)]">
            {TIPO_DOCUMENTO[record.kind]}
            {record.reference ? ` · ${record.reference}` : ''}
          </span>
        </div>
        <span
          className={`rounded-full px-2.5 py-1 text-xs font-medium ${
            !record.active
              ? 'bg-[var(--hover)] text-[var(--muted)]'
              : tono === 'critical'
                ? 'bg-red-600 text-white'
                : tono === 'warning'
                  ? 'bg-amber-600 text-white'
                  : tono === 'good'
                    ? 'bg-emerald-600 text-white'
                    : 'bg-[var(--hover)] text-[var(--muted)]'
          }`}
        >
          {record.active
            ? ETIQUETA_VENCIMIENTO[record.estado.estado as keyof typeof ETIQUETA_VENCIMIENTO]
            : 'Archivado'}
        </span>
      </div>

      <p className="mt-1">{record.estado.mensaje}</p>

      <p className="mt-1 text-xs text-[var(--muted)]">
        {record.issuedAt ? `Desde ${record.issuedAt}` : 'Sin fecha de expedición'}
        {record.expiresAt ? ` · vence ${record.expiresAt}` : ''}
        {record.active && record.expiresAt ? ` · avisa ${record.alertDaysBefore} días antes` : ''}
        {record.vendorName ? ` · ${record.vendorName}` : ''}
        {record.cost ? ` · $${Number(record.cost).toLocaleString('en-US', { minimumFractionDigits: 2 })}` : ''}
      </p>

      {record.notes ? <p className="mt-1 text-xs text-[var(--muted)]">{record.notes}</p> : null}

      <div className="mt-2 flex flex-wrap items-center gap-3">
        {record.fileRef ? (
          <a
            href={record.fileRef}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs font-medium underline"
          >
            Abrir {record.fileName ?? 'el archivo'} ↗
          </a>
        ) : (
          <span className="text-xs text-[var(--muted)]">Sin archivo adjunto</span>
        )}

        {canManage && record.active ? (
          <form action={action}>
            <input type="hidden" name="recordId" value={record.id} />
            <input type="hidden" name="equipmentId" value={equipmentId} />
            <button
              type="submit"
              disabled={saving}
              className="rounded px-2 py-1 text-xs text-[var(--muted)] hover:bg-[var(--hover)] disabled:opacity-45"
              title="Deja de avisar, pero se conserva en el histórico"
            >
              {saving ? 'archivando…' : 'archivar'}
            </button>
          </form>
        ) : null}
      </div>

      {result && !result.startsWith('LISTO|') ? (
        <p className="mt-2 text-xs text-amber-800">{result}</p>
      ) : null}
    </li>
  )
}
