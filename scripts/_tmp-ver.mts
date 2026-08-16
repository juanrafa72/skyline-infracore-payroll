import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { databaseUrl } from '../src/lib/db/url'
import { seal } from '../src/lib/auth/session'
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl() }) })
const admin = await prisma.user.findFirstOrThrow({ where: { status: 'ACTIVE' }, include: { companyRoles: true } })
const c = await prisma.company.findFirstOrThrow({ where: { code: 'SKYLINE' } })
const s = await prisma.userSession.create({ data: { userId: admin.id, expiresAt: new Date(Date.now()+600000), activeCompanyId: c.id, userAgent: 'x' } })
const res = await fetch(`http://localhost:3100${process.argv[2]}`, { headers: { cookie: `payroll_session=${await seal(s.id)}` }, redirect: 'manual' })
let h = await res.text()
console.log('HTTP', res.status)
h = h.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<style[\s\S]*?<\/style>/g, ' ')
h = h.replace(/<\/(h2|h3|h4|p|div|li|tr|section|label)>/g, '\n').replace(/<button[^>]*>/g, '\n[BOTÓN] ')
h = h.replace(/<option[^>]*selected[^>]*>/g, ' →').replace(/<option[^>]*>/g, ' · ')
h = h.replace(/<input[^>]*value="([^"]*)"[^>]*>/g, ' [$1] ').replace(/<input[^>]*placeholder="([^"]*)"[^>]*>/g, ' {$1} ')
h = h.replace(/<t[dh][^>]*>/g, ' | ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/&#x27;/g,"'").replace(/&quot;/g,'"').replace(/&middot;/g,'·').replace(/&lt;/g,'<').replace(/&gt;/g,'>')
h = h.replace(/[ \t]+/g,' ').split('\n').map(l=>l.trim()).filter(Boolean).join('\n')
const i = h.indexOf(process.argv[3] ?? 'Cuadrillas')
console.log(i >= 0 ? h.slice(i, i + Number(process.argv[4] ?? 3500)) : h.slice(0, 3000))
await prisma.userSession.delete({ where: { id: s.id } })
await prisma.$disconnect()
