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

async function openSession(): Promise<{ cookie: string; sessionId: string }> {
  const admin = await prisma.user.findFirst({
    where: { status: 'ACTIVE', companyRoles: { some: { role: { code: 'SUPER_ADMIN' } } } },
    include: { companyRoles: true },
  })
  if (!admin) {
    console.error('No hay un administrador. Corre: npm run user:create "Nombre" correo SUPER_ADMIN')
    process.exit(1)
  }
  const session = await prisma.userSession.create({
    data: {
      userId: admin.id,
      expiresAt: new Date(Date.now() + 10 * 60_000),
      activeCompanyId: admin.companyRoles[0]?.companyId ?? null,
      userAgent: 'smoke',
    },
  })
  return { cookie: await seal(session.id), sessionId: session.id }
}

let SESSION_COOKIE = ''

const ROUTES = [
  '/',
  '/inicio',
  '/dashboard',
  '/workers',
  '/workers/new',
  '/crews',
  '/contractors',
  '/projects',
  '/production',
  '/approvals',
  '/payments',
  '/users',
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

async function get(route: string): Promise<{ status: number; body: string }> {
  const response = await fetch(`${BASE}${route}`, {
    headers: { Cookie: `payroll_session=${SESSION_COOKIE}` },
    redirect: 'follow',
  })
  return { status: response.status, body: await response.text() }
}

function check(route: string, { status, body }: { status: number; body: string }) {
  const marker = ERROR_MARKERS.find((needle) => body.includes(needle))
  const rendered = body.includes(APP_TITLE)
  if (status !== 200 || marker || !rendered) {
    return marker ?? (rendered ? `HTTP ${status}` : 'la pantalla no se armó')
  }
  return null
}

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'

async function main() {
  const { cookie, sessionId } = await openSession()
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
    ['/payroll', '/payroll/'],
    ['/crews', '/crews/'],
    ['/contractors', '/contractors/'],
  ] as const) {
    const html = (await get(list)).body
    const found = html.match(new RegExp(`${prefix}(${UUID})`))
    if (found) dynamic.push(`${prefix}${found[1]}`)
  }

  let failed = 0
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

  console.log(`\n${routes.length + 1 - failed}/${routes.length + 1} verificaciones correctas.`)
  if (failed > 0) process.exit(1)
}

await main()
