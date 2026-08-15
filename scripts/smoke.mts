/**
 * Revisa que TODAS las pantallas abran sin error, en LAS DOS compañías.
 *
 * `tsc` no atrapa los errores que solo aparecen al consultar la base (una
 * relación mal escrita, por ejemplo). Esto sí: pide cada página al servidor y
 * falla si revienta al armarse.
 *
 * Uso local:      npm run dev   (en otra terminal)   y luego   npm run smoke
 * Uso publicado:  SMOKE_BASE=https://... SMOKE_PASSWORD=... npm run smoke
 */
import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { databaseUrl } from '../src/lib/db/url'
import { seal } from '../src/lib/auth/session'

const BASE = process.env.SMOKE_BASE ?? 'http://localhost:3100'

/**
 * La aplicación exige sesión. Para revisarla se crea una sesión temporal del
 * primer administrador y se borra al terminar. No se usan contraseñas.
 */
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl() }) })

async function openSession(): Promise<{
  cookie: string
  sessionId: string
  /** Compañía activa de esa sesión: todo lo que se pida debe ser de ella. */
  companyId: string | null
}> {
  const admin = await prisma.user.findFirst({
    where: { status: 'ACTIVE', companyRoles: { some: { role: { code: 'SUPER_ADMIN' } } } },
    include: { companyRoles: true },
  })
  if (!admin) {
    console.error('No hay un administrador. Corre: npm run user:create "Nombre" correo SUPER_ADMIN')
    process.exit(1)
  }
  const companyId = admin.companyRoles[0]?.companyId ?? null
  const session = await prisma.userSession.create({
    data: {
      userId: admin.id,
      expiresAt: new Date(Date.now() + 10 * 60_000),
      activeCompanyId: companyId,
      userAgent: 'smoke',
    },
  })
  return { cookie: await seal(session.id), sessionId: session.id, companyId }
}

let SESSION_COOKIE = ''

