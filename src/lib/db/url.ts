/**
 * Dirección de la base de datos.
 *
 * En el equipo local viene de `DATABASE_URL` (archivo .env).
 * En Netlify, la base administrada inyecta `NETLIFY_DATABASE_URL`.
 *
 * Se prefiere la conexión con pool; la directa (`_UNPOOLED`) sirve de respaldo
 * y es la que usan las migraciones.
 */
export function databaseUrl(): string {
  const url =
    process.env.DATABASE_URL ??
    process.env.NETLIFY_DATABASE_URL ??
    process.env.NETLIFY_DATABASE_URL_UNPOOLED

  if (!url) {
    throw new Error(
      'Falta la dirección de la base de datos. Definir DATABASE_URL (local) ' +
        'o NETLIFY_DATABASE_URL (Netlify).',
    )
  }
  return url
}
