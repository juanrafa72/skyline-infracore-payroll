'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { assertCan } from '@/lib/auth/rbac'
import { getActiveCompany } from '@/lib/company/context'
import { prisma } from '@/lib/db/client'
import {
  DEFAULT_SETTINGS,
  calculateWorkerPayroll,
  toCents,
  toDecimalString,
  type AdditionInput,
  type CalculationInput,
  type DayType,
  type DeductionInput,
  type RateInput,
  type WorkEntryInput,
} from '@/lib/payroll/engine'
import { snapshotRevenue } from '@/lib/margin/service'
import { offCyclePeriod, periodOf, type PayPeriodType } from '@/lib/payroll/period'
import { reiniciarSemana } from '@/lib/payroll/reset'
import { projectForDay, readProjectSelection } from '@/lib/payroll/grid'
import { toIso } from '@/lib/payroll/week'
import { evaluarGuardado, fechaDeApertura, notaSuficiente } from '@/lib/payroll/concurrencia'
import { estadoDeLaSemana } from '@/lib/payroll/concurrencia-service'
import type { RespuestaGuardado } from './[weekId]/GuardarDias'
import { invalidateIfStale } from '@/lib/payroll/workflow/service'
import { currentRoster, removeFromRoster, setRoster } from '@/lib/payroll/roster'
import { addExtra, removeExtra } from '@/lib/payroll/extras/service'
import { alternarCuadrillaEnSemana, saveControlDays, saveCrewDays, syncCrewPayrolls } from '@/lib/payroll/crews/service'
import {
  saveCrewBreakdown,
  saveExpectedTotal,
  type MemberInput,
} from '@/lib/payroll/contractors/service'
import { alternarEquipoEnSemana, saveEquipmentDays, syncEquipmentPayrolls } from '@/lib/payroll/equipment/service'

/**
 * Abre un período de pago.
 *
 * Dos modos:
 *  - regular: se elige la frecuencia (diario, semanal, catorcenal, quincenal,
 *    mensual) y el sistema calcula las fechas del ciclo que contiene la fecha dada.
 *  - corte: se dan las fechas a mano. Sirve para liquidar a alguien que se retira
 *    sin esperar el cierre normal. Queda marcado como corte para que no se
 *    confunda con un período regular.
 */
export async function openWeek(formData: FormData) {
  const company = await getActiveCompany()
  const mode = String(formData.get('mode') ?? 'regular')

  const period =
    mode === 'cut'
      ? offCyclePeriod(String(formData.get('cutFrom') ?? ''), String(formData.get('cutTo') ?? ''))
      : periodOf(
          String(formData.get('date') ?? ''),
          (String(formData.get('periodType') ?? 'WEEKLY') as PayPeriodType),
          company.biweeklyAnchor ? { biweeklyAnchor: toIso(company.biweeklyAnchor) } : {},
        )

  const isCut = mode === 'cut'
  const settlementType = isCut
    ? (String(formData.get('settlementType') ?? 'FINAL_SETTLEMENT') as 'FINAL_SETTLEMENT' | 'PARTIAL_CUT')
    : 'REGULAR'

  const week = await prisma.payrollWeek.upsert({
    where: {
      companyId_year_weekNumber: {
        companyId: company.id,
        year: period.year,
        weekNumber: period.periodNumber,
      },
    },
    update: {},
    create: {
      companyId: company.id,
      year: period.year,
      weekNumber: period.periodNumber,
      startDate: new Date(`${period.startDate}T00:00:00Z`),
      endDate: new Date(`${period.endDate}T00:00:00Z`),
      label: period.label,
      periodType: period.periodType,
      isOffCycle: isCut,
      settlementType,
      offCycleReason: isCut ? String(formData.get('cutReason') ?? '') || null : null,
    },
  })

  revalidatePath('/payroll')
  redirect(`/payroll/${week.id}`)
}

/** Acepta "75", "75.5", "$75.00" y devuelve "75.00". Rechaza lo que no sea un monto. */
function normalizeAmount(raw: string): string {
  const cleaned = raw.replace(/[$\s,]/g, '')
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) {
    throw new Error(`"${raw}" no es un monto válido. Usa números, con máximo 2 decimales.`)
  }
  return Number(cleaned).toFixed(2)
}

/**
 * Guarda la rejilla de días. Un día vacío significa "sin registro" y se borra;
 * no se guarda como NO_WORK implícito, porque no es lo mismo no haber trabajado
 * que no haberlo registrado todavía.
 */
