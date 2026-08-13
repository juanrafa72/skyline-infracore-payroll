/**
 * Estas pruebas verifican que las protecciones viven en la BASE DE DATOS, no en el
 * código. Se ejecutan con SQL crudo, saltándose por completo la aplicación: si alguien
 * entrara directo a la base, estas reglas seguirían impidiendo el daño.
 */
import 'dotenv/config'
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const pool = new Pool({ connectionString: process.env.DATABASE_URL })

const ids = {
  company: 'test-company-guardrails',
  week: 'test-week-guardrails',
  worker: 'test-worker-guardrails',
  payroll: 'test-payroll-guardrails',
  audit: 'test-audit-guardrails',
  advance: 'test-advance-guardrails',
  debt: 'test-debt-guardrails',
}

beforeAll(async () => {
  await cleanup()
  await pool.query(
    `INSERT INTO company (id, code, "legalName", "displayName", "updatedAt")
     VALUES ($1, 'TEST_GUARDRAILS', 'Test Co', 'Test Co', now())`,
    [ids.company],
  )
  await pool.query(
    `INSERT INTO payroll_week (id, "companyId", year, "weekNumber", "startDate", "endDate", label)
     VALUES ($1, $2, 2026, 99, '2026-07-19', '2026-07-25', 'Semana 99')`,
    [ids.week, ids.company],
  )
  await pool.query(
    `INSERT INTO worker (id, "companyId", code, "firstName", "lastName", "displayName", "updatedAt")
     VALUES ($1, $2, 'TESTW', 'Test', 'Worker', 'Test Worker', now())`,
    [ids.worker, ids.company],
  )
})

afterAll(async () => {
  await cleanup()
  await pool.end()
})

async function cleanup() {
  // El audit_log no se puede borrar: se limpia deshabilitando el trigger a propósito,
  // que es exactamente el privilegio que la aplicación nunca tiene.
  await pool.query('ALTER TABLE audit_log DISABLE TRIGGER audit_log_no_delete')
  await pool.query('DELETE FROM audit_log WHERE id = $1', [ids.audit])
  await pool.query('ALTER TABLE audit_log ENABLE TRIGGER audit_log_no_delete')

  await pool.query('ALTER TABLE worker_payroll DISABLE TRIGGER worker_payroll_immutable')
  await pool.query('DELETE FROM worker_payroll WHERE id = $1', [ids.payroll])
  await pool.query('ALTER TABLE worker_payroll ENABLE TRIGGER worker_payroll_immutable')

  await pool.query('DELETE FROM advance WHERE id = $1', [ids.advance])
  await pool.query('DELETE FROM debt_transaction WHERE "debtId" = $1', [ids.debt])
  await pool.query('DELETE FROM debt WHERE id = $1', [ids.debt])
  await pool.query('DELETE FROM work_entry WHERE "companyId" = $1', [ids.company])
  await pool.query('DELETE FROM worker_rate WHERE "companyId" = $1', [ids.company])
  await pool.query('DELETE FROM worker WHERE id = $1', [ids.worker])
  await pool.query('DELETE FROM payroll_week WHERE id = $1', [ids.week])
  await pool.query('DELETE FROM company WHERE id = $1', [ids.company])
}

describe('audit_log es append-only — BR-140', () => {
  it('permite insertar', async () => {
    await pool.query(
      `INSERT INTO audit_log (id, "companyId", action, "entityType", "entityId", "changedFields")
       VALUES ($1, $2, 'TEST', 'Worker', 'x', ARRAY['days'])`,
      [ids.audit, ids.company],
    )
    const { rows } = await pool.query('SELECT action FROM audit_log WHERE id = $1', [ids.audit])
    expect(rows[0].action).toBe('TEST')
  })

  it('rechaza modificar un registro de auditoría', async () => {
    await expect(
      pool.query(`UPDATE audit_log SET action = 'ALTERADO' WHERE id = $1`, [ids.audit]),
    ).rejects.toThrow(/append-only/)
  })

  it('rechaza borrar un registro de auditoría', async () => {
    await expect(
      pool.query('DELETE FROM audit_log WHERE id = $1', [ids.audit]),
    ).rejects.toThrow(/append-only/)
  })
})

describe('una nómina pagada es inmutable', () => {
  beforeAll(async () => {
    await pool.query(
      `INSERT INTO worker_payroll
         (id, "companyId", "payrollWeekId", "workerId", status,
          "basePay", "grossPay", "netPay", "updatedAt")
       VALUES ($1, $2, $3, $4, 'PAID', 1000.00, 1000.00, 900.00, now())`,
      [ids.payroll, ids.company, ids.week, ids.worker],
    )
  })

  it('rechaza cambiar el neto de una nómina pagada', async () => {
    await expect(
      pool.query(`UPDATE worker_payroll SET "netPay" = 9999.00 WHERE id = $1`, [ids.payroll]),
    ).rejects.toThrow(/inmutable/)
  })

  it('rechaza cambiar los días de una nómina pagada', async () => {
    await expect(
      pool.query(`UPDATE worker_payroll SET "daysFull" = 7 WHERE id = $1`, [ids.payroll]),
    ).rejects.toThrow(/inmutable/)
  })

  it('rechaza borrar una nómina pagada', async () => {
    await expect(
      pool.query('DELETE FROM worker_payroll WHERE id = $1', [ids.payroll]),
    ).rejects.toThrow(/No se puede borrar/)
  })

  it('rechaza devolver una nómina pagada a borrador', async () => {
    await expect(
      pool.query(`UPDATE worker_payroll SET status = 'DRAFT' WHERE id = $1`, [ids.payroll]),
    ).rejects.toThrow(/Transicion no permitida/)
  })

  it('permite avanzar PAID → RECONCILED → CLOSED', async () => {
    await pool.query(`UPDATE worker_payroll SET status = 'RECONCILED' WHERE id = $1`, [ids.payroll])
    await pool.query(`UPDATE worker_payroll SET status = 'CLOSED' WHERE id = $1`, [ids.payroll])
    const { rows } = await pool.query('SELECT status FROM worker_payroll WHERE id = $1', [ids.payroll])
    expect(rows[0].status).toBe('CLOSED')
  })

  it('rechaza agregar un descuento a una nómina cerrada', async () => {
    await expect(
      pool.query(
        `INSERT INTO deduction (id, "companyId", "workerPayrollId", category, amount, description)
         VALUES ('test-ded-guardrails', $1, $2, 'OTHER', 50.00, 'intento tardio')`,
        [ids.company, ids.payroll],
      ),
    ).rejects.toThrow(/inmutables/)
  })
})

