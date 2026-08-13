import bcrypt from 'bcryptjs'

/**
 * Contraseñas.
 *
 * Se guardan como hash bcrypt con coste 12. Nunca en texto plano, ni siquiera
 * en registros o mensajes de error.
 */
const COST = 12

export async function hashPassword(plain: string): Promise<string> {
  if (plain.length < 10) {
    throw new Error('La contraseña debe tener al menos 10 caracteres.')
  }
  return bcrypt.hash(plain, COST)
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash)
}