export async function saveWorkEntries(formData: FormData): Promise<RespuestaGuardado> {
  const user = await assertCan('payroll:edit')
  const company = await getActiveCompany()
  const weekId = String(formData.get('weekId') ?? '')

  const week = await prisma.payrollWeek.findFirst({
    where: { id: weekId, companyId: company.id },
  })
  if (!week) throw new Error('Semana no encontrada')
  if (week.status === 'CLOSED') throw new Error('La semana está cerrada')

  /*
   * ¿Alguien más tocó esta semana mientras la tenía abierta?
   *
   * La rejilla manda los SIETE días de cada persona cada vez: si Leo abre el
   * lunes, Rafael marca el martes, y Leo guarda a las 5 con su pantalla vieja,
   * el martes de Rafael desaparece sin que nadie se entere.
   */
  const abiertaEn = fechaDeApertura(String(formData.get('abiertaEn') ?? ''))
  const estado = await estadoDeLaSemana(company.id, weekId)
  const veredicto = evaluarGuardado(estado, { abiertaEn, usuarioId: user.id })

  const nota = String(formData.get('notaCambio') ?? '')

  if (veredicto.tipo === 'PISARIA' && !notaSuficiente(nota)) {
    /*
     * No se guarda nada, y se responde SIN recargar la pantalla.
     *
     * Un `redirect` aquí borraría las marcas que la persona acaba de hacer —
     * podría ser la semana entera— y el aviso terminaría costando más que el
     * choque que evita. Volviendo como respuesta, el formulario se queda
     * intacto: solo aparece el recuadro pidiendo el porqué.
     */
    return { conflicto: { quien: veredicto.quien, mensaje: veredicto.mensaje } }
  }

  if (veredicto.tipo === 'PISARIA') {
    // Se guarda, pero queda dicho quién cambió lo de quién y por qué.
    await prisma.auditLog.create({
      data: {
        companyId: company.id,
        userId: user.id,
        userEmailSnapshot: user.email,
        action: 'WORK_ENTRIES_OVERWRITTEN',
        entityType: 'PayrollWeek',
        entityId: weekId,
        payrollWeekId: weekId,
        oldValueJson: { tocadaPor: veredicto.quien, tocadaEn: estado.tocadaEn?.toISOString() },
        newValueJson: { guardadaPor: user.name },
        changedFields: ['workEntries'],
        reason: nota.trim(),
      },
    })
  }

  const extras = new Map<string, { amount: string; note: string }>()
  for (const [key, raw] of formData.entries()) {
    if (key.startsWith('extra:')) {
      const id = key.slice('extra:'.length)
      extras.set(id, { amount: String(raw).trim(), note: extras.get(id)?.note ?? '' })
    } else if (key.startsWith('nota:')) {
      const id = key.slice('nota:'.length)
      extras.set(id, { amount: extras.get(id)?.amount ?? '', note: String(raw).trim() })
    }
  }

  /*
   * El proyecto de cada día.
   *
   * Normalmente se escoge uno para toda la semana, pero la fila puede venir
   * "por día": la misma persona trabaja lunes, martes y viernes en un pueblo y
   * miércoles y jueves en otro. El día manda sobre la semana — la regla vive en
   * `grid.ts`, probada aparte.
   *
   * Importa más de lo que parece: un día sin proyecto no tiene cliente, y sin
   * cliente no se sabe a quién facturarlo. Por eso la venta y el margen salían
   * incompletos.
   */
  const projectSelection = readProjectSelection(
    [...formData.entries()].map(([key, raw]) => [key, String(raw)] as const),
  )

  const operations = new Map<string, { workerId: string; date: string; value: string }>()
  for (const [key, raw] of formData.entries()) {
    if (!key.startsWith('day:')) continue
    const [, workerId, date] = key.split(':')
    if (!workerId || !date) continue
    const value = String(raw)
    // Si el mismo día llegara repetido, gana el valor con contenido: un campo
    // vacío nunca debe borrar una marca que el usuario sí hizo.
    const previous = operations.get(key)
    if (previous && previous.value !== '' && value === '') continue
    operations.set(key, { workerId, date, value })
  }

  /*
   * Cada día hereda la operación, el proyecto y la cuadrilla de la persona.
   *
   * Sin esto, el día queda "sin operación" y una tarifa atada a una operación
   * —como las que vinieron del Excel— no le aplica: la persona tiene tarifa
   * pero el sistema dice que no la tiene. Fue exactamente el error reportado.
   */
  const workerIds = [...new Set([...operations.values()].map((row) => row.workerId))]
  const workerDefaults = new Map(
    (
      await prisma.worker.findMany({
        where: { id: { in: workerIds } },
        select: {
          id: true,
          defaultOperationId: true,
          defaultProjectId: true,
          defaultCrewId: true,
        },
      })
    ).map((worker) => [worker.id, worker]),
  )

  /*
   * Días de control de cuadrilla ya anotados: la rejilla de personal ni los
   * muestra ni los toca. Sin este candado, marcar un día aquí CONVERTIRÍA en
   * silencio un día de control (que no paga) en un día pagado — la restricción
   * única de la base los haría chocar en la misma fila.
   */
  const controlDays = new Set(
    (
      await prisma.workEntry.findMany({
        where: { companyId: company.id, payrollWeekId: week.id, isControlOnly: true },
        select: { workerId: true, workDate: true },
      })
    ).map((entry) => `${entry.workerId}:${toIso(entry.workDate)}`),
  )

  let saved = 0
  let cleared = 0
  let skippedControl = 0

  await prisma.$transaction(async (tx) => {
    for (const { workerId, date, value } of operations.values()) {
      const workDate = new Date(`${date}T00:00:00Z`)

      if (controlDays.has(`${workerId}:${date}`)) {
        skippedControl += 1
        continue
      }

      if (value === '') {
        const deleted = await tx.workEntry.deleteMany({
          where: { companyId: company.id, workerId, workDate, isControlOnly: false },
        })
        cleared += deleted.count
        continue
      }

      const dayType = value as DayType
      const extra = extras.get(`${workerId}:${date}`)
      const amount = extra?.amount ? normalizeAmount(extra.amount) : null
      const note = extra?.note || null

      // Un monto adicional sin explicación no se guarda. La base también lo
      // impide; aquí se avisa con un mensaje entendible en vez de un error crudo.
      if (amount !== null && !note) {
        throw new Error(
          `El adicional del ${date} necesita una nota que explique por qué se paga.`,
        )
      }

      const defaults = workerDefaults.get(workerId)

      // Solo se toca el proyecto si el formulario lo trajo: un campo ausente
      // nunca debe borrar el proyecto que ya tenía el día.
      const choice = projectForDay(projectSelection, workerId, date)
      const projectId = choice.chose
        ? choice.projectId
        : (defaults?.defaultProjectId ?? null)

      await tx.workEntry.upsert({
        where: {
          companyId_workerId_workDate: { companyId: company.id, workerId, workDate },
        },
        update: {
          dayType,
          payrollWeekId: week.id,
          additionalAmount: amount,
          additionalNote: amount === null ? null : note,
          // Queda anotado quién lo tocó de último: es con lo que el próximo
          // guardado sabe si estaría pisando el trabajo de otra persona.
          updatedById: user.id,
          ...(choice.chose ? { projectId } : {}),
        },
        create: {
          companyId: company.id,
          payrollWeekId: week.id,
          workerId,
          workDate,
          dayType,
          createdById: user.id,
          updatedById: user.id,
          status: dayType === 'NO_WORK' ? 'NO_WORK' : 'WORKED',
          additionalAmount: amount,
          additionalNote: amount === null ? null : note,
          operationId: defaults?.defaultOperationId ?? null,
          projectId,
          crewId: defaults?.defaultCrewId ?? null,
        },
      })
      saved += 1
    }

    await tx.auditLog.create({
      data: {
        companyId: company.id,
        action: 'WORK_ENTRIES_SAVED',
        entityType: 'PayrollWeek',
        entityId: week.id,
        payrollWeekId: week.id,
        newValueJson: { saved, cleared, skippedControl },
        changedFields: ['workEntries'],
      },
    })
  })


  /*
   * Si alguna nómina de esta semana ya estaba aprobada y lo que se acaba de
   * guardar la cambió, la aprobación se cae aquí mismo. No se espera a que
   * alguien lo note: un cambio silencioso después de aprobar es exactamente lo
   * que este sistema existe para impedir.
   */
  const approved = await prisma.workerPayroll.findMany({
    where: {
      companyId: company.id,
      payrollWeekId: week.id,
      status: { in: ['APPROVED', 'READY_TO_PAY'] },
    },
    select: { id: true },
  })
  for (const payroll of approved) {
    await invalidateIfStale(payroll.id)
  }

  revalidatePath('/approvals')
  revalidatePath(`/payroll/${weekId}`)

  /*
   * Vuelve a la semana señalando cuál es el paso siguiente.
   *
   * Lo pidió el negocio: al guardar los días, el botón de «Calcular nómina»
   * late para no tener que adivinar dónde seguir. La marca va en la dirección
   * —no en un estado del navegador— para que sobreviva a la recarga que hace
   * el servidor al guardar.
   */
  redirect(`/payroll/${weekId}?guardado=dias#calcular`)
}

