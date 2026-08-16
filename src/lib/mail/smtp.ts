import type { Correo, ResultadoEnvio } from './transport'

/**
 * Salida por SMTP.
 *
 * Vive aparte y se carga solo cuando hay cuenta configurada: así el resto de
 * la aplicación no arrastra una dependencia de correo que hoy no se usa.
 *
 * **Falta la cuenta de envío.** El negocio tiene que decir desde qué correo
 * salen los reportes. Hasta entonces `transporteDe()` devuelve el de
 * registro y esta función no se ejecuta nunca.
 */
export async function enviarPorSmtp(
  config: { host: string; port: number; user: string; pass: string; from: string },
  correo: Correo,
): Promise<ResultadoEnvio> {
  /*
   * Cuando llegue la cuenta, aquí va la llamada a la librería de correo
   * (nodemailer o el proveedor que se escoja). Se deja explícito en vez de
   * "casi funcionando": un envío a medias que falla en silencio haría creer
   * que el soporte salió.
   */
  void config
  void correo

  return {
    ok: false,
    message:
      'La cuenta de correo está configurada pero la salida todavía no se conectó. ' +
      'Avísale a quien administra el sistema.',
  }
}
