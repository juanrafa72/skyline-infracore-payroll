/**
 * Datos iniciales.
 *
 * No crea personas concretas: Leo, Rafael y quien pague se asignan desde
 * Administración → Users & Roles (docs/PERMISSIONS.md §1.2).
 *
 * Sí crea las 15 reglas marcadas NEEDS BUSINESS CONFIRMATION con su valor por
 * defecto conservador y `confirmed = false`.
 */
import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { databaseUrl } from '../src/lib/db/url'

const adapter = new PrismaPg({ connectionString: databaseUrl() })
const prisma = new PrismaClient({ adapter })

const PERMISSIONS = [
  ['company:switch', 'Cambiar de compañía activa'],
  ['dashboard:view', 'Ver el dashboard de la compañía'],
  ['dashboard:consolidated', 'Ver el dashboard consolidado'],
  ['payroll:view', 'Ver nóminas'],
  ['payroll:create', 'Crear nóminas'],
  ['payroll:edit', 'Editar nóminas en borrador'],
  ['payroll:submit', 'Enviar nómina a aprobación'],
  ['payroll:approve', 'Aprobar nóminas'],
  ['payroll:reject', 'Rechazar nóminas'],
  ['payroll:return', 'Devolver una nómina'],
  ['payroll:close', 'Cerrar una semana de nómina'],
  ['payment:view', 'Ver pagos'],
  ['payment:execute', 'Ejecutar pagos'],
  ['payment:proof:upload', 'Cargar comprobantes bancarios'],
  ['payment:reverse', 'Reversar un pago'],
  ['payment:adjust', 'Ajustar un pago'],
  ['worker:view', 'Ver trabajadores'],
  ['worker:manage', 'Administrar trabajadores'],
  ['rate:view', 'Ver tarifas'],
  ['rate:manage', 'Administrar tarifas'],
  ['contractor:manage', 'Administrar contratistas'],
  ['crew:manage', 'Administrar cuadrillas'],
  ['project:manage', 'Administrar proyectos'],
  ['equipment:manage', 'Administrar equipos'],
  ['advance:view', 'Ver anticipos'],
  ['advance:create', 'Crear anticipos'],
  ['advance:approve', 'Aprobar anticipos'],
  ['debt:view', 'Ver deudas'],
  ['debt:create', 'Crear deudas'],
  ['debt:forgive', 'Condonar deuda'],
  ['receipt:view', 'Ver comprobantes'],
  ['receipt:send', 'Enviar comprobantes'],
  ['import:execute', 'Importar archivos'],
  ['import:revert', 'Revertir una importación'],
  ['exception:resolve', 'Resolver excepciones'],
  ['audit:view', 'Consultar el audit log'],
  ['user:manage', 'Administrar usuarios y roles'],
  ['settings:manage', 'Administrar configuración'],
  ['rule:confirm', 'Confirmar reglas de negocio'],
] as const

const ROLES: ReadonlyArray<{
  code: string
  name: string
  description: string
  permissions: readonly string[] | '*'
}> = [
  {
    code: 'SUPER_ADMIN',
    name: 'Administrador',
    description: 'Todo, excepto aprobar o pagar lo que preparó (segregación de funciones).',
    permissions: '*',
  },
  {
    code: 'PAYROLL_PREPARER',
    name: 'Preparador de nómina',
    description: 'Prepara y envía a aprobación. No aprueba, no paga.',
    permissions: [
      'dashboard:view', 'payroll:view', 'payroll:create', 'payroll:edit', 'payroll:submit',
      'payment:view', 'worker:view', 'worker:manage', 'rate:view', 'contractor:manage',
      'crew:manage', 'project:manage', 'equipment:manage', 'advance:view', 'advance:create',
      'debt:view', 'debt:create', 'receipt:view', 'import:execute', 'exception:resolve',
      'company:switch',
    ],
  },
  {
    code: 'PAYROLL_APPROVER',
    name: 'Aprobador de nómina',
    description: 'Aprueba, rechaza y devuelve. No prepara, no paga.',
    permissions: [
      'dashboard:view', 'dashboard:consolidated', 'payroll:view', 'payroll:approve',
      'payroll:reject', 'payroll:return', 'payroll:close', 'payment:view', 'payment:reverse',
      'payment:adjust', 'worker:view', 'worker:manage', 'rate:view', 'rate:manage',
      'contractor:manage', 'crew:manage', 'project:manage', 'equipment:manage',
      'advance:view', 'advance:create', 'advance:approve', 'debt:view', 'debt:create',
      'debt:forgive', 'receipt:view', 'receipt:send', 'import:revert', 'exception:resolve',
      'audit:view', 'rule:confirm', 'company:switch',
    ],
  },
  {
    code: 'TREASURY',
    name: 'Tesorería',
    description: 'Paga nóminas aprobadas y carga comprobantes. No modifica montos.',
    permissions: [
      'payroll:view', 'payroll:return', 'payment:view', 'payment:execute',
      'payment:proof:upload', 'receipt:view', 'receipt:send', 'advance:view', 'debt:view',
      'worker:view', 'audit:view', 'company:switch',
    ],
  },
  {
    code: 'AUDITOR',
    name: 'Auditor',
    description: 'Lectura total más audit log. Sin escritura.',
    permissions: [
      'dashboard:view', 'dashboard:consolidated', 'payroll:view', 'payment:view',
      'worker:view', 'rate:view', 'advance:view', 'debt:view', 'receipt:view',
      'audit:view', 'company:switch',
    ],
  },
  {
    code: 'EMPLOYEE_PORTAL',
    name: 'Portal de empleado',
    description: 'Solo su propia información.',
    permissions: ['payroll:view', 'payment:view', 'advance:view', 'debt:view', 'receipt:view'],
  },
  {
    code: 'CONTRACTOR_PORTAL',
    name: 'Portal de contratista',
    description: 'Solo sus settlements y pagos.',
    permissions: ['payment:view', 'advance:view', 'debt:view', 'receipt:view'],
  },
  {
    code: 'CREW_PORTAL',
    name: 'Portal de cuadrilla',
    description: 'Solo la información de su cuadrilla.',
    permissions: ['payroll:view', 'worker:view'],
  },
]

