/**
 * Por dónde salen los correos.
 *
 * Hoy hay UN transporte real —SMTP, con las credenciales en el entorno— y uno
 * de registro que no manda nada. Cuál se usa lo decide la configuración, no el
 * código que llama: quien manda un reporte no tiene que saber si detrás hay un
 * servidor de correo o un archivo de bitácora.
 *
 * **El remitente es POR COMPAÑÍA.** Skyline e Infracore tienen dominios
 * distintos (Rafael, 16/08), y un reporte de Skyline que llegue desde el
 * correo de Infracore le dice al contador que está mirando la nómina
 * equivocada — o se lo come el filtro de spam por no cuadrar el dominio. Por
 * eso el «de» NUNCA se hereda de la otra: cada una necesita el suyo
 * (`SMTP_FROM_SKYLINE`, `SMTP_FROM_INFRACORE`) y, sin él, esa compañía se
 * queda en modo registro aunque la otra ya esté enviando.
 *
 * Mientras el negocio no dé la cuenta de envío, la aplicación queda en modo
 * REGISTRO: el reporte se numera, se guarda a quién iba y queda listo; lo
 * único que falta es la salida. Se ve en pantalla como «pendiente de enviar»,
 * que es honesto — decir «enviado» sin haberlo mandado sería peor que no
 * tener la función.
 */

export interface Destinatario {
  name: string
  email: string
  bcc: boolean
}

export interface Adjunto {
  fileName: string
  content: Uint8Array
  contentType: string
}

export interface Correo {
  to: readonly Destinatario[]
  subject: string
  text: string
  attachments?: readonly Adjunto[]
}

export interface ResultadoEnvio {
  ok: boolean
  /** Qué pasó, en palabras del negocio. */
  message: string
  /** Identificador que devolvió el servidor, si lo hubo. */
  providerId?: string | null
}

export interface Transporte {
  readonly nombre: string
  /** ¿Está configurado para mandar de verdad? */
  readonly activo: boolean
  /** Desde qué correo sale. `null` mientras no esté configurado. */
  readonly de: string | null
  enviar(correo: Correo): Promise<ResultadoEnvio>
}

/**
 * Sin cuenta de envío configurada.
 *
 * No falla: deja el reporte numerado y registrado, y dice con todas las letras
 * que todavía no salió. Un envío que se marca como hecho sin haberse hecho es
 * la peor de las opciones — contabilidad daría por recibido algo que nunca
 * llegó.
 */
class TransporteRegistro implements Transporte {
  readonly nombre = 'registro'
  readonly activo = false
  readonly de = null

  async enviar(correo: Correo): Promise<ResultadoEnvio> {
    const quienes = correo.to.map((d) => d.email).join(', ')
    return {
      ok: false,
      message:
        `Queda registrado para ${quienes}, pero NO salió: falta configurar la cuenta ` +
        'de correo desde la que se envía. Mientras tanto, descarga el PDF y mándalo a mano.',
    }
  }
}

/**
 * SMTP. La cuenta y la clave viven en el entorno, nunca en la base ni en el
 * código: una clave de correo en la base se acaba copiando a un respaldo.
 */
class TransporteSmtp implements Transporte {
  readonly nombre = 'smtp'
  readonly activo = true

  get de(): string {
    return this.config.from
  }

  constructor(
    private readonly config: {
      host: string
      port: number
      user: string
      pass: string
      from: string
    },
  ) {}

  async enviar(correo: Correo): Promise<ResultadoEnvio> {
    /*
     * El envío real se hace con la librería de correo, que se agrega cuando el
     * negocio entregue la cuenta. Hasta entonces esta rama no se ejecuta: sin
     * las variables de entorno, `transporteActual()` devuelve el de registro.
     */
    const { enviarPorSmtp } = await import('./smtp')
    return enviarPorSmtp(this.config, correo)
  }
}

const cache = new Map<string, Transporte>()

/**
 * Lo que hay configurado para una compañía.
 *
 * Del servidor (host, puerto, usuario, clave) se permite una configuración
 * general: puede ser el mismo buzón con dos alias. Del **remitente** no: sin
 * `SMTP_FROM_<CÓDIGO>` esa compañía no envía, punto. Heredarlo mandaría los
 * reportes de una desde el correo de la otra.
 */
export function configuracionDe(companyCode: string): {
  host: string | undefined
  port: number
  user: string | undefined
  pass: string | undefined
  from: string | undefined
} {
  const sufijo = companyCode.trim().toUpperCase().replace(/[^A-Z0-9]/g, '_')
  const propio = (clave: string) => process.env[`SMTP_${clave}_${sufijo}`]
  const general = (clave: string) => process.env[`SMTP_${clave}`]

  return {
    host: propio('HOST') ?? general('HOST'),
    port: Number(propio('PORT') ?? general('PORT') ?? '587'),
    user: propio('USER') ?? general('USER'),
    pass: propio('PASS') ?? general('PASS'),
    // Sin herencia a propósito: cada compañía manda desde SU dominio.
    from: propio('FROM'),
  }
}

/** El transporte de una compañía. Se resuelve una vez por proceso y compañía. */
export function transporteDe(companyCode: string): Transporte {
  const guardado = cache.get(companyCode)
  if (guardado) return guardado

  const config = configuracionDe(companyCode)
  const transporte: Transporte =
    config.host && config.user && config.pass && config.from
      ? new TransporteSmtp({
          host: config.host,
          port: config.port,
          user: config.user,
          pass: config.pass,
          from: config.from,
        })
      : new TransporteRegistro()

  cache.set(companyCode, transporte)
  return transporte
}

/** Para las pruebas: olvidar lo resuelto y volver a leer el entorno. */
export function olvidarTransporte(): void {
  cache.clear()
}
