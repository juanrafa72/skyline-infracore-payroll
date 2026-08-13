/**
 * Crea un usuario y le asigna un rol en una compañía.
 *
 * La contraseña se genera aquí y se muestra UNA sola vez: no queda guardada en
 * ningún lado en texto plano. Quien la reciba debe cambiarla al entrar.
 *
 * Uso:
 *   npx tsx scripts/create-user.mts "Leo" leo@skylinenext.com PAYROLL_PREPARER SKYLINE,INFRACORE
 */
import 'dotenv/config'
import { randomBytes } from 'node:crypto'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { databaseUrl } from '../src/lib/db/url'
import { hashPassword } from '../src/lib/auth/password'

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl() }) })

const [name, email, roleCode, companyCodes = 'SKYLINE'] = process.argv.slice(2)

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

const password = randomBytes(9).toString('base64url')
const passwordHash = await hashPassword(password + 'aa') // asegura el largo mínimo
const finalPassword = password + 'aa'

const user = await prisma.user.upsert({
  where: { email: email.toLowerCase() },
  update: { name, passwordHash, status: 'ACTIVE', mustChangePassword: true },
  create: {
    email: email.toLowerCase(),
    name,
    passwordHash,
    status: 'ACTIVE',
    mustChangePassword: true,
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
console.log(`Contraseña temporal: ${finalPassword}`)
console.log('\nEntrégala por un medio seguro. Solo se muestra ahora.')

await prisma.$disconnect()