const COMPANIES = [
  {
    code: 'SKYLINE',
    legalName: 'Skyline Advance Tech',
    displayName: 'Skyline Advance Tech',
    operations: [
      ['ADMIN', 'Admin', 0],
      ['AERIAL', 'Aerial', 1],
      ['UNDERGROUND', 'Underground', 2],
      ['BLOWFIBER', 'BlowFiber', 3],
    ],
  },
  {
    code: 'INFRACORE',
    legalName: 'Infracore Systems LLC',
    displayName: 'Infracore',
    operations: [
      ['ADMIN', 'Admin', 0],
      ['BLOWFIBER', 'BlowFiber', 1],
      ['DATA_CENTER', 'Data Center', 2],
    ],
  },
] as const

/**
 * Reglas que pueden cambiar cuánto recibe una persona y que el negocio todavía no
 * ha confirmado. Ver docs/EXCEL_ANALYSIS.md §5.
 * El valor por defecto es siempre el más conservador (el que menos dinero mueve).
 */
const PENDING_RULES: ReadonlyArray<[key: string, value: string, type: string, description: string]> = [
  ['A1.night_suffix_meaning', 'UNKNOWN', 'string',
    'A1 · ¿El sufijo -N significa turno nocturno y -2 tarifa revisada? Define si son la misma persona con dos tarifas o dos registros distintos.'],
  ['A2.commission_scope', 'PER_CUSTOMER', 'string',
    'A2 · ¿La comisión del 2% aplica a todos los clientes o solo a algunos? En los Excel solo está en fórmula en 4 de ~10.'],
  ['A3.transfer_fee_amount', '0.00', 'decimal',
    'A3 · Los $30 restados a cada consignación. Por defecto 0 hasta saber si los asume la compañía o el trabajador.'],
  ['A3.transfer_fee_borne_by', 'COMPANY', 'string',
    'A3 · Quién asume el costo de transferencia. Por defecto la compañía.'],
  ['A4.early_payment_discount_passthrough', 'false', 'boolean',
    'A4 · ¿El descuento de pronto pago del cliente se traslada al contratista? Por defecto no: lo absorbe la compañía.'],
  ['A5.advance_sign_on_settlement', 'SUBTRACT', 'string',
    'A5 · ¿Los adelantos se restan o se suman al invoice? En los Excel aparece de las dos formas. Por defecto se restan.'],
  ['A6.cross_company_duplicate_authority', 'HOLD', 'string',
    'A6 · De los 448 días duplicados entre libros, ¿cuál manda? Por defecto quedan retenidos y no se importan.'],
  ['A7.contractor_deduction_distribution', 'NONE', 'string',
    'A7 · ¿Un descuento a un contratista se reparte entre sus trabajadores? Por defecto no se reparte nunca.'],
  ['A8.half_day_factor', '0.5', 'decimal',
    'A8 · Factor del medio día. Por defecto exactamente la mitad. ¿Existe algún mínimo garantizado?'],
  ['A9.overtime_enabled', 'false', 'boolean',
    'A9 · ¿Existe recargo por horas extra o festivo además de la tarifa diaria? Hoy no existe en los Excel.'],
  ['A10.negative_net_behavior', 'CLAMP_AND_CARRY', 'string',
    'A10 · Neto negativo: por defecto se limita a 0 y el excedente pasa a la semana siguiente. Los Excel llegan a -127,59.'],
  ['A11.intercompany_billing_enabled', 'false', 'boolean',
    'A11 · Cuando Infracore factura a Skyline, ¿es venta real entre compañías? Por defecto no se contabiliza.'],
  ['A12.week_start_day', '0', 'int',
    'A12 · Día de inicio de la semana. Por defecto domingo, igual que WEEKNUM de Excel.'],
  ['A13.forgiveness_requires_approval', 'true', 'boolean',
    'A13 · Toda condonación exige aprobación. Por defecto sí (hoy en los Excel no hay ninguna).'],
  ['A14.equipment_rate_is_internal_cost', 'true', 'boolean',
    'A14 · La tarifa diaria de un equipo, ¿es costo interno o se le paga a alguien? Por defecto costo interno.'],
  ['A15.no_work_is_paid', 'false', 'boolean',
    'A15 · ¿Se pagan los días NO WORK y WAITING PROJECT? Hay 763 registros. Por defecto no se pagan.'],
  ['approval.variance_threshold_pct', '25', 'decimal',
    'Umbral de variación contra la semana anterior que se destaca en el Approval Center.'],
]