/**
 * Recalcula la nómina de la semana con el PayrollEngine.
 *
 * Solo toca nóminas en estado editable. Una nómina aprobada o pagada no se
 * recalcula por aquí: cambiarla exige el flujo de invalidación de aprobación.
 */
export async function calculateWeek(formData: FormData) {
  const company = await getActiveCompany()
  const weekId = String(formData.get('weekId') ?? '')

  const week = await prisma.payrollWeek.findFirst({
    where: { id: weekId, companyId: company.id },
    include: {
      // Los días de control de cuadrilla NO pagan: el motor jamás los ve.
      workEntries: { where: { isControlOnly: false }, include: { worker: true } },
    },
  })
  if (!week) throw new Error('Semana no encontrada')

  const workerIds = [...new Set(week.workEntries.map((entry) => entry.workerId))]

  const [workers, rates, additions, deductions] = await Promise.all([
    prisma.worker.findMany({ where: { id: { in: workerIds } } }),
    prisma.workerRate.findMany({ where: { workerId: { in: workerIds }, active: true } }),
    prisma.addition.findMany({
      where: { companyId: company.id, workerPayroll: { payrollWeekId: week.id } },
    }),
    prisma.deduction.findMany({
      where: {
        companyId: company.id,
        workerPayroll: { payrollWeekId: week.id },
        sourceType: 'MANUAL',
      },
    }),
  ])

  const workerById = new Map(workers.map((worker) => [worker.id, worker]))

  for (const workerId of workerIds) {
    const worker = workerById.get(workerId)
    if (!worker) continue

    const existing = await prisma.workerPayroll.findUnique({
      where: {
        companyId_payrollWeekId_workerId: {
          companyId: company.id,
          payrollWeekId: week.id,
          workerId,
        },
      },
    })

    // Una nómina aprobada o pagada no se recalcula en silencio.
    if (existing && !['DRAFT', 'PREPARED', 'REJECTED'].includes(existing.status)) continue

    const entries: WorkEntryInput[] = week.workEntries
      .filter((entry) => entry.workerId === workerId)
      .map((entry) => ({
        id: entry.id,
        workDate: toIso(entry.workDate),
        dayType: entry.dayType as DayType,
        hoursWorked: entry.hoursWorked?.toString() ?? null,
        shift: entry.shift,
        projectId: entry.projectId,
        crewId: entry.crewId,
        operationId: entry.operationId,
        additionalAmount: entry.additionalAmount
          ? toCents(entry.additionalAmount.toString())
          : null,
        additionalNote: entry.additionalNote,
      }))

    const workerRates: RateInput[] = rates
      .filter((rate) => rate.workerId === workerId)
      .map((rate) => ({
        id: rate.id,
        rateType: rate.rateType,
        amount: toCents(rate.amount.toString()),
        shift: rate.shift,
        projectId: rate.projectId,
        operationId: rate.operationId,
        effectiveFrom: toIso(rate.effectiveFrom),
        effectiveTo: rate.effectiveTo ? toIso(rate.effectiveTo) : null,
      }))

    const workerAdditions: AdditionInput[] = additions
      .filter((addition) => addition.workerPayrollId === existing?.id)
      .map((addition) => ({
        id: addition.id,
        category: addition.category,
        amount: toCents(addition.amount.toString()),
        description: addition.description,
      }))

    const workerDeductions: DeductionInput[] = deductions
      .filter((deduction) => deduction.workerPayrollId === existing?.id)
      .map((deduction) => ({
        id: deduction.id,
        category: deduction.category,
        amount: toCents(deduction.amount.toString()),
        description: deduction.description,
      }))

    const input: CalculationInput = {
      workerId,
      compensationType: worker.compensationType,
      fixedWeeklyAmount:
        worker.compensationType === 'FIXED_WEEKLY'
          ? (workerRates.find((rate) => rate.rateType === 'WEEKLY')?.amount ?? null)
          : null,
      entries,
      rates: workerRates,
      additions: workerAdditions,
      manualDeductions: workerDeductions,
      advances: [],
      debts: [],
      settings: DEFAULT_SETTINGS,
    }

    const result = calculateWorkerPayroll(input)

    await prisma.$transaction(async (tx) => {
      const payroll = await tx.workerPayroll.upsert({
        where: {
          companyId_payrollWeekId_workerId: {
            companyId: company.id,
            payrollWeekId: week.id,
            workerId,
          },
        },
        update: {
          status: 'PREPARED',
          daysFull: result.daysFull,
          daysHalf: result.daysHalf,
          daysNoWork: result.daysNoWork,
          hoursTotal: result.hoursTotal,
          basePay: toDecimalString(result.basePay),
          additionsTotal: toDecimalString(result.additionsTotal),
          grossPay: toDecimalString(result.grossPay),
          deductionsTotal: toDecimalString(result.deductionsTotal),
          netPay: toDecimalString(result.netPay),
          preparedAt: new Date(),
        },
        create: {
          companyId: company.id,
          payrollWeekId: week.id,
          workerId,
          status: 'PREPARED',
          daysFull: result.daysFull,
          daysHalf: result.daysHalf,
          daysNoWork: result.daysNoWork,
          hoursTotal: result.hoursTotal,
          basePay: toDecimalString(result.basePay),
          additionsTotal: toDecimalString(result.additionsTotal),
          grossPay: toDecimalString(result.grossPay),
          deductionsTotal: toDecimalString(result.deductionsTotal),
          netPay: toDecimalString(result.netPay),
          preparedAt: new Date(),
        },
      })

      await tx.payrollLine.deleteMany({ where: { workerPayrollId: payroll.id } })
      await tx.payrollLine.createMany({
        data: result.lines.map((line) => ({
          workerPayrollId: payroll.id,
          workEntryId: line.workEntryId,
          lineType: line.lineType,
          workDate: line.workDate ? new Date(`${line.workDate}T00:00:00Z`) : null,
          quantity: line.quantity,
          appliedRate: toDecimalString(line.appliedRate),
          rateSourceId: line.rateSourceId,
          amount: toDecimalString(line.amount),
          projectId: line.projectId,
          crewId: line.crewId,
          shift: line.shift,
          description: line.description,
        })),
      })

      /*
       * Congelar la VENTA, no solo el costo.
       *
       * Se hace aquí, en la misma transacción que el cálculo, para que la
       * tarifa que el cliente nos paga quede fija igual que la que nosotros
       * pagamos — BR-200. Si mañana se renegocia el contrato, esta semana
       * sigue diciendo lo que decía.
       */
      await snapshotRevenue(company.id, payroll.id, tx)

      await tx.exception.deleteMany({
        where: { companyId: company.id, payrollWeekId: week.id, workerId, status: 'OPEN' },
      })
      if (result.exceptions.length > 0) {
        await tx.exception.createMany({
          data: result.exceptions.map((exception) => ({
            companyId: company.id,
            code: exception.code,
            level: exception.level,
            entityType: 'WorkerPayroll',
            entityId: payroll.id,
            payrollWeekId: week.id,
            workerId,
            title: exception.title,
            detail: exception.detail,
          })),
        })
      }

      await tx.auditLog.create({
        data: {
          companyId: company.id,
          action: 'PAYROLL_CALCULATED',
          entityType: 'WorkerPayroll',
          entityId: payroll.id,
          payrollWeekId: week.id,
          newValueJson: {
            worker: worker.displayName,
            gross: toDecimalString(result.grossPay),
            net: toDecimalString(result.netPay),
          },
          changedFields: ['grossPay', 'netPay'],
        },
      })
    })
  }

  /*
   * Las cuadrillas y los equipos rentados se liquidan aquí mismo: producción →
   * deuda con el contratista, días de equipo → deuda con el proveedor, con el
   * mismo botón que calcula a las personas. Solo estados editables.
   */
  await syncCrewPayrolls(company.id, week.id)
  await syncEquipmentPayrolls(company.id, week.id)

  revalidatePath(`/payroll/${weekId}`)
  // Ya está calculada: lo que sigue es enviarla, y ese botón es el que late.
  redirect(`/payroll/${weekId}?guardado=calculo#enviar`)
}

