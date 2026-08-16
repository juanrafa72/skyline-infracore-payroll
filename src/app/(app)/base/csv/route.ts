import { assertCan } from '@/lib/auth/rbac'
import { getActiveCompany } from '@/lib/company/context'
import { aCsv } from '@/lib/payroll/base'
import { TOPE_DESCARGA, baseDeDatos, semanaPorDefecto } from '@/lib/payroll/base/service'

export const dynamic = 'force-dynamic'

/**
 * La base tal como se está viendo, para abrirla en Excel.
 *
 * Se respetan los MISMOS filtros de la pantalla: quien filtra una semana y
 * baja el archivo espera esa semana, no todo el histórico.
 */
export async function GET(request: Request) {
  await assertCan('payroll:view')
  const company = await getActiveCompany()
  const url = new URL(request.url)
  const q = (k: string) => url.searchParams.get(k) || null

  const semana = q('semana') ?? (await semanaPorDefecto(company.id)) ?? 'todas'

  const { rows } = await baseDeDatos(
    company.id,
    {
      week: semana,
      worker: q('persona'),
      project: q('proyecto'),
      tipo: q('tipo'),
      dayType: q('dia'),
      estado: q('estado'),
      q: q('q'),
      incluirArchivo: q('archivo') === '1',
    },
    // El archivo completo: aquí no hay nada que dibujar.
    TOPE_DESCARGA,
  )

  /*
   * El BOM (﻿) al principio.
   *
   * Sin él, Excel abre el archivo en su codificación vieja y los nombres con
   * tilde salen como «MARTÍNEZ» → «MARTÃNEZ». Es un byte invisible que
   * ahorra la pregunta de por qué se dañaron los acentos.
   */
  const csv = `﻿${aCsv(rows)}`
  const hoy = new Date().toISOString().slice(0, 10)

  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="base-${company.code.toLowerCase()}-${hoy}.csv"`,
      'Cache-Control': 'no-store',
    },
  })
}
