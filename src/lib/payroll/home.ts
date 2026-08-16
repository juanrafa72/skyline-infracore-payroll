/**
 * Lo que necesita la pantalla de entrada: en qué semana va el trabajo y qué
 * falta.
 *
 * Dos decisiones que aquí importan más que el código:
 *
 * 1. **La semana que se muestra NO es la del calendario.** La nómina de la
 *    semana pasada se hace el lunes siguiente; una pantalla que el lunes diga
 *    «no has marcado ningún día» de una semana que apenas empieza manda a la
 *    semana equivocada. Se muestra la última semana con trabajo NUESTRO, y
 *    cuando esa queda toda pagada, se ofrece abrir la nueva.
 *
 * 2. **Los 149 períodos del Excel no son trabajo pendiente.** Sus días entraron
 *    como importación (`sourceType: IMPORT`) y jamás generaron nómina, a
 *    propósito — BR-153. Si contaran como semana con trabajo, la pantalla
 *    invitaría a calcular una nómina de 2023 que ya se pagó por fuera.
 */
import { prisma } from '@/lib/db/client'
import { vencimientosPendientes } from '@/lib/equipment/records-service'
import { cuantosFrenan } from '@/lib/payroll/exceptions/service'
import { workersMissingRateCount } from '@/lib/payroll/rates-status/service'
import { toIso, weekRangeOf } from '@/lib/payroll/week'

/** Estados que todavía no han salido de la mesa de quien prepara. */
const EDITABLE = ['DRAFT', 'PREPARED', 'REJECTED'] as const
const APPROVED_UNPAID = ['APPROVED', 'READY_TO_PAY', 'PAYMENT_IN_PROCESS'] as const
const SETTLED = ['PAID', 'RECONCILED', 'CLOSED'] as const

export interface WeekFocus {
  /** `null` cuando la compañía todavía no ha abierto ninguna semana. */
  weekId: string | null
  label: string
  startDate: string
  endDate: string
  /** Personas activas de la compañía. */
  activeWorkers: number
  /** Personas con al menos un día marcado en la semana (sin días de control). */
  peopleWithDays: number
  /** Liquidaciones ya calculadas: personas + cuadrillas + equipos. */
  calculated: number
  pendingApproval: number
  approvedUnpaid: number
  paid: number
  /** Órdenes de desembolso de esa semana todavía sin pagar del todo. */
  openOrders: number
  /** 1 marcar · 2 calcular · 3 aprobar · 4 pagar · 5 todo al día. */
  step: 1 | 2 | 3 | 4 | 5
  /**
   * La semana mostrada ya quedó saldada y hoy cae en una posterior: se puede
   * abrir la nueva. Trae la etiqueta de esa semana del calendario.
   */
  nextWeekLabel: string | null
  nextWeekStart: string | null
}