/** Agrega personas al período, aunque todavía no tengan días marcados. */
export async function addWorkerToPeriod(formData: FormData) {
  const company = await getActiveCompany()
  const weekId = String(formData.get('weekId') ?? '')
  const workerIds = formData.getAll('workerId').map(String).filter(Boolean)
  if (workerIds.length === 0) return

  const week = await prisma.payrollWeek.findFirst({ where: { id: weekId, companyId: company.id } })
  if (!week) throw new Error('Período no encontrado')

  for (const workerId of workerIds) {
    await prisma.payrollWeekMember.upsert({
      where: { payrollWeekId_workerId: { payrollWeekId: week.id, workerId } },
      update: { removedAt: null, removedById: null, removalReason: null },
      create: { companyId: company.id, payrollWeekId: week.id, workerId },
    })
  }

  await prisma.auditLog.create({
    data: {
      companyId: company.id,
      action: 'PERIOD_MEMBER_ADDED',
      entityType: 'PayrollWeek',
      entityId: week.id,
      payrollWeekId: week.id,
      newValueJson: { workerIds, count: workerIds.length },
      changedFields: ['members'],
    },
  })

  revalidatePath(`/payroll/${weekId}`)
}


/**
 * Fija quiénes trabajaron en el período.
 *
 * Devuelve un mensaje en vez de lanzar: un error de uso tiene que verse como
 * un aviso en la pantalla, no como un error del sistema.
 */
