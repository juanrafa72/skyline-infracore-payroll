/**
 * Crea un usuario y le asigna un rol en una compañía.
 *
 * Normalmente la contraseña se genera aquí y se muestra UNA sola vez: no queda
 * guardada en ningún lado en texto plano, y quien la reciba tiene que cambiarla
 * al entrar.
 *
 * Se puede dar una contraseña a propósito —último argumento— para las pruebas
 * del negocio, donde varias personas necesitan entrar con una clave acordada.
 * En ese caso NO se pide cambiarla al entrar: pedirlo dejaría inservible la
 * clave que se acaba de repartir. Para uso real, crear el usuario sin
 * contraseña y dejar que el sistema la genere.
 *
 * Uso:
 *   npx tsx scripts/create-user.mts "Leo" leo@skylinenext.com PAYROLL_PREPARER SKYLINE,INFRACORE
 *   npx tsx scripts/create-user.mts "Leo" leo@x.com PAYROLL_PREPARER SKYLINE clave-acordada
 */
import 'dotenv/config'
import { randomBytes } from 'node:crypto'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { databaseUrl } from '../src/lib/db/url'
import { hashPassword } from '../src/lib/auth/password'

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl() }) })

const [name, email, roleCode, companyCodes = 'SKYLINE', claveDada] = process.argv.slice(2)

if (!name || !email || !roleCode) {
  console.error('Uso: npx tsx scripts/create-user.mts "Nombre" correo ROL COMPAÑIAS')
  console.error('Roles: SUPER_ADMIN, PAYROLL_PREPARER, PAYROLL_APPROVER, TREASURY, AUDITOR')
  process.exit(1)
}

const role = await prisma.role.findUnique({ where: { code: roleCode } })
if (!role) {
  console.error(`El rol ${roleCode} no existe. ¿Falta correr "npm run db:seed"?`)
  process.exit(1)
}

if (claveDada && claveDada.length < 10) {
  console.error(`La contraseña tiene ${claveDada.length} caracteres y el mínimo son 10.`)
  process.exit(1)
}

const finalPassword = claveDada ?? `${randomBytes(9).toString('base64url')}aa` // el 'aa' asegura el largo mínimo
const passwordHash = await hashPassword(finalPassword)
// Una clave escogida a propósito no se pide cambiar: se acaba de repartir.
const mustChangePassword = !claveDada

const user = await prisma.user.upsert({
  where: { email: email.toLowerCase() },
  update: { name, passwordHash, status: 'ACTIVE', mustChangePassword },
  create: {
    email: email.toLowerCase(),
    name,
    passwordHash,
    status: 'ACTIVE',
    mustChangePassword,
  },
})

for (const code of companyCodes.split(',').map((value) => value.trim())) {
  const company = await prisma.company.findUnique({ where: { code } })
  if (!company) {
    console.error(`  ⚠️  La compañía ${code} no existe, se omite`)
    continue
  }
  await prisma.userCompanyRole.upsert({
    where: { userId_companyId_roleId: { userId: user.id, companyId: company.id, roleId: role.id } },
    update: { active: true, revokedAt: null },
    create: { userId: user.id, companyId: company.id, roleId: role.id },
  })
  console.log(`  ✓ ${role.name} en ${company.displayName}`)
}

console.log(`\nUsuario listo: ${user.email}`)
console.log(`Contraseña: ${finalPassword}`)
console.log(
  mustChangePassword
    ? '\nEs temporal y solo se muestra ahora: entrégala por un medio seguro. Se pide cambiarla al entrar.'
    : '\nQuedó la que escogiste y NO se pide cambiarla al entrar (es para pruebas). Para uso real, cámbiala desde la pantalla de la cuenta.',
)

await prisma.$disconnect()
