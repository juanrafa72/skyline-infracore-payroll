import { Badge, Button, EmptyState, PageHeader } from '@/components/ui'
import { assertCan } from '@/lib/auth/rbac'
import { getActiveCompany } from '@/lib/company/context'
import { avisosAbiertos } from '@/lib/payroll/exceptions/service'
import { ayudaDe, origen } from '@/lib/payroll/exceptions'
import { archivarHistorico, cerrar } from './actions'

export const dynamic = 'force-dynamic'

/**
 * Avisos: verlos, entenderlos y CERRARLOS.
 *
 * Esta pantalla existe porque faltaba. El sistema creaba avisos y no había
 * ningún sitio donde decir «ya lo revisé»: quien corregía el problema seguía
 * bloqueado para siempre, y la única salida era tocar la base de datos a mano.
 *
 * Dos grupos, y la separación es lo importante:
 *  - **Frenan un pago** — de esta semana, hay que atenderlos para poder seguir.
 *  - **Del archivo del Excel** — diferencias del histórico, que ya se pagó por
 *    fuera. Se ven, se explican y se archivan en bloque; no frenan nada.
 */
export default async function AvisosPage({
  searchParams,
}: {
  searchParams: Promise<{ msg?: string }>
}) {
  const user = await assertCan('payroll:view')
  const company = await getActiveCompany()
  const { msg } = await searchParams

  const avisos = await avisosAbiertos(company.id)
  const puedeCerrar = user.permissions.has('exception:resolve')

  const frenan = avisos.filter((a) => a.frena)
  const delHistorico = avisos.filter((a) => origen(a.code, a.entityType) === 'IMPORT')
  const otros = avisos.filter(
    (a) => !a.frena && origen(a.code, a.entityType) !== 'IMPORT',
  )

  return (
    <>
      <PageHeader
        title="Avisos"
        subtitle={`${company.displayName} · ${avisos.length} sin cerrar`}
      />

      {msg ? (
        <p className="mb-5 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3.5 text-sm">
          {msg}
        </p>
      ) : null}

      <div className="mb-6 flex flex-wrap items-center gap-2 text-sm">
        <Badge tone={frenan.length > 0 ? 'critical' : 'good'}>
          {frenan.length === 0 ? 'Nada frenado' : `${frenan.length} frenan un pago`}
        </Badge>
        <span className="text-[var(--muted)]">
          {delHistorico.length} del archivo del Excel · {otros.length} para revisar sin prisa
        </span>
      </div>

      {avisos.length === 0 ? (
        <EmptyState
          title="No hay avisos"
          hint="Cuando algo necesite tu revisión, aparece aquí con lo que hay que hacer."
        />
      ) : null}

      {/* Lo que de verdad detiene el trabajo de la semana. */}
      {frenan.length > 0 ? (
        <section className="mb-9">
          <h2 className="brand-label mb-1 text-[var(--muted)]">Frenan un pago</h2>
          <p className="mb-3 text-sm text-[var(--muted)]">
            Mientras estén abiertos, esas liquidaciones no se pueden aprobar. Revisa qué pasó y
            ciérralos con una nota.
          </p>
          <ul className="space-y-3">
            {avisos
              .filter((a) => a.frena)
              .map((aviso) => (
                <AvisoCard key={aviso.id} aviso={aviso} puedeCerrar={puedeCerrar} tono="critical" />
              ))}
          </ul>
        </section>
      ) : null}

      {/* El archivo del Excel: se explica y se archiva en bloque. */}
      {delHistorico.length > 0 ? (
        <section className="mb-9">
          <h2 className="brand-label mb-1 text-[var(--muted)]">Del archivo del Excel</h2>
          <p className="mb-3 text-sm text-[var(--muted)]">
            Diferencias que traía el histórico al importarlo. Esos días ya se pagaron por fuera,
            así que <strong>no frenan</strong> ninguna semana nueva. Puedes archivarlos todos de
            una vez.
          </p>

          {puedeCerrar ? (
            <form
              action={archivarHistorico}
              className="mb-4 flex flex-wrap items-end gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3.5"
            >
              <label className="flex-1 text-sm">
                <span className="mb-1 block text-[var(--muted)]">Nota (queda registrada)</span>
                <input
                  name="nota"
                  defaultValue="Archivo del Excel: revisado en bloque, no afecta las semanas nuevas."
                  className="h-9 w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 text-sm"
                />
              </label>
              <Button variant="secondary">Archivar los {delHistorico.length}</Button>
            </form>
          ) : null}

          <ul className="space-y-3">
            {delHistorico.map((aviso) => (
              <AvisoCard key={aviso.id} aviso={aviso} puedeCerrar={puedeCerrar} tono="muted" />
            ))}
          </ul>
        </section>
      ) : null}

      {otros.length > 0 ? (
        <section className="mb-9">
          <h2 className="brand-label mb-3 text-[var(--muted)]">Para revisar sin prisa</h2>
          <ul className="space-y-3">
            {otros.map((aviso) => (
              <AvisoCard key={aviso.id} aviso={aviso} puedeCerrar={puedeCerrar} tono="muted" />
            ))}
          </ul>
        </section>
      ) : null}
    </>
  )
}

type Aviso = Awaited<ReturnType<typeof avisosAbiertos>>[number]

/** Un aviso: qué es, qué hacer, y el botón para cerrarlo. */
function AvisoCard({
  aviso,
  puedeCerrar,
  tono,
}: {
  aviso: Aviso
  puedeCerrar: boolean
  tono: 'critical' | 'muted'
}) {
  const ayuda = ayudaDe(aviso.code)
  const marco =
    tono === 'critical'
      ? 'border-red-300 bg-red-50'
      : 'border-[var(--border)] bg-[var(--surface)]'

  return (
    <li className={`rounded-lg border p-4 text-sm ${marco}`}>
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={tono === 'critical' ? 'critical' : 'info'}>
          {tono === 'critical' ? 'Frena un pago' : 'Revisar'}
        </Badge>
        <span className="font-medium">{aviso.title}</span>
        {aviso.worker ? (
          <span className="text-[var(--muted)]">· {aviso.worker.displayName}</span>
        ) : null}
        {aviso.payrollWeek ? (
          <span className="text-[var(--muted)]">
            · {aviso.payrollWeek.label} · {aviso.payrollWeek.year}
          </span>
        ) : null}
      </div>

      <p className="mt-2">
        <span className="text-[var(--muted)]">Qué pasó: </span>
        {ayuda.queEs}
      </p>
      <p className="mt-1">
        <span className="text-[var(--muted)]">Qué hacer: </span>
        {ayuda.queHacer}
      </p>

      {puedeCerrar ? (
        <form action={cerrar} className="mt-3 flex flex-wrap items-end gap-2">
          <input type="hidden" name="id" value={aviso.id} />
          <label className="min-w-56 flex-1 text-sm">
            <span className="mb-1 block text-[var(--muted)]">Qué pasó con este aviso</span>
            <input
              name="nota"
              required
              minLength={3}
              placeholder="Ej.: revisé los días y quedaron correctos"
              className="h-9 w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 text-sm"
            />
          </label>
          <select
            name="cierre"
            defaultValue="RESOLVED"
            className="h-9 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 text-sm"
          >
            <option value="RESOLVED">Lo revisé y quedó bien</option>
            <option value="DISMISSED">No aplica, archivar</option>
          </select>
          <Button variant="secondary">Cerrar aviso</Button>
        </form>
      ) : (
        <p className="mt-3 text-[var(--muted)]">
          No tienes permiso para cerrar avisos. Pídeselo a quien administra.
        </p>
      )}
    </li>
  )
}