export async function weekFocus(companyId: string): Promise<WeekFocus> {
  const today = toIso(new Date())
  const calendar = weekRangeOf(today)

  /*
   * La última semana con trabajo nuestro: días marcados a mano o alguna
   * liquidación. No basta con «la última semana abierta»: alguien puede abrir
   * la siguiente por adelantado y la pantalla saltaría dejando la anterior sin
   * pagar.
   */
  const week = await prisma.payrollWeek.findFirst({
    where: {
      companyId,
      isOffCycle: false,
      OR: [
        { workEntries: { some: { sourceType: { not: 'IMPORT' }, isControlOnly: false } } },
        { payrolls: { some: {} } },
        { crewPayrolls: { some: {} } },
        { equipmentPayrolls: { some: {} } },
      ],
    },
    orderBy: { startDate: 'desc' },
  })

  const activeWorkers = await prisma.worker.count({ where: { companyId, status: 'ACTIVE' } })

  if (!week) {
    return {
      weekId: null,
      label: `Semana del ${calendar.startDate} al ${calendar.endDate}`,
      startDate: calendar.startDate,
      endDate: calendar.endDate,
      activeWorkers,
      peopleWithDays: 0,
      calculated: 0,
      pendingApproval: 0,
      approvedUnpaid: 0,
      paid: 0,
      openOrders: 0,
      step: 1,
      nextWeekLabel: null,
      nextWeekStart: null,
    }
  }

  const [people, workers, crews, equipment, openOrders] = await Promise.all([
    prisma.workEntry.findMany({
      where: { companyId, payrollWeekId: week.id, isControlOnly: false },
      select: { workerId: true },
      distinct: ['workerId'],
    }),
    prisma.workerPayroll.groupBy({
      by: ['status'],
      where: { companyId, payrollWeekId: week.id },
      _count: { _all: true },
    }),
    prisma.crewPayroll.groupBy({
      by: ['status'],
      where: { companyId, payrollWeekId: week.id },
      _count: { _all: true },
    }),
    prisma.equipmentPayroll.groupBy({
      by: ['status'],
      where: { companyId, payrollWeekId: week.id },
      _count: { _all: true },
    }),
    prisma.disbursementOrder.count({
      where: {
        companyId,
        payrollWeekId: week.id,
        status: { in: ['PENDING_PAYMENT', 'PARTIALLY_PAID'] },
      },
    }),
  ])

  const rows = [...workers, ...crews, ...equipment]
  const countOf = (statuses: readonly string[]) =>
    rows
      .filter((row) => statuses.includes(row.status))
      .reduce((total, row) => total + row._count._all, 0)

  const calculated = rows.reduce((total, row) => total + row._count._all, 0)
  const pendingApproval = countOf(['PENDING_APPROVAL'])
  const approvedUnpaid = countOf(APPROVED_UNPAID)
  const paid = countOf(SETTLED)
  const editable = countOf(EDITABLE)

  const step: WeekFocus['step'] =
    people.length === 0 && calculated === 0
      ? 1
      : calculated === 0 || editable > 0
        ? 2
        : pendingApproval > 0
          ? 3
          : approvedUnpaid > 0 || openOrders > 0
            ? 4
            : 5

  // Cuando la semana mostrada ya está saldada y hoy cae más adelante, lo que
  // sigue es abrir la nueva. No se abre sola: abrir un período es un acto de
  // quien prepara, no un efecto de mirar una pantalla.
  const settled = step === 5
  const ahead = calendar.startDate > toIso(week.startDate)

  return {
    weekId: week.id,
    label: `${week.label} · ${week.year}`,
    startDate: toIso(week.startDate),
    endDate: toIso(week.endDate),
    activeWorkers,
    peopleWithDays: people.length,
    calculated,
    pendingApproval,
    approvedUnpaid,
    paid,
    openOrders,
    step,
    nextWeekLabel: settled && ahead ? `Semana del ${calendar.startDate}` : null,
    nextWeekStart: settled && ahead ? calendar.startDate : null,
  }
}

export interface PendingItem {
  key: string
  title: string
  detail: string
  href: string
  tone: 'critical' | 'warning' | 'info'
}

/**
 * Todo lo que está esperando a alguien, en un solo sitio.
 *
 * Antes estaba repartido en avisos dentro de cada pantalla: la tarifa que
 * falta se veía en la nómina, el contratista que falta al aprobar, el equipo
 * sin proveedor solo al calcular. Quien no abría esa pantalla no se enteraba.
 */