/**
 * A quién le llegan los soportes por defecto.
 *
 * La lleva la contabilidad de las dos compañías. Se puede cambiar desde la
 * pantalla de envío de reportes —hay un lápiz— y se le pueden agregar copias.
 */
const CONTABILIDAD = {
  name: 'Ana · Contabilidad',
  email: 'bookkeeping@dazmarllc.com',
  notes: 'Destinatario por defecto de los soportes. Se puede cambiar desde Envío de reportes.',
} as const

async function main() {
  console.log('Sembrando datos iniciales…')

  for (const [code, description] of PERMISSIONS) {
    await prisma.permission.upsert({
      where: { code },
      update: { description },
      create: { code, description },
    })
  }
  console.log(`  permisos: ${PERMISSIONS.length}`)

  const allPermissions = await prisma.permission.findMany()
  const permissionByCode = new Map(allPermissions.map((p) => [p.code, p.id]))

  for (const role of ROLES) {
    const created = await prisma.role.upsert({
      where: { code: role.code },
      update: { name: role.name, description: role.description },
      create: { code: role.code, name: role.name, description: role.description, isSystem: true },
    })
    const codes = role.permissions === '*' ? PERMISSIONS.map(([c]) => c) : role.permissions
    await prisma.rolePermission.deleteMany({ where: { roleId: created.id } })
    await prisma.rolePermission.createMany({
      data: codes
        .map((code) => permissionByCode.get(code))
        .filter((id): id is string => Boolean(id))
        .map((permissionId) => ({ roleId: created.id, permissionId })),
      skipDuplicates: true,
    })
  }
  console.log(`  roles: ${ROLES.length}`)

  for (const company of COMPANIES) {
    const created = await prisma.company.upsert({
      where: { code: company.code },
      update: { legalName: company.legalName, displayName: company.displayName },
      create: {
        code: company.code,
        legalName: company.legalName,
        displayName: company.displayName,
      },
    })

    for (const [code, name, sortOrder] of company.operations) {
      await prisma.operation.upsert({
        where: { companyId_code: { companyId: created.id, code } },
        update: { name, sortOrder },
        create: { companyId: created.id, code, name, sortOrder },
      })
    }

    for (const [key, value, valueType, description] of PENDING_RULES) {
      await prisma.companySetting.upsert({
        where: { companyId_key: { companyId: created.id, key } },
        update: { description },
        create: {
          companyId: created.id,
          key,
          value,
          valueType,
          description,
          needsBusinessConfirmation: key.startsWith('A'),
          confirmed: false,
        },
      })
    }

    /*
     * Contabilidad, puesta desde el primer día.
     *
     * Es el destinatario de todos los soportes en las DOS compañías (Rafael,
     * 16/08). Va en la semilla y no como un paso manual porque un sistema que
     * arranca con la lista vacía deja los reportes sin mandar hasta que
     * alguien se acuerde de configurarlo.
     *
     * `update` casi vacío a propósito: si el negocio le corrige el nombre o el
     * correo desde la pantalla —el lápiz—, el próximo despliegue NO puede
     * devolverlo a este valor. Solo se asegura de que exista.
     */
    /*
     * `findFirst` y no `upsert`: la llave única incluye la empresa receptora,
     * que aquí va en nulo, y Prisma no acepta un nulo dentro de una llave
     * compuesta. Es la misma razón por la que la pantalla lo hace así.
     */
    const yaEsta = await prisma.reportRecipient.findFirst({
      where: {
        companyId: created.id,
        email: CONTABILIDAD.email,
        paymentRecipientId: null,
      },
    })
    if (!yaEsta) {
      await prisma.reportRecipient.create({
        data: {
          companyId: created.id,
          name: CONTABILIDAD.name,
          email: CONTABILIDAD.email,
          // Sin tipos marcados = recibe todos los reportes de la compañía.
          kinds: [],
          notes: CONTABILIDAD.notes,
        },
      })
    }

    console.log(
      `  ${company.displayName}: ${company.operations.length} operaciones, ${PENDING_RULES.length} reglas`,
    )
  }

  const pending = await prisma.companySetting.count({
    where: { needsBusinessConfirmation: true, confirmed: false },
  })
  console.log(`\n⚠️  ${pending} reglas esperando confirmación del negocio.`)
  console.log('   Ver docs/EXCEL_ANALYSIS.md §5 (A1–A15).')
}

main()
  .then(async () => {
    await prisma.$disconnect()
  })
  .catch(async (error) => {
    console.error(error)
    await prisma.$disconnect()
    process.exit(1)
  })