export async function setPeriodRoster(
  _previous: string | null,
  formData: FormData,
): Promise<string> {
  const company = await getActiveCompany()
  const weekId = String(formData.get('weekId') ?? '')
  const workerIds = formData.getAll('workerId').map(String).filter(Boolean)

  const result = await setRoster(company.id, weekId, workerIds)
  revalidatePath(`/payroll/${weekId}`)

  if (!result.ok) return result.message
  /*
   * Ya está la gente: lo que sigue es marcarles los días.
   *
   * La rejilla late y la pantalla baja hasta ella. Sin esto, quien acaba de
   * escoger a doce personas vuelve a una pantalla larga sin saber qué sigue —
   * que era justo el reclamo: «no veo el cambio de que titile el botón».
   */
  redirect(`/payroll/${weekId}?guardado=roster#rejilla`)
}

/** Saca a una persona del período. Devuelve mensaje, no lanza. */
export async function removeWorkerFromPeriod(
  _previous: string | null,
  formData: FormData,
): Promise<string> {
  const company = await getActiveCompany()
  const weekId = String(formData.get('weekId') ?? '')
  const workerId = String(formData.get('workerId') ?? '')

  const result = await removeFromRoster(company.id, weekId, workerId)
  revalidatePath(`/payroll/${weekId}`)
  return result.ok ? `LISTO|${result.message}` : result.message
}

