import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { configuracionDe, olvidarTransporte, transporteDe } from '@/lib/mail/transport'

/**
 * Desde qué correo sale cada compañía.
 *
 * Rafael lo dijo así: «no va a ser el mismo correo de Skyline y de Infracore,
 * cada uno tiene un dominio diferente».
 *
 * Lo que estas pruebas cuidan es que el remitente NO se herede. Un reporte de
 * Skyline que salga desde el correo de Infracore le dice al contador que está
 * mirando la nómina equivocada, y encima suele terminar en spam porque el
 * dominio no cuadra con el servidor que lo mandó.
 */

const ORIGINAL = { ...process.env }

beforeEach(() => {
  for (const clave of Object.keys(process.env)) {
    if (clave.startsWith('SMTP_')) delete process.env[clave]
  }
  olvidarTransporte()
})

afterEach(() => {
  process.env = { ...ORIGINAL }
  olvidarTransporte()
})

describe('el remitente no se hereda entre compañías', () => {
  it('con el «de» de una sola, la otra NO envía', () => {
    process.env.SMTP_HOST = 'smtp.correo.com'
    process.env.SMTP_USER = 'reportes'
    process.env.SMTP_PASS = 'clave'
    process.env.SMTP_FROM_SKYLINE = 'reportes@skylinenext.com'

    expect(transporteDe('SKYLINE').activo).toBe(true)
    expect(transporteDe('SKYLINE').de).toBe('reportes@skylinenext.com')

    // Lo importante: Infracore se queda quieta en vez de mandar desde el
    // dominio de Skyline.
    expect(transporteDe('INFRACORE').activo).toBe(false)
    expect(transporteDe('INFRACORE').de).toBeNull()
  })

  it('cada una con el suyo, cada una manda desde su dominio', () => {
    process.env.SMTP_HOST = 'smtp.correo.com'
    process.env.SMTP_USER = 'reportes'
    process.env.SMTP_PASS = 'clave'
    process.env.SMTP_FROM_SKYLINE = 'reportes@skylinenext.com'
    process.env.SMTP_FROM_INFRACORE = 'reportes@infracoresystems.com'

    expect(transporteDe('SKYLINE').de).toBe('reportes@skylinenext.com')
    expect(transporteDe('INFRACORE').de).toBe('reportes@infracoresystems.com')
  })

  it('un «de» general no alcanza para ninguna', () => {
    // `SMTP_FROM` a secas sería el atajo cómodo, y es justo el que manda los
    // reportes de las dos desde el mismo buzón.
    process.env.SMTP_HOST = 'smtp.correo.com'
    process.env.SMTP_USER = 'reportes'
    process.env.SMTP_PASS = 'clave'
    process.env.SMTP_FROM = 'reportes@algo.com'

    expect(transporteDe('SKYLINE').activo).toBe(false)
    expect(transporteDe('INFRACORE').activo).toBe(false)
  })
})

describe('el servidor sí se puede compartir', () => {
  it('host, usuario y clave generales sirven para las dos', () => {
    // Un solo buzón con dos alias es un montaje normal y no hay razón para
    // pedir la misma clave dos veces.
    process.env.SMTP_HOST = 'smtp.correo.com'
    process.env.SMTP_USER = 'reportes'
    process.env.SMTP_PASS = 'clave'

    expect(configuracionDe('INFRACORE').host).toBe('smtp.correo.com')
    expect(configuracionDe('INFRACORE').user).toBe('reportes')
  })

  it('pero una compañía puede tener su propio servidor', () => {
    process.env.SMTP_HOST = 'smtp.general.com'
    process.env.SMTP_HOST_INFRACORE = 'smtp.infracore.com'
    process.env.SMTP_PORT_INFRACORE = '2525'

    expect(configuracionDe('SKYLINE').host).toBe('smtp.general.com')
    expect(configuracionDe('INFRACORE').host).toBe('smtp.infracore.com')
    expect(configuracionDe('INFRACORE').port).toBe(2525)
  })

  it('el puerto por defecto es 587', () => {
    expect(configuracionDe('SKYLINE').port).toBe(587)
  })
})

describe('sin nada configurado', () => {
  it('no falla: queda en modo registro y lo dice', async () => {
    const transporte = transporteDe('SKYLINE')
    expect(transporte.activo).toBe(false)

    const resultado = await transporte.enviar({
      to: [{ name: 'Ana', email: 'bookkeeping@dazmarllc.com', bcc: false }],
      subject: 'Soporte',
      text: 'x',
    })

    // Decir «enviado» sin haber enviado sería peor que no tener la función:
    // contabilidad daría por recibido algo que nunca llegó.
    expect(resultado.ok).toBe(false)
    expect(resultado.message).toContain('NO salió')
    expect(resultado.message).toContain('bookkeeping@dazmarllc.com')
  })
})
