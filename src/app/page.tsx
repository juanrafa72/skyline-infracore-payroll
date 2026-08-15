import { redirect } from 'next/navigation'

/**
 * Entrar a la aplicación lleva a «Esta semana».
 *
 * Quien abre esto viene a trabajar la nómina, no a mirar cifras: lo primero
 * tiene que ser en qué va la semana y qué falta. Los números siguen ahí, en su
 * propia pantalla, para cuando se quiera analizar.
 */
export default function Root() {
  redirect('/inicio')
}