describe('anticipos y deudas', () => {
  it('rechaza cambiar el monto de un anticipo aprobado — BR-081', async () => {
    await pool.query(
      `INSERT INTO advance
         (id, "companyId", "beneficiaryType", "workerId", "requestDate", amount, reason, status, "updatedAt")
       VALUES ($1, $2, 'WORKER', $3, '2026-07-01', 500.00, 'prueba', 'APPROVED', now())`,
      [ids.advance, ids.company, ids.worker],
    )
    await expect(
      pool.query(`UPDATE advance SET amount = 800.00 WHERE id = $1`, [ids.advance]),
    ).rejects.toThrow(/no se modifica/)
  })

  it('rechaza una condonación de deuda sin aprobador — BR-093', async () => {
    await pool.query(
      `INSERT INTO debt
         (id, "companyId", "debtorType", "workerId", "originalAmount", "originDate", reason, "updatedAt")
       VALUES ($1, $2, 'WORKER', $3, 1000.00, '2026-06-01', 'prueba', now())`,
      [ids.debt, ids.company, ids.worker],
    )
    await expect(
      pool.query(
        `INSERT INTO debt_transaction
           (id, "debtId", "companyId", type, amount, "transactionDate", description)
         VALUES ('test-dt-guardrails', $1, $2, 'FORGIVENESS', 200.00, '2026-07-01', 'se le regala')`,
        [ids.debt, ids.company],
      ),
    ).rejects.toThrow(/debt_forgiveness_requires_approver/)
  })
})

describe('coherencia de datos', () => {
  it('rechaza dos tarifas solapadas para el mismo alcance — BR-035', async () => {
    await pool.query(
      `INSERT INTO worker_rate (id, "companyId", "workerId", amount, "effectiveFrom", "effectiveTo")
       VALUES ('test-rate-a', $1, $2, 143.00, '2026-01-01', '2026-06-30')`,
      [ids.company, ids.worker],
    )
    await expect(
      pool.query(
        `INSERT INTO worker_rate (id, "companyId", "workerId", amount, "effectiveFrom", "effectiveTo")
         VALUES ('test-rate-b', $1, $2, 190.00, '2026-05-01', '2026-12-31')`,
        [ids.company, ids.worker],
      ),
    ).rejects.toThrow(/worker_rate_no_overlap/)
  })

  it('acepta tarifas consecutivas sin solape', async () => {
    await pool.query(
      `INSERT INTO worker_rate (id, "companyId", "workerId", amount, "effectiveFrom", "effectiveTo")
       VALUES ('test-rate-c', $1, $2, 190.00, '2026-06-30', '2026-12-31')`,
      [ids.company, ids.worker],
    )
    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM worker_rate WHERE "workerId" = $1`,
      [ids.worker],
    )
    expect(rows[0].n).toBe(2)
  })

  it('rechaza horas en un día que no es por horas — BR-024', async () => {
    await expect(
      pool.query(
        `INSERT INTO work_entry
           (id, "companyId", "payrollWeekId", "workerId", "workDate", "dayType", "hoursWorked", "updatedAt")
         VALUES ('test-we-a', $1, $2, $3, '2026-07-20', 'FULL_DAY', 8, now())`,
        [ids.company, ids.week, ids.worker],
      ),
    ).rejects.toThrow(/work_entry_hours_only_when_hourly/)
  })

  it('rechaza dos días del mismo trabajador en la misma fecha — BR-025', async () => {
    await pool.query(
      `INSERT INTO work_entry
         (id, "companyId", "payrollWeekId", "workerId", "workDate", "dayType", "updatedAt")
       VALUES ('test-we-b', $1, $2, $3, '2026-07-21', 'FULL_DAY', now())`,
      [ids.company, ids.week, ids.worker],
    )
    await expect(
      pool.query(
        `INSERT INTO work_entry
           (id, "companyId", "payrollWeekId", "workerId", "workDate", "dayType", "updatedAt")
         VALUES ('test-we-c', $1, $2, $3, '2026-07-21', 'HALF_DAY', now())`,
        [ids.company, ids.week, ids.worker],
      ),
    ).rejects.toThrow(/work_entry_companyId_workerId_workDate_key/)
  })

  it('rechaza un descuento sin explicación — BR-071', async () => {
    await expect(
      pool.query(
        `INSERT INTO deduction (id, "companyId", category, amount, description)
         VALUES ('test-ded-empty', $1, 'OTHER', 50.00, '   ')`,
        [ids.company],
      ),
    ).rejects.toThrow(/deduction_description_required/)
  })
})
