import { NextResponse, type NextRequest } from 'next/server'

/**
 * Puerta de entrada.
 *
 * Aquí solo se comprueba que exista una cookie de sesión con firma válida. La
 * verificación de verdad —que la sesión siga viva y qué permisos tiene— ocurre
 * dentro de la aplicación, contra la base de datos. El middleware corre en el
 * borde y no puede consultarla.
 *
 * Es decir: esto filtra tráfico anónimo, NO autoriza nada.
 */
const PUBLIC_PATHS = ['/login', '/api/auth']

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  if (PUBLIC_PATHS.some((path) => pathname.startsWith(path))) {
    return NextResponse.next()
  }

  const cookie = request.cookies.get('payroll_session')?.value
  if (cookie && (await hasValidSignature(cookie))) {
    return NextResponse.next()
  }

  const login = new URL('/login', request.url)
  if (pathname !== '/') login.searchParams.set('volver', pathname)
  return NextResponse.redirect(login)
}

async function hasValidSignature(cookieValue: string): Promise<boolean> {
  const secret = process.env.SESSION_SECRET
  if (!secret) return false

  const separator = cookieValue.lastIndexOf('.')
  if (separator <= 0) return false

  const sessionId = cookieValue.slice(0, separator)
  const provided = cookieValue.slice(separator + 1)

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(sessionId))
  const expected = Buffer.from(signature).toString('base64url')

  if (provided.length !== expected.length) return false
  let difference = 0
  for (let index = 0; index < provided.length; index += 1) {
    difference |= provided.charCodeAt(index) ^ expected.charCodeAt(index)
  }
  return difference === 0
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
