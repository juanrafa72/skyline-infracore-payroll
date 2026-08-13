import { NextResponse, type NextRequest } from 'next/server'

/**
 * Candado temporal del sitio publicado.
 *
 * NO es el sistema de usuarios: es una sola contraseña compartida que impide que
 * cualquiera en internet abra la nómina mientras se construye el login real
 * (módulo M3 del plan). Se activa solo si existe la variable `SITE_PASSWORD`,
 * así en local no estorba.
 *
 * Lo que este candado NO hace:
 *  - no distingue a Leo de Rafael ni del tesorero
 *  - no registra quién entró
 *  - no aplica permisos
 * Todo eso llega con la autenticación real. Hasta entonces, cualquiera que tenga
 * la contraseña ve y edita todo.
 */
export function middleware(request: NextRequest) {
  const expected = process.env.SITE_PASSWORD
  if (!expected) return NextResponse.next()

  const header = request.headers.get('authorization')

  if (header?.startsWith('Basic ')) {
    let decoded = ''
    try {
      decoded = atob(header.slice(6))
    } catch {
      decoded = ''
    }
    const password = decoded.slice(decoded.indexOf(':') + 1)
    if (decoded.includes(':') && safeEqual(password, expected)) {
      return NextResponse.next()
    }
  }

  return new NextResponse('Acceso restringido', {
    status: 401,
    headers: {
      'WWW-Authenticate': 'Basic realm="Payroll Skyline / Infracore", charset="UTF-8"',
    },
  })
}

/** Comparación de tiempo constante: no revela la contraseña por el tiempo de respuesta. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let difference = 0
  for (let index = 0; index < a.length; index += 1) {
    difference |= a.charCodeAt(index) ^ b.charCodeAt(index)
  }
  return difference === 0
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
