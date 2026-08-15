import { redirect } from 'next/navigation'

/**
 * «Pagar» es una sola pantalla.
 *
 * Antes había dos: esta, que registraba el pago persona por persona, y
 * Desembolsos, con las órdenes por empresa receptora. Nadie podía saber cuál
 * usar —las cuadrillas y los equipos solo se pagaban por la otra— y, peor: un
 * pago registrado aquí no actualizaba la orden, que se quedaba abierta aunque
 * el dinero ya hubiera salido.
 *
 * Todo el pago vive ahora en las órdenes. Esta ruta se conserva para que un
 * enlace viejo no muera.
 */
export default function PaymentsPage() {
  redirect('/disbursements')
}
