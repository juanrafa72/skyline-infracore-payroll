/**
 * Revisa que TODAS las pantallas abran sin error, en LAS DOS compañías.
 *
 * `tsc` no atrapa los errores que solo aparecen al consultar la base (una
 * relación mal escrita, por ejemplo). Esto sí: pide cada página al servidor y
 * falla si revienta al armarse.
 *
 * Uso:  npm run dev   (en otra terminal)   y luego   npm run smoke
 */
const BASE = process.env.SMOKE_BASE ?? 'http://localhost:3100'

const ROUTES = [
  '/',
  '/dashboard',
  '/workers',
  '/workers/new',
  '/crews',
  '/projects',
  '/customers',
  '/payroll',
  '/reports',
]

// Señales de que la página reventó al renderizarse.
const ERROR_MARKERS = [
  'PrismaClientValidationError',
  'PrismaClientKnownRequestError',
  'PrismaClientUnknownRequestError',
  'Internal Server Error',
]

// Cuando el render falla, Next NO emite el <title> de la aplicación.
// Su presencia es la prueba de que la pantalla se armó completa.
const APP_TITLE = 'Payroll · Skyline Advance Tech / Infracore'

async function get(route, companyId) {
  const headers = companyId ? { Cookie: `active_company=${companyId}` } : {}
  const response = await fetch(`${BASE}${route}`, { headers, redirect: 'follow' })
  return { status: response.status, body: await response.text() }
}

function check(route, { status, body }) {
  const marker = ERROR_MARKERS.find((needle) => body.includes(needle))
  const rendered = body.includes(APP_TITLE)
  if (status !== 200 || marker || !rendered) {
    return marker ?? (rendered ? `HTTP ${status}` : 'la pantalla no se armó')
  }
  return null
}

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'

async function main() {
  let dashboard
  try {
    dashboard = await get('/dashboard')
  } catch (error) {
    console.error(`No hay servidor en ${BASE}. Corre "npm run dev" primero.`)
    console.error(error.message)
    process.exit(1)
  }

  const companies = [
    ...new Set([...dashboard.body.matchAll(new RegExp(`value="(${UUID})"`, 'g'))].map((m) => m[1])),
  ]

  if (companies.length === 0) {
    console.error('No se encontró ninguna compañía. ¿Falta "npm run db:seed"?')
    process.exit(1)
  }

  let failed = 0
  let total = 0

  for (const companyId of companies) {
    const label = (await get('/dashboard', companyId)).body.match(
      /<option value="[^"]+" selected="">([^<]+)</,
    )
    console.log(`\nCompañía ${label?.[1] ?? companyId}`)

    // Rutas con id: se descubren de los listados de esta misma compañía.
    const dynamic = []
    for (const [list, prefix] of [
      ['/workers', '/workers/'],
      ['/payroll', '/payroll/'],
    ]) {
      const html = (await get(list, companyId)).body
      const found = html.match(new RegExp(`${prefix}(${UUID})`))
      if (found) dynamic.push(`${prefix}${found[1]}`)
    }

    for (const route of [...ROUTES, ...dynamic]) {
      total += 1
      let result
      try {
        result = await get(route, companyId)
      } catch (error) {
        console.log(`  FALLA  ${route}  → sin respuesta (${error.message})`)
        failed += 1
        continue
      }
      const reason = check(route, result)
      if (reason) {
        console.log(`  FALLA  ${route}  → ${reason}`)
        failed += 1
      } else {
        console.log(`  ok     ${route}`)
      }
    }
  }

  console.log(`\n${total - failed}/${total} pantallas abren correctamente.`)
  if (failed > 0) process.exit(1)
}

await main()