/**
 * Crea una persona con su tarifa y la mete al período, en un solo paso.
 *
 * Una persona sin tarifa no sirve para nada aquí: por eso la tarifa se pide
 * junto con el nombre y no se puede dejar en blanco.
 */
/**
 * Copia QUIÉNES trabajaron la semana pasada — y nada más.
 *
 * Los días no se copian jamás: serían trabajo inventado. El proyecto tampoco
 * se escribe aquí; la rejilla lo propone como sugerencia y solo queda cuando
 * quien prepara guarda los días. `setRoster` es aditivo, así que copiar no
 * saca a nadie que ya estuviera.
 */
export async function copyPreviousWeek(formData: FormData) {
  const company = await getActiveCompany()
  const weekId = String(formData.get('weekId') ?? '')

  const week = await prisma.payrollWeek.findFirst({
    where: { id: weekId, companyId: company.id },
  })
  if (!week) throw new Error('Semana no encontrada')

  const previous = await prisma.payrollWeek.findFirst({
    where: { companyId: company.id, startDate: { lt: week.startDate }, isOffCycle: false },
    orderBy: { startDate: 'desc' },
  })

  if (previous) {
    const people = await currentRoster(company.id, previous.id)
    if (people.length > 0) {
      await setRoster(company.id, week.id, people)
    }
  }

  revalidatePath(`/payroll/${weekId}`)
  redirect(`/payroll/${weekId}`)
}

/**
 * Guarda los días de control de las cuadrillas de la semana.
 *
 * `controlmember:<workerId>` = crewId (el universo que la pantalla mostró);
 * `controlday:<workerId>:<fecha>` = casilla marcada. Lo demás lo decide el
 * servicio: crear lo marcado, quitar lo desmarcado, y JAMÁS pisar un día
 * pagado.
 */
export async function saveCrewControlDays(
  _previous: string | null,
  formData: FormData,
): Promise<string> {
  const user = await assertCan('payroll:edit')
  const weekId = String(formData.get('weekId') ?? '')

  const workers: Array<{ workerId: string; crewId: string }> = []
  const marked: Array<{ workerId: string; date: string }> = []

  /*
   * En el mismo formulario viajan DOS cosas distintas:
   *  - `controlday:` → días de la GENTE del crew. Anotan, no pagan (BR-243).
   *  - `crewday:`    → días de la CUADRILLA que cobra por día. Estos SÍ pagan,
   *                    y le pagan al contratista.
   * Van juntos porque se marcan en la misma tarjeta y guardar por separado
   * dejaría media semana anotada.
   */
  const crewIds: string[] = []
  const crewMarked: Array<{ crewId: string; date: string }> = []
  const crewProjects: Record<string, string> = {}

  for (const [key, raw] of formData.entries()) {
    if (key.startsWith('controlmember:')) {
      const workerId = key.slice('controlmember:'.length)
      const crewId = String(raw)
      if (workerId && crewId) workers.push({ workerId, crewId })
    } else if (key.startsWith('controlday:')) {
      const [, workerId, date] = key.split(':')
      if (workerId && date) marked.push({ workerId, date })
    } else if (key.startsWith('crewmember:')) {
      const crewId = key.slice('crewmember:'.length)
      if (crewId) crewIds.push(crewId)
    } else if (key.startsWith('crewday:')) {
      const [, crewId, date] = key.split(':')
      if (crewId && date) crewMarked.push({ crewId, date })
    } else if (key.startsWith('crewproyecto:')) {
      const crewId = key.slice('crewproyecto:'.length)
      const projectId = String(raw)
      if (crewId && projectId) crewProjects[crewId] = projectId
    }
  }

  const control = await saveControlDays(user, weekId, { workers, marked })
  const dias =
    crewIds.length > 0
      ? await saveCrewDays(user, weekId, {
          crewIds,
          marked: crewMarked,
          projects: crewProjects,
        })
      : { ok: true, message: '' }

  revalidatePath(`/payroll/${weekId}`)
  revalidatePath('/approvals')

  if (!control.ok) return control.message
  if (!dias.ok) return dias.message

  const mensaje = [control.message, dias.message].filter(Boolean).join(' ')
  return `LISTO|${mensaje}`
}