const ROUTES = [
  '/',
  '/inicio',
  '/dashboard',
  '/catalogos',
  '/workers',
  '/workers/new',
  '/worker-rates',
  '/crews',
  '/contractors',
  '/equipment',
  '/projects',
  '/production',
  '/margin',
  '/margin?desde=2026-01-01&hasta=2026-12-31',
  '/advances',
  '/billing-rates',
  '/approvals',
  '/disbursements',
  '/recipients',
  '/payments',
  '/users',
  '/customers',
  '/payroll',
  '/reports',
  '/change-password',
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

async function get(route: string): Promise<{ status: number; body: string }> {
  const response = await fetch(`${BASE}${route}`, {
    headers: { Cookie: `payroll_session=${SESSION_COOKIE}` },
    redirect: 'follow',
  })
  return { status: response.status, body: await response.text() }
}

/**
 * Formularios anidados.
 *
 * Un <form> dentro de otro <form> es HTML inválido: el navegador descarta el de
 * adentro y su botón termina enviando el formulario de afuera. La página abre
 * bien, compila bien, y el botón simplemente no hace lo que dice.
 *
 * Ya rompió el botón de "quitar" en la nómina. Se revisa sobre el HTML que
 * realmente se sirve, así que da igual en qué componente esté el error.
 */
function nestedForms(body: string): number {
  let depth = 0
  let worst = 0
  const tags = body.match(/<\/?form\b[^>]*>/gi) ?? []
  for (const tag of tags) {
    if (tag.startsWith('</')) depth = Math.max(0, depth - 1)
    else {
      depth += 1
      worst = Math.max(worst, depth)
    }
  }
  return worst
}

function check(route: string, { status, body }: { status: number; body: string }) {
  const marker = ERROR_MARKERS.find((needle) => body.includes(needle))
  const rendered = body.includes(APP_TITLE)
  if (status !== 200 || marker || !rendered) {
    return marker ?? (rendered ? `HTTP ${status}` : 'la pantalla no se armó')
  }

  const depth = nestedForms(body)
  if (depth > 1) {
    return `formulario dentro de otro formulario (${depth} niveles) — algún botón no va a funcionar`
  }

  // Un código interno en pantalla es un error: todo debe estar en español.
  const rawCode = /(?:>|\s)(PENDING_APPROVAL|DAILY_RATE|FULL_DAY|IMPORTED_HISTORICAL|READY_TO_PAY)(?:<|\s)/.exec(
    body.replace(/<script[\s\S]*?<\/script>/g, ''),
  )
  if (rawCode) return `muestra el código interno "${rawCode[1]}" en vez de texto en español`

  return null
}

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'

async function main() {
  const { cookie, sessionId, companyId } = await openSession()
  SESSION_COOKIE = cookie

  let dashboard
  try {
    dashboard = await get('/dashboard')
  } catch (error) {
    console.error(`No hay servidor en ${BASE}. Corre "npm run dev" primero.`)
    console.error((error as Error).message)
    process.exit(1)
  }

  if (dashboard.body.includes('Entrar') && !dashboard.body.includes(APP_TITLE)) {
    console.error('La sesión no fue aceptada. ¿Coincide SESSION_SECRET con el del servidor?')
    process.exit(1)
  }

  // Rutas con id: se descubren de los listados.
  const dynamic: string[] = []
  for (const [list, prefix] of [
    ['/workers', '/workers/'],
    ['/crews', '/crews/'],
    ['/contractors', '/contractors/'],
  ] as const) {
    const html = (await get(list)).body
    const found = html.match(new RegExp(`${prefix}(${UUID})`))
    if (found) dynamic.push(`${prefix}${found[1]}`)
  }

  /*
   * Para la nómina hay que revisar una semana QUE TENGA GENTE. Una semana vacía
   * muestra el paso 1 y deja fuera media pantalla: la rejilla de días, el botón
   * de quitar y el de enviar a aprobación. Justo donde estuvo el error que
   * llegó a producción.
   */
  const weekWithPeople = await prisma.payrollWeek.findFirst({
    // También de la compañía de la sesión, por lo mismo que la orden de abajo.
    where: { workEntries: { some: {} }, ...(companyId ? { companyId } : {}) },
    orderBy: { startDate: 'desc' },
    select: { id: true },
  })
  if (weekWithPeople) {
    dynamic.push(`/payroll/${weekWithPeople.id}`)
    dynamic.push(`/payroll/${weekWithPeople.id}?paso=personas`)
  } else {
    console.log('  aviso  ninguna semana tiene gente: la rejilla de días no se revisó')
  }

  /*
   * El desprendible de una orden de desembolso.
   *
   * Es un archivo, no una pantalla: si el generador se rompe, ninguna de las
   * revisiones anteriores se entera, y contabilidad se queda sin el soporte.
   */
  /*
   * De la compañía de ESTA sesión. La pantalla solo sirve órdenes de la
   * compañía activa: pedir la de la otra devuelve 404 y la revisión reportaba
   * un daño que no existe.
   */
  const order = await prisma.disbursementOrder.findFirst({
    where: companyId ? { companyId } : {},
    orderBy: { createdAt: 'desc' },
    select: { id: true, orderNumber: true },
  })
  let pdfChecks = 0
  let pdfFailed = 0
  if (order) {
    pdfChecks = 1
    const response = await fetch(`${BASE}/disbursements/${order.id}/pdf`, {
      headers: { Cookie: `payroll_session=${SESSION_COOKIE}` },
    })
    const bytes = Buffer.from(await response.arrayBuffer())
    const type = response.headers.get('content-type') ?? ''
    const looksLikePdf =
      bytes.subarray(0, 8).toString('latin1').startsWith('%PDF-') &&
      bytes.subarray(-8).toString('latin1').includes('%%EOF')

    if (response.status !== 200 || !type.includes('application/pdf') || !looksLikePdf) {
      console.log(
        `  FALLA  desprendible ${order.orderNumber}  → HTTP ${response.status}, ${type}, ${bytes.length} bytes`,
      )
      pdfFailed = 1
    } else {
      console.log(`  ok     desprendible ${order.orderNumber} (${bytes.length} bytes)`)
    }
  } else {
    console.log('  aviso  no hay órdenes de desembolso: el desprendible no se revisó')
  }

  let failed = pdfFailed
  const routes = [...ROUTES, ...dynamic]

  for (const route of routes) {
    let result
    try {
      result = await get(route)
    } catch (error) {
      console.log(`  FALLA  ${route}  → sin respuesta (${(error as Error).message})`)
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

  // Nadie sin sesión debe poder entrar.
  const anonymous = await fetch(`${BASE}/dashboard`, { redirect: 'manual' })
  const blocked = anonymous.status === 307 || anonymous.status === 302
  console.log(blocked ? '  ok     sin sesión → redirige al login' : '  FALLA  sin sesión NO fue bloqueado')
  if (!blocked) failed += 1

  await prisma.userSession.delete({ where: { id: sessionId } })
  await prisma.$disconnect()

  const total = routes.length + 1 + pdfChecks
  console.log(`\n${total - failed}/${total} verificaciones correctas.`)
  if (failed > 0) process.exit(1)
}

await main()
