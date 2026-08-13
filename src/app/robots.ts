import type { MetadataRoute } from 'next'

/**
 * Este sistema no debe aparecer en buscadores.
 *
 * Además de lo obvio (es información de nómina), cada visita de un robot
 * dispara una invocación de servidor que se paga.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: '*', disallow: '/' }],
  }
}