/**
 * Guarda los días del equipo rentado de la semana.
 *
 * `equipoday:<equipmentId>:<fecha>` = casilla marcada;
 * `equipomember:<equipmentId>` marca el universo mostrado. Un equipo cuya
 * liquidación ya movió dinero no se toca; lo aprobado se invalida con rastro.
 */
export async function saveEquipmentWeekDays(
  _previous: string | null,
  formData: FormData,
): Promise<string> {
  const user = await assertCan('payroll:edit')
  const weekId = String(formData.get('weekId') ?? '')

  const equipmentIds: string[] = []
  const marked: Array<{ equipmentId: string; date: string }> = []
  // A qué obra se le carga el alquiler de cada equipo esta semana.
  const projects: Record<string, string> = {}

  for (const [key, raw] of formData.entries()) {
    if (key.startsWith('equipomember:')) {
      const equipmentId = key.slice('equipomember:'.length)
      if (equipmentId) equipmentIds.push(equipmentId)
    } else if (key.startsWith('equipoday:')) {
      const [, equipmentId, date] = key.split(':')
      if (equipmentId && date) marked.push({ equipmentId, date })
    } else if (key.startsWith('equipoproyecto:')) {
      const equipmentId = key.slice('equipoproyecto:'.length)
      const projectId = String(raw)
      if (equipmentId && projectId) projects[equipmentId] = projectId
    }
  }

  const result = await saveEquipmentDays(user, weekId, { equipmentIds, marked, projects })
  revalidatePath(`/payroll/${weekId}`)
  revalidatePath('/approvals')
  return result.ok ? `LISTO|${result.message}` : result.message
}

export async function createWorkerWithRate(
  _previous: string | null,
  formData: FormData,
): Promise<string> {
  const company = await getActiveCompany()

  const name = String(formData.get('name') ?? '').trim()
  const rate = String(formData.get('rate') ?? '').trim()
  const rateType = String(formData.get('rateType') ?? 'DAILY')
  const operationId = String(formData.get('operationId') ?? '').trim()
  const weekId = String(formData.get('weekId') ?? '')

  if (!name) return 'Escribe el nombre.'
  if (!/^\d+(\.\d{1,2})?$/.test(rate)) return 'La tarifa debe ser un número, con máximo 2 decimales.'

  const week = await prisma.payrollWeek.findFirst({ where: { id: weekId, companyId: company.id } })
  if (!week) return 'Período no encontrado.'

  const duplicate = await prisma.worker.findFirst({
    where: { companyId: company.id, displayName: { equals: name, mode: 'insensitive' } },
  })
  if (duplicate) {
    return `Ya existe "${duplicate.displayName}". Búscalo en la lista en vez de crearlo otra vez.`
  }

  const count = await prisma.worker.count({ where: { companyId: company.id } })
  const parts = name.split(/\s+/)

  await prisma.$transaction(async (tx) => {
    const worker = await tx.worker.create({
      data: {
        companyId: company.id,
        code: `W-${String(count + 1).padStart(4, '0')}`,
        firstName: parts[0] ?? name,
        lastName: parts.slice(1).join(' ') || '—',
        displayName: name,
        compensationType: rateType === 'HOURLY' ? 'HOURLY' : 'DAILY_RATE',
        defaultOperationId: operationId || null,
      },
    })

    await tx.workerRate.create({
      data: {
        companyId: company.id,
        workerId: worker.id,
        rateType: rateType === 'HOURLY' ? 'HOURLY' : 'DAILY',
        amount: rate,
        effectiveFrom: week.startDate,
        operationId: operationId || null,
        sourceNote: 'Creada al armar la nómina',
      },
    })

    await tx.payrollWeekMember.create({
      data: { companyId: company.id, payrollWeekId: week.id, workerId: worker.id },
    })

    await tx.auditLog.create({
      data: {
        companyId: company.id,
        action: 'WORKER_CREATED_IN_PAYROLL',
        entityType: 'Worker',
        entityId: worker.id,
        payrollWeekId: week.id,
        newValueJson: { name, rate, rateType },
        changedFields: ['displayName', 'rate'],
      },
    })
  })

  revalidatePath(`/payroll/${weekId}`)
  return `LISTO|${name} agregado con tarifa $${Number(rate).toFixed(2)}`
}

// ─────────────────────────────────────────────────────────────
// Descuentos y adicionales de la semana
// ─────────────────────────────────────────────────────────────

/**
 * Anota un descuento o un adicional de la semana.
 *
 * Tras guardarlo hay que volver a calcular para que entre al pago: el mensaje
 * lo dice, en vez de dejar a alguien creyendo que ya quedó aplicado.
 */
