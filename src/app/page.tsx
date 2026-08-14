import { redirect } from 'next/navigation'

/**
 * Entrar a la aplicación lleva al Dashboard.
 *
 * Es lo primero que se ve al abrir una compañía: los números antes que las
 * tareas. `/inicio` sigue existiendo, con el paso a paso guiado, para quien
 * viene a trabajar la nómina y no a mirar cifras.
 */
export default function Root() {
  redirect('/dashboard')
}