export async function pendingBoard(companyId: string, onDate: string): Promise<PendingItem[]> {
  const [missingRates, crewsWithoutContractor, equipmentIncomplete, critical, prepared, orphans, openOrders] =
    await Promise.all([
      workersMissingRateCount(companyId, onDate),
      prisma.crewPayroll.count({
        where: {
          companyId,
          contractorId: null,
          status: { in: [...EDITABLE, 'PENDING_APPROVAL'] },
        },
      }),
      prisma.equipment.count({
        where: {
          companyId,
          status: 'ACTIVE',
          ownership: 'RENTED',
          OR: [{ vendorId: null }, { dailyCost: null }],
        },
      }),
      cuantosFrenan(companyId),
      prisma.workerPayroll.count({ where: { companyId, status: { in: ['PREPARED', 'REJECTED'] } } }),
      prisma.workerPayroll.count({
        where: {
          companyId,
          status: { in: [...APPROVED_UNPAID] },
          disbursementItem: null,
        },
      }),
      prisma.disbursementOrder.count({
        where: { companyId, status: { in: ['PENDING_PAYMENT', 'PARTIALLY_PAID'] } },
      }),
    ])

  /*
   * Documentos de equipo vencidos o por vencer. Se cuentan aparte del bloque
   * de arriba porque el plazo de aviso es POR DOCUMENTO (un seguro avisa con
   * 30 días, un cambio de aceite con 7) y eso no se resuelve con una sola
   * comparación en SQL sin repetir la regla que ya vive en `equipment/records`.
   */
  const avisosEquipo = await vencimientosPendientes(companyId, onDate)
  const documentosVencidos = avisosEquipo.filter((a) => a.estado.estado === 'VENCIDO').length
  const documentosPorVencer = avisosEquipo.length - documentosVencidos

  const items: PendingItem[] = []

  if (missingRates > 0) {
    items.push({
      key: 'tarifas',
      title: `${missingRates} persona(s) sin tarifa`,
      detail: 'Sin tarifa que aplique no se puede calcular su nómina.',
      href: '/worker-rates',
      tone: 'warning',
    })
  }

  if (crewsWithoutContractor > 0) {
    items.push({
      key: 'contratistas',
      title: `${crewsWithoutContractor} cuadrilla(s) sin contratista`,
      detail: 'Su producción no se puede aprobar: no hay a quién pagarle.',
      href: '/crews',
      tone: 'critical',
    })
  }

  if (equipmentIncomplete > 0) {
    items.push({
      key: 'equipos',
      title: `${equipmentIncomplete} equipo(s) rentado(s) incompleto(s)`,
      detail: 'Les falta proveedor o costo diario. Sin eso no se liquida el alquiler.',
      href: '/equipment',
      tone: 'warning',
    })
  }

  /*
   * Seguros, matrículas y mantenimientos vencidos o por vencer.
   *
   * Va en el tablero de inicio a propósito: el negocio pidió enterarse ANTES,
   * y nadie entra equipo por equipo a revisar fechas. Lo vencido pesa más que
   * lo que está por vencer — una máquina trabajando sin seguro es un riesgo
   * distinto a uno que se renueva la otra semana.
   */
  if (documentosVencidos > 0 || documentosPorVencer > 0) {
    const vencido = documentosVencidos > 0
    items.push({
      key: 'documentos-equipo',
      title: vencido
        ? `${documentosVencidos} documento(s) de equipo VENCIDO(S)`
        : `${documentosPorVencer} documento(s) de equipo por vencer`,
      detail: vencido
        ? 'Seguros, matrículas o revisiones ya vencidas: esas máquinas están trabajando sin eso.'
        : 'Se vencen pronto. Renuévalos antes de que la máquina quede descubierta.',
      href: '/equipment',
      tone: vencido ? 'critical' : 'warning',
    })
  }

  if (critical > 0) {
    items.push({
      key: 'errores',
      title: `${critical} aviso(s) que frenan un pago`,
      detail: 'Ábrelos, revisa qué pasó y ciérralos con una nota para poder seguir.',
      href: '/avisos',
      tone: 'critical',
    })
  }

  if (prepared > 0) {
    items.push({
      key: 'sin-enviar',
      title: `${prepared} nómina(s) calculada(s) sin enviar`,
      detail: 'Están listas pero nadie las ha mandado a aprobación.',
      href: '/payroll',
      tone: 'info',
    })
  }

  if (orphans > 0) {
    items.push({
      key: 'huerfanas',
      title: `${orphans} nómina(s) aprobada(s) sin orden`,
      detail: 'Aprobadas pero sin orden de desembolso: nadie las va a ver para pagar.',
      href: '/disbursements',
      tone: 'warning',
    })
  }

  if (openOrders > 0) {
    items.push({
      key: 'ordenes',
      title: `${openOrders} orden(es) sin pagar`,
      detail: 'Ya están aprobadas y esperan la transferencia.',
      href: '/disbursements',
      tone: 'info',
    })
  }

  return items
}