export async function addWeekExtra(
  _previous: string | null,
  formData: FormData,
): Promise<string> {
  const user = await assertCan('payroll:edit')
  const text = (key: string) => String(formData.get(key) ?? '')

  const result = await addExtra(user, {
    weekId: text('weekId'),
    workerId: text('workerId'),
    kind: text('kind') === 'ADDITION' ? 'ADDITION' : 'DEDUCTION',
    category: text('category'),
    amount: text('amount'),
    description: text('description'),
    workDate: text('workDate') || null,
  })

  revalidatePath(`/payroll/${text('weekId')}`)
  return result.ok ? `LISTO|${result.message}` : result.message
}

export async function removeWeekExtra(
  _previous: string | null,
  formData: FormData,
): Promise<string> {
  const user = await assertCan('payroll:edit')
  const kind = String(formData.get('kind')) === 'ADDITION' ? 'ADDITION' : 'DEDUCTION'

  const result = await removeExtra(user, kind, String(formData.get('extraId') ?? ''))
  revalidatePath(`/payroll/${String(formData.get('weekId') ?? '')}`)
  return result.ok ? `LISTO|${result.message}` : result.message
}

/**
 * Deja la semana como antes de calcular.
 *
 * Existe para poder ENSAYAR. Sin este botón, un cálculo mal hecho deja la
 * semana a medias para siempre y la única salida es tocar la base a mano.
 * No borra días marcados ni producción, y se niega si algo ya se pagó
 * (regla 6: lo pagado se corrige con un ajuste, nunca con un borrón).
 */
export async function resetWeek(formData: FormData) {
  const user = await assertCan('payroll:edit')
  const weekId = String(formData.get('weekId') ?? '')

  const result = await reiniciarSemana(user, weekId, String(formData.get('motivo') ?? ''))

  revalidatePath(`/payroll/${weekId}`)
  revalidatePath('/inicio')
  revalidatePath('/approvals')
  revalidatePath('/disbursements')
  redirect(`/payroll/${weekId}?msg=${encodeURIComponent(result.message)}`)
}

/**
 * Guarda de una vez el desglose de la gente del contratista y lo que dice la
 * fuente externa.
 *
 * Van juntos a propósito: quien monta la nómina teclea las tarifas y el total
 * de SharePoint en la misma pasada, y guardar por separado dejaría una mitad
 * conciliada contra la otra vieja.
 */
export async function saveContractorBreakdown(
  _previous: string | null,
  formData: FormData,
): Promise<string> {
  const user = await assertCan('payroll:edit')
  const crewPayrollId = String(formData.get('crewPayrollId') ?? '')

  let filas: MemberInput[]
  try {
    filas = JSON.parse(String(formData.get('filas') ?? '[]')) as MemberInput[]
  } catch {
    return 'No se pudo leer la tabla. Recarga la página e inténtalo de nuevo.'
  }

  const desglose = await saveCrewBreakdown(user, {
    crewPayrollId,
    members: filas.filter((fila) => fila.name?.trim()),
  })
  if (!desglose.ok) return desglose.message

  const conciliacion = await saveExpectedTotal(user, {
    crewPayrollId,
    expectedTotal: String(formData.get('expectedTotal') ?? ''),
  })

  const week = await prisma.crewPayroll.findUnique({
    where: { id: crewPayrollId },
    select: { payrollWeekId: true },
  })
  if (week) revalidatePath(`/payroll/${week.payrollWeekId}`)

  if (!conciliacion.ok) return conciliacion.message
  return `LISTO|${desglose.message} ${conciliacion.message}`
}

/**
 * Agrega o saca un equipo de la semana.
 *
 * Lo pidió el negocio: la semana ofrecía TODAS las máquinas activas siempre, y
 * no había cómo decir cuáles estuvieron en obra. Ahora se escogen, como se
 * escoge la gente.
 */
export async function toggleEquipoEnSemana(
  _previous: string | null,
  formData: FormData,
): Promise<string> {
  const user = await assertCan('payroll:edit')
  const weekId = String(formData.get('weekId') ?? '')

  const resultado = await alternarEquipoEnSemana(
    user,
    weekId,
    String(formData.get('equipmentId') ?? ''),
  )

  revalidatePath(`/payroll/${weekId}`)
  return resultado.ok ? `LISTO|${resultado.message}` : resultado.message
}

/**
 * Agrega o saca una cuadrilla de la semana.
 *
 * Antes solo aparecían las que ya tenían producción capturada, así que no
 * había por dónde empezar a liquidar a una cuadrilla nueva.
 */
export async function toggleCuadrillaEnSemana(
  _previous: string | null,
  formData: FormData,
): Promise<string> {
  const user = await assertCan('payroll:edit')
  const weekId = String(formData.get('weekId') ?? '')

  const resultado = await alternarCuadrillaEnSemana(
    user,
    weekId,
    String(formData.get('crewId') ?? ''),
  )

  revalidatePath(`/payroll/${weekId}`)
  return resultado.ok ? `LISTO|${resultado.message}` : resultado.message
}
