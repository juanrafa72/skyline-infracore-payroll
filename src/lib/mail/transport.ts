/**
 * Por dónde salen los correos.
 *
 * Hoy hay UN transporte real —SMTP, con las credenciales en el entorno— y uno
 * de registro que no manda nada. Cuál se usa lo decide la configuración, no el
 * código que llama: quien manda un reporte no tiene que saber si detrás hay un
 * servidor de correo o un archivo de bitácora.
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

let cache: Transporte | null = null

/** El transporte configurado. Se resuelve una vez por proceso. */
export function transporteActual(): Transporte {
  if (cache) return cache

  const host = process.env.SMTP_HOST
  const user = process.env.SMTP_USER
  const pass = process.env.SMTP_PASS
  const from = process.env.SMTP_FROM

  if (host && user && pass && from) {
    cache = new TransporteSmtp({
      host,
      port: Number(process.env.SMTP_PORT ?? '587'),
      user,
      pass,
      from,
    })
  } else {
    cache = new TransporteRegistro()
  }

  return cache
}

/** Para las pruebas: olvidar lo resuelto y volver a leer el entorno. */
export function olvidarTransporte(): void {
  cache = null
}
