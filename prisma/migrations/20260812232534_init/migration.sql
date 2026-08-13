-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'DISABLED');

-- CreateEnum
CREATE TYPE "PersonType" AS ENUM ('EMPLOYEE', 'CONTRACTOR_MEMBER', 'ADMINISTRATIVE', 'SUBCONTRACTOR');

-- CreateEnum
CREATE TYPE "WorkerStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'TERMINATED');

-- CreateEnum
CREATE TYPE "CompensationType" AS ENUM ('DAILY_RATE', 'HOURLY', 'FIXED_WEEKLY', 'PRODUCTION', 'PIECE_RATE', 'PERCENTAGE', 'CONTRACTOR_SETTLEMENT', 'MANUAL');

-- CreateEnum
CREATE TYPE "RateType" AS ENUM ('DAILY', 'HOURLY', 'WEEKLY', 'PIECE', 'PERCENTAGE');

-- CreateEnum
CREATE TYPE "Shift" AS ENUM ('DAY', 'NIGHT', 'ANY');

-- CreateEnum
CREATE TYPE "CrewRole" AS ENUM ('LEADER', 'MEMBER');

-- CreateEnum
CREATE TYPE "EquipmentKind" AS ENUM ('MACHINE', 'VEHICLE', 'TOOL');

-- CreateEnum
CREATE TYPE "Ownership" AS ENUM ('OWNED', 'RENTED', 'SUBCONTRACTED');

-- CreateEnum
CREATE TYPE "EquipmentStatus" AS ENUM ('ACTIVE', 'IN_REPAIR', 'RETIRED');

-- CreateEnum
CREATE TYPE "PayrollWeekStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "DayType" AS ENUM ('FULL_DAY', 'HALF_DAY', 'NO_WORK', 'HOURLY', 'OTHER');

-- CreateEnum
CREATE TYPE "WorkEntryStatus" AS ENUM ('WORKED', 'NO_WORK', 'WAITING_PROJECT', 'RAIN', 'VACATION', 'MAINTENANCE', 'REST', 'OTHER');

-- CreateEnum
CREATE TYPE "SourceType" AS ENUM ('MANUAL', 'IMPORT', 'SHAREPOINT');

-- CreateEnum
CREATE TYPE "PayrollStatus" AS ENUM ('DRAFT', 'PREPARED', 'PENDING_APPROVAL', 'REJECTED', 'APPROVED', 'READY_TO_PAY', 'PAYMENT_IN_PROCESS', 'PAID', 'RECONCILED', 'CLOSED', 'IMPORTED_HISTORICAL');

-- CreateEnum
CREATE TYPE "LineType" AS ENUM ('BASE_DAY', 'BASE_HALF_DAY', 'BASE_HOURLY', 'BASE_WEEKLY', 'BASE_PRODUCTION', 'BASE_PIECE', 'BASE_PERCENTAGE');

-- CreateEnum
CREATE TYPE "AdditionCategory" AS ENUM ('BONUS', 'REIMBURSEMENT', 'TRAVEL', 'PER_DIEM', 'COMPLETION_BONUS', 'EMERGENCY', 'MANUAL_ADJUSTMENT', 'OTHER');

-- CreateEnum
CREATE TYPE "DeductionCategory" AS ENUM ('ADVANCE_RECOVERY', 'DEBT_RECOVERY', 'EQUIPMENT', 'HOTEL', 'VEHICLE', 'LOAN', 'DAMAGE', 'PPE', 'RENT', 'CASH_ADVANCE', 'OTHER');

-- CreateEnum
CREATE TYPE "DeductionSource" AS ENUM ('MANUAL', 'ADVANCE_ENGINE', 'DEBT_ENGINE');

-- CreateEnum
CREATE TYPE "BeneficiaryType" AS ENUM ('WORKER', 'CONTRACTOR');

-- CreateEnum
CREATE TYPE "RecoveryMethod" AS ENUM ('FIXED_WEEKLY', 'PERCENTAGE_OF_NET', 'PERCENTAGE_WITH_CAP', 'MANUAL', 'LUMP_SUM');

-- CreateEnum
CREATE TYPE "AdvanceStatus" AS ENUM ('PENDING', 'APPROVED', 'ACTIVE', 'PARTIALLY_RECOVERED', 'PAID', 'CANCELLED');

-- CreateEnum
CREATE TYPE "DebtorType" AS ENUM ('WORKER', 'CONTRACTOR', 'VENDOR');

-- CreateEnum
CREATE TYPE "DebtStatus" AS ENUM ('ACTIVE', 'PARTIALLY_RECOVERED', 'SETTLED', 'WRITTEN_OFF', 'PAUSED');

-- CreateEnum
CREATE TYPE "DebtTransactionType" AS ENUM ('ORIGINAL', 'CHARGE', 'PAYMENT', 'PAYROLL_RECOVERY', 'FORGIVENESS', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "PayeeType" AS ENUM ('WORKER', 'CONTRACTOR', 'VENDOR');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('ZELLE', 'ACH', 'WIRE', 'CHECK', 'CASH', 'OTHER');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'IN_PROCESS', 'PAID', 'FAILED', 'REVERSED');

-- CreateEnum
CREATE TYPE "AdjustmentType" AS ENUM ('ADJUSTMENT', 'REVERSAL', 'ADDITIONAL_PAYMENT', 'CREDIT');

-- CreateEnum
CREATE TYPE "ImportSourceType" AS ENUM ('EXCEL', 'SHAREPOINT', 'CSV');

-- CreateEnum
CREATE TYPE "ImportStatus" AS ENUM ('PENDING', 'MAPPING', 'PREVIEW', 'VALIDATED', 'IMPORTED', 'REVERTED', 'FAILED');

-- CreateEnum
CREATE TYPE "ImportRowStatus" AS ENUM ('ACCEPTED', 'REJECTED', 'DUPLICATE');

-- CreateEnum
CREATE TYPE "ExceptionLevel" AS ENUM ('WARNING', 'REVIEW_REQUIRED', 'CRITICAL');

-- CreateEnum
CREATE TYPE "ExceptionStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "VarianceStatus" AS ENUM ('OPEN', 'EXPLAINED', 'RESOLVED');

-- CreateTable
CREATE TABLE "company" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "legalName" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "ein" TEXT,
    "address" TEXT,
    "logoUrl" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "timezone" TEXT NOT NULL DEFAULT 'America/New_York',
    "weekStartDay" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "company_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_user" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT,
    "entraObjectId" TEXT,
    "mfaSecret" TEXT,
    "mfaEnabled" BOOLEAN NOT NULL DEFAULT false,
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "failedLoginCount" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "lastLoginAt" TIMESTAMP(3),
    "mustChangePassword" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "app_user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permission" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT,

    CONSTRAINT "permission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_permission" (
    "roleId" TEXT NOT NULL,
    "permissionId" TEXT NOT NULL,

    CONSTRAINT "role_permission_pkey" PRIMARY KEY ("roleId","permissionId")
);

-- CreateTable
CREATE TABLE "user_company_role" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "assignedById" TEXT,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "user_company_role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "activeCompanyId" TEXT,
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "user_session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "operation" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "operation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "contactName" TEXT,
    "contactEmail" TEXT,
    "contactPhone" TEXT,
    "paymentTerms" TEXT,
    "earlyPaymentDiscountPct" DECIMAL(7,4),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "customerId" TEXT,
    "operationId" TEXT,
    "location" TEXT,
    "state" TEXT,
    "projectManagerId" TEXT,
    "startDate" DATE,
    "endDate" DATE,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "worker" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "personType" "PersonType" NOT NULL DEFAULT 'EMPLOYEE',
    "compensationType" "CompensationType" NOT NULL DEFAULT 'DAILY_RATE',
    "isOnFormalPayroll" BOOLEAN NOT NULL DEFAULT false,
    "defaultOperationId" TEXT,
    "defaultCrewId" TEXT,
    "defaultProjectId" TEXT,
    "contractorId" TEXT,
    "hireDate" DATE,
    "terminationDate" DATE,
    "status" "WorkerStatus" NOT NULL DEFAULT 'ACTIVE',
    "email" TEXT,
    "phone" TEXT,
    "portalUserId" TEXT,
    "bankAccountLast4" TEXT,
    "paymentMethodDefault" "PaymentMethod",
    "documentsFolderRef" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "worker_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "worker_alias" (
    "id" TEXT NOT NULL,
    "workerId" TEXT NOT NULL,
    "alias" TEXT NOT NULL,
    "sourceFile" TEXT,
    "sourceSheet" TEXT,
    "confirmed" BOOLEAN NOT NULL DEFAULT false,
    "resolvedById" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "worker_alias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "worker_rate" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "workerId" TEXT NOT NULL,
    "rateType" "RateType" NOT NULL DEFAULT 'DAILY',
    "amount" DECIMAL(18,2) NOT NULL,
    "shift" "Shift" NOT NULL DEFAULT 'ANY',
    "projectId" TEXT,
    "operationId" TEXT,
    "effectiveFrom" DATE NOT NULL,
    "effectiveTo" DATE,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "sourceNote" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "worker_rate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contractor" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "legalName" TEXT,
    "ein" TEXT,
    "contactName" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "commissionPct" DECIMAL(7,4),
    "paymentTerms" TEXT,
    "portalUserId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contractor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crew" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "operationId" TEXT,
    "contractorId" TEXT,
    "projectId" TEXT,
    "leaderWorkerId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crew_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crew_membership" (
    "id" TEXT NOT NULL,
    "crewId" TEXT NOT NULL,
    "workerId" TEXT NOT NULL,
    "role" "CrewRole" NOT NULL DEFAULT 'MEMBER',
    "from" DATE NOT NULL,
    "to" DATE,

    CONSTRAINT "crew_membership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "equipment" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "EquipmentKind" NOT NULL DEFAULT 'MACHINE',
    "ownership" "Ownership" NOT NULL DEFAULT 'OWNED',
    "dailyCost" DECIMAL(18,2),
    "vendorId" TEXT,
    "assignedCrewId" TEXT,
    "assignedProjectId" TEXT,
    "status" "EquipmentStatus" NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "equipment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendor" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "taxId" TEXT,
    "contact" TEXT,
    "category" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vendor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_week" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "weekNumber" INTEGER NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "label" TEXT NOT NULL,
    "status" "PayrollWeekStatus" NOT NULL DEFAULT 'OPEN',
    "createdById" TEXT,
    "closedById" TEXT,
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payroll_week_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_entry" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "payrollWeekId" TEXT NOT NULL,
    "workerId" TEXT NOT NULL,
    "workDate" DATE NOT NULL,
    "dayType" "DayType" NOT NULL,
    "hoursWorked" DECIMAL(6,2),
    "shift" "Shift" NOT NULL DEFAULT 'DAY',
    "projectId" TEXT,
    "crewId" TEXT,
    "operationId" TEXT,
    "status" "WorkEntryStatus" NOT NULL DEFAULT 'WORKED',
    "reasonCode" TEXT,
    "notes" TEXT,
    "sourceType" "SourceType" NOT NULL DEFAULT 'MANUAL',
    "importRowId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "work_entry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "worker_payroll" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "payrollWeekId" TEXT NOT NULL,
    "workerId" TEXT NOT NULL,
    "status" "PayrollStatus" NOT NULL DEFAULT 'DRAFT',
    "daysFull" INTEGER NOT NULL DEFAULT 0,
    "daysHalf" INTEGER NOT NULL DEFAULT 0,
    "daysNoWork" INTEGER NOT NULL DEFAULT 0,
    "hoursTotal" DECIMAL(8,2) NOT NULL DEFAULT 0,
    "basePay" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "additionsTotal" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "grossPay" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "deductionsTotal" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "netPay" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "calculationVersion" INTEGER NOT NULL DEFAULT 1,
    "calculationHash" TEXT,
    "preparedById" TEXT,
    "preparedAt" TIMESTAMP(3),
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "approvalInvalidatedAt" TIMESTAMP(3),
    "approvalInvalidatedReason" TEXT,
    "rejectedById" TEXT,
    "rejectedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "paymentId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "worker_payroll_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_line" (
    "id" TEXT NOT NULL,
    "workerPayrollId" TEXT NOT NULL,
    "workEntryId" TEXT,
    "lineType" "LineType" NOT NULL,
    "workDate" DATE,
    "quantity" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "appliedRate" DECIMAL(18,2) NOT NULL,
    "rateSourceId" TEXT,
    "amount" DECIMAL(18,2) NOT NULL,
    "projectId" TEXT,
    "crewId" TEXT,
    "shift" "Shift" NOT NULL DEFAULT 'DAY',
    "description" TEXT,

    CONSTRAINT "payroll_line_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "addition" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "workerPayrollId" TEXT,
    "contractorSettlementId" TEXT,
    "category" "AdditionCategory" NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "description" TEXT NOT NULL,
    "workDate" DATE,
    "createdById" TEXT,
    "approvedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "addition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deduction" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "workerPayrollId" TEXT,
    "contractorSettlementId" TEXT,
    "category" "DeductionCategory" NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "description" TEXT NOT NULL,
    "sourceType" "DeductionSource" NOT NULL DEFAULT 'MANUAL',
    "advanceRecoveryId" TEXT,
    "debtTransactionId" TEXT,
    "workDate" DATE,
    "createdById" TEXT,
    "approvedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "deduction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contractor_settlement" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "payrollWeekId" TEXT NOT NULL,
    "contractorId" TEXT NOT NULL,
    "projectId" TEXT,
    "invoiceNumber" TEXT,
    "invoiceAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "additionsTotal" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "deductionsTotal" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "advanceRecoveryTotal" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "commissionPct" DECIMAL(7,4),
    "commissionAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "earlyPaymentDiscount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "netSettlement" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "status" "PayrollStatus" NOT NULL DEFAULT 'DRAFT',
    "calculationHash" TEXT,
    "preparedById" TEXT,
    "preparedAt" TIMESTAMP(3),
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "approvalInvalidatedAt" TIMESTAMP(3),
    "paymentId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contractor_settlement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settlement_line" (
    "id" TEXT NOT NULL,
    "contractorSettlementId" TEXT NOT NULL,
    "lineType" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "unitAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "amount" DECIMAL(18,2) NOT NULL,
    "projectId" TEXT,
    "crewId" TEXT,

    CONSTRAINT "settlement_line_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "advance" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "beneficiaryType" "BeneficiaryType" NOT NULL,
    "workerId" TEXT,
    "contractorId" TEXT,
    "requestDate" DATE NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "recoveryMethod" "RecoveryMethod" NOT NULL DEFAULT 'FIXED_WEEKLY',
    "recoveryAmount" DECIMAL(18,2),
    "recoveryPct" DECIMAL(7,4),
    "recoveryCap" DECIMAL(18,2),
    "recoveryStartWeek" TEXT,
    "status" "AdvanceStatus" NOT NULL DEFAULT 'PENDING',
    "requestedById" TEXT,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "paidPaymentId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "advance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "advance_recovery" (
    "id" TEXT NOT NULL,
    "advanceId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "payrollWeekId" TEXT,
    "workerPayrollId" TEXT,
    "contractorSettlementId" TEXT,
    "amount" DECIMAL(18,2) NOT NULL,
    "recoveredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,
    "notes" TEXT,

    CONSTRAINT "advance_recovery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "advance_pause" (
    "id" TEXT NOT NULL,
    "advanceId" TEXT NOT NULL,
    "payrollWeekId" TEXT,
    "from" DATE,
    "to" DATE,
    "reason" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "advance_pause_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "debt" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "debtorType" "DebtorType" NOT NULL,
    "workerId" TEXT,
    "contractorId" TEXT,
    "vendorId" TEXT,
    "originalAmount" DECIMAL(18,2) NOT NULL,
    "originDate" DATE NOT NULL,
    "reason" TEXT NOT NULL,
    "recoveryRule" "RecoveryMethod" NOT NULL DEFAULT 'FIXED_WEEKLY',
    "recoveryAmount" DECIMAL(18,2),
    "recoveryPct" DECIMAL(7,4),
    "recoveryCap" DECIMAL(18,2),
    "status" "DebtStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdById" TEXT,
    "approvedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "debt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "debt_transaction" (
    "id" TEXT NOT NULL,
    "debtId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "type" "DebtTransactionType" NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "transactionDate" DATE NOT NULL,
    "description" TEXT NOT NULL,
    "payrollWeekId" TEXT,
    "paymentId" TEXT,
    "createdById" TEXT,
    "approvedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "debt_transaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "paymentNumber" TEXT NOT NULL,
    "payeeType" "PayeeType" NOT NULL,
    "workerId" TEXT,
    "contractorId" TEXT,
    "vendorId" TEXT,
    "payrollWeekId" TEXT,
    "approvedAmount" DECIMAL(18,2) NOT NULL,
    "amountPaid" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "paymentDate" DATE,
    "method" "PaymentMethod",
    "reference" TEXT,
    "bankAccountLast4" TEXT,
    "notes" TEXT,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "paidById" TEXT,
    "paidAt" TIMESTAMP(3),
    "reversedById" TEXT,
    "reversedAt" TIMESTAMP(3),
    "reversalReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_proof" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "fileKey" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "uploadedById" TEXT,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_proof_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "receipt" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "receiptNumber" TEXT NOT NULL,
    "pdfFileKey" TEXT,
    "snapshotJson" JSONB NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "generatedById" TEXT,
    "sentEmailAt" TIMESTAMP(3),
    "sentWhatsappAt" TIMESTAMP(3),
    "downloadCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "receipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_adjustment" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "originalPaymentId" TEXT NOT NULL,
    "type" "AdjustmentType" NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "newPaymentId" TEXT,
    "createdById" TEXT,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_adjustment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_batch" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileHash" TEXT NOT NULL,
    "sourceType" "ImportSourceType" NOT NULL DEFAULT 'EXCEL',
    "targetEntity" TEXT NOT NULL,
    "importedById" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "rowsRead" INTEGER NOT NULL DEFAULT 0,
    "rowsAccepted" INTEGER NOT NULL DEFAULT 0,
    "rowsRejected" INTEGER NOT NULL DEFAULT 0,
    "rowsDuplicated" INTEGER NOT NULL DEFAULT 0,
    "status" "ImportStatus" NOT NULL DEFAULT 'PENDING',
    "mappingJson" JSONB,
    "notes" TEXT,

    CONSTRAINT "import_batch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_row" (
    "id" TEXT NOT NULL,
    "importBatchId" TEXT NOT NULL,
    "rowNumber" INTEGER NOT NULL,
    "rawJson" JSONB NOT NULL,
    "naturalKey" TEXT,
    "status" "ImportRowStatus" NOT NULL DEFAULT 'ACCEPTED',
    "rejectionReason" TEXT,
    "createdEntityType" TEXT,
    "createdEntityId" TEXT,

    CONSTRAINT "import_row_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exception" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "level" "ExceptionLevel" NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "payrollWeekId" TEXT,
    "workerId" TEXT,
    "title" TEXT NOT NULL,
    "detail" TEXT,
    "expectedValue" DECIMAL(18,2),
    "actualValue" DECIMAL(18,2),
    "difference" DECIMAL(18,2),
    "status" "ExceptionStatus" NOT NULL DEFAULT 'OPEN',
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedById" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolutionNote" TEXT,

    CONSTRAINT "exception_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "variance" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "context" TEXT NOT NULL,
    "sourceAName" TEXT NOT NULL,
    "sourceAAmount" DECIMAL(18,2) NOT NULL,
    "sourceBName" TEXT NOT NULL,
    "sourceBAmount" DECIMAL(18,2) NOT NULL,
    "difference" DECIMAL(18,2) NOT NULL,
    "payrollWeekId" TEXT,
    "entityType" TEXT,
    "entityId" TEXT,
    "status" "VarianceStatus" NOT NULL DEFAULT 'OPEN',
    "explanation" TEXT,
    "resolvedById" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "variance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" TEXT NOT NULL,
    "companyId" TEXT,
    "userId" TEXT,
    "userEmailSnapshot" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "payrollWeekId" TEXT,
    "oldValueJson" JSONB,
    "newValueJson" JSONB,
    "changedFields" TEXT[],
    "reason" TEXT,
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "company_setting" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "valueType" TEXT NOT NULL DEFAULT 'string',
    "confirmed" BOOLEAN NOT NULL DEFAULT false,
    "needsBusinessConfirmation" BOOLEAN NOT NULL DEFAULT false,
    "confirmedById" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "description" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "company_setting_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "company_code_key" ON "company"("code");

-- CreateIndex
CREATE UNIQUE INDEX "app_user_email_key" ON "app_user"("email");

-- CreateIndex
CREATE UNIQUE INDEX "app_user_entraObjectId_key" ON "app_user"("entraObjectId");

-- CreateIndex
CREATE UNIQUE INDEX "role_code_key" ON "role"("code");

-- CreateIndex
CREATE UNIQUE INDEX "permission_code_key" ON "permission"("code");

-- CreateIndex
CREATE INDEX "user_company_role_companyId_active_idx" ON "user_company_role"("companyId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "user_company_role_userId_companyId_roleId_key" ON "user_company_role"("userId", "companyId", "roleId");

-- CreateIndex
CREATE INDEX "user_session_userId_expiresAt_idx" ON "user_session"("userId", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "operation_companyId_code_key" ON "operation"("companyId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "customer_companyId_name_key" ON "customer"("companyId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "project_companyId_code_key" ON "project"("companyId", "code");

-- CreateIndex
CREATE INDEX "worker_companyId_status_idx" ON "worker"("companyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "worker_companyId_code_key" ON "worker"("companyId", "code");

-- CreateIndex
CREATE INDEX "worker_alias_alias_idx" ON "worker_alias"("alias");

-- CreateIndex
CREATE UNIQUE INDEX "worker_alias_workerId_alias_key" ON "worker_alias"("workerId", "alias");

-- CreateIndex
CREATE INDEX "worker_rate_workerId_effectiveFrom_effectiveTo_idx" ON "worker_rate"("workerId", "effectiveFrom", "effectiveTo");

-- CreateIndex
CREATE INDEX "worker_rate_companyId_active_idx" ON "worker_rate"("companyId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "contractor_companyId_name_key" ON "contractor"("companyId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "crew_companyId_code_key" ON "crew"("companyId", "code");

-- CreateIndex
CREATE INDEX "crew_membership_crewId_from_to_idx" ON "crew_membership"("crewId", "from", "to");

-- CreateIndex
CREATE INDEX "crew_membership_workerId_idx" ON "crew_membership"("workerId");

-- CreateIndex
CREATE UNIQUE INDEX "equipment_companyId_code_key" ON "equipment"("companyId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "vendor_companyId_name_key" ON "vendor"("companyId", "name");

-- CreateIndex
CREATE INDEX "payroll_week_companyId_startDate_idx" ON "payroll_week"("companyId", "startDate");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_week_companyId_year_weekNumber_key" ON "payroll_week"("companyId", "year", "weekNumber");

-- CreateIndex
CREATE INDEX "work_entry_companyId_payrollWeekId_workerId_idx" ON "work_entry"("companyId", "payrollWeekId", "workerId");

-- CreateIndex
CREATE INDEX "work_entry_workerId_workDate_idx" ON "work_entry"("workerId", "workDate");

-- CreateIndex
CREATE UNIQUE INDEX "work_entry_companyId_workerId_workDate_key" ON "work_entry"("companyId", "workerId", "workDate");

-- CreateIndex
CREATE UNIQUE INDEX "worker_payroll_paymentId_key" ON "worker_payroll"("paymentId");

-- CreateIndex
CREATE INDEX "worker_payroll_companyId_payrollWeekId_status_idx" ON "worker_payroll"("companyId", "payrollWeekId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "worker_payroll_companyId_payrollWeekId_workerId_key" ON "worker_payroll"("companyId", "payrollWeekId", "workerId");

-- CreateIndex
CREATE INDEX "payroll_line_workerPayrollId_idx" ON "payroll_line"("workerPayrollId");

-- CreateIndex
CREATE INDEX "addition_companyId_workerPayrollId_idx" ON "addition"("companyId", "workerPayrollId");

-- CreateIndex
CREATE UNIQUE INDEX "deduction_advanceRecoveryId_key" ON "deduction"("advanceRecoveryId");

-- CreateIndex
CREATE UNIQUE INDEX "deduction_debtTransactionId_key" ON "deduction"("debtTransactionId");

-- CreateIndex
CREATE INDEX "deduction_companyId_workerPayrollId_idx" ON "deduction"("companyId", "workerPayrollId");

-- CreateIndex
CREATE UNIQUE INDEX "contractor_settlement_paymentId_key" ON "contractor_settlement"("paymentId");

-- CreateIndex
CREATE INDEX "contractor_settlement_companyId_payrollWeekId_status_idx" ON "contractor_settlement"("companyId", "payrollWeekId", "status");

-- CreateIndex
CREATE INDEX "settlement_line_contractorSettlementId_idx" ON "settlement_line"("contractorSettlementId");

-- CreateIndex
CREATE INDEX "advance_companyId_status_idx" ON "advance"("companyId", "status");

-- CreateIndex
CREATE INDEX "advance_workerId_status_idx" ON "advance"("workerId", "status");

-- CreateIndex
CREATE INDEX "advance_recovery_advanceId_idx" ON "advance_recovery"("advanceId");

-- CreateIndex
CREATE INDEX "advance_pause_advanceId_idx" ON "advance_pause"("advanceId");

-- CreateIndex
CREATE INDEX "debt_companyId_status_idx" ON "debt"("companyId", "status");

-- CreateIndex
CREATE INDEX "debt_transaction_debtId_transactionDate_idx" ON "debt_transaction"("debtId", "transactionDate");

-- CreateIndex
CREATE INDEX "payment_companyId_status_paymentDate_idx" ON "payment"("companyId", "status", "paymentDate");

-- CreateIndex
CREATE UNIQUE INDEX "payment_companyId_paymentNumber_key" ON "payment"("companyId", "paymentNumber");

-- CreateIndex
CREATE INDEX "payment_proof_paymentId_idx" ON "payment_proof"("paymentId");

-- CreateIndex
CREATE INDEX "receipt_paymentId_idx" ON "receipt"("paymentId");

-- CreateIndex
CREATE UNIQUE INDEX "receipt_companyId_receiptNumber_key" ON "receipt"("companyId", "receiptNumber");

-- CreateIndex
CREATE INDEX "payment_adjustment_companyId_originalPaymentId_idx" ON "payment_adjustment"("companyId", "originalPaymentId");

-- CreateIndex
CREATE UNIQUE INDEX "import_batch_companyId_fileHash_targetEntity_key" ON "import_batch"("companyId", "fileHash", "targetEntity");

-- CreateIndex
CREATE INDEX "import_row_importBatchId_status_idx" ON "import_row"("importBatchId", "status");

-- CreateIndex
CREATE INDEX "import_row_naturalKey_idx" ON "import_row"("naturalKey");

-- CreateIndex
CREATE INDEX "exception_companyId_status_level_idx" ON "exception"("companyId", "status", "level");

-- CreateIndex
CREATE INDEX "exception_companyId_payrollWeekId_idx" ON "exception"("companyId", "payrollWeekId");

-- CreateIndex
CREATE INDEX "variance_companyId_status_idx" ON "variance"("companyId", "status");

-- CreateIndex
CREATE INDEX "audit_log_companyId_entityType_entityId_createdAt_idx" ON "audit_log"("companyId", "entityType", "entityId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_log_companyId_payrollWeekId_createdAt_idx" ON "audit_log"("companyId", "payrollWeekId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_log_userId_createdAt_idx" ON "audit_log"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "company_setting_companyId_key_key" ON "company_setting"("companyId", "key");

-- AddForeignKey
ALTER TABLE "role_permission" ADD CONSTRAINT "role_permission_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permission" ADD CONSTRAINT "role_permission_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "permission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_company_role" ADD CONSTRAINT "user_company_role_userId_fkey" FOREIGN KEY ("userId") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_company_role" ADD CONSTRAINT "user_company_role_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_company_role" ADD CONSTRAINT "user_company_role_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_session" ADD CONSTRAINT "user_session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operation" ADD CONSTRAINT "operation_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer" ADD CONSTRAINT "customer_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project" ADD CONSTRAINT "project_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project" ADD CONSTRAINT "project_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project" ADD CONSTRAINT "project_operationId_fkey" FOREIGN KEY ("operationId") REFERENCES "operation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "worker" ADD CONSTRAINT "worker_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "worker" ADD CONSTRAINT "worker_contractorId_fkey" FOREIGN KEY ("contractorId") REFERENCES "contractor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "worker_alias" ADD CONSTRAINT "worker_alias_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "worker"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "worker_rate" ADD CONSTRAINT "worker_rate_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "worker"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "worker_rate" ADD CONSTRAINT "worker_rate_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "worker_rate" ADD CONSTRAINT "worker_rate_operationId_fkey" FOREIGN KEY ("operationId") REFERENCES "operation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contractor" ADD CONSTRAINT "contractor_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crew" ADD CONSTRAINT "crew_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crew" ADD CONSTRAINT "crew_operationId_fkey" FOREIGN KEY ("operationId") REFERENCES "operation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crew" ADD CONSTRAINT "crew_contractorId_fkey" FOREIGN KEY ("contractorId") REFERENCES "contractor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crew" ADD CONSTRAINT "crew_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crew_membership" ADD CONSTRAINT "crew_membership_crewId_fkey" FOREIGN KEY ("crewId") REFERENCES "crew"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crew_membership" ADD CONSTRAINT "crew_membership_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "worker"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipment" ADD CONSTRAINT "equipment_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipment" ADD CONSTRAINT "equipment_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor" ADD CONSTRAINT "vendor_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_week" ADD CONSTRAINT "payroll_week_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_entry" ADD CONSTRAINT "work_entry_payrollWeekId_fkey" FOREIGN KEY ("payrollWeekId") REFERENCES "payroll_week"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_entry" ADD CONSTRAINT "work_entry_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "worker"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_entry" ADD CONSTRAINT "work_entry_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_entry" ADD CONSTRAINT "work_entry_crewId_fkey" FOREIGN KEY ("crewId") REFERENCES "crew"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_entry" ADD CONSTRAINT "work_entry_operationId_fkey" FOREIGN KEY ("operationId") REFERENCES "operation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "worker_payroll" ADD CONSTRAINT "worker_payroll_payrollWeekId_fkey" FOREIGN KEY ("payrollWeekId") REFERENCES "payroll_week"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "worker_payroll" ADD CONSTRAINT "worker_payroll_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "worker"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "worker_payroll" ADD CONSTRAINT "worker_payroll_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_line" ADD CONSTRAINT "payroll_line_workerPayrollId_fkey" FOREIGN KEY ("workerPayrollId") REFERENCES "worker_payroll"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_line" ADD CONSTRAINT "payroll_line_workEntryId_fkey" FOREIGN KEY ("workEntryId") REFERENCES "work_entry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_line" ADD CONSTRAINT "payroll_line_rateSourceId_fkey" FOREIGN KEY ("rateSourceId") REFERENCES "worker_rate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_line" ADD CONSTRAINT "payroll_line_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_line" ADD CONSTRAINT "payroll_line_crewId_fkey" FOREIGN KEY ("crewId") REFERENCES "crew"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "addition" ADD CONSTRAINT "addition_workerPayrollId_fkey" FOREIGN KEY ("workerPayrollId") REFERENCES "worker_payroll"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "addition" ADD CONSTRAINT "addition_contractorSettlementId_fkey" FOREIGN KEY ("contractorSettlementId") REFERENCES "contractor_settlement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deduction" ADD CONSTRAINT "deduction_workerPayrollId_fkey" FOREIGN KEY ("workerPayrollId") REFERENCES "worker_payroll"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deduction" ADD CONSTRAINT "deduction_contractorSettlementId_fkey" FOREIGN KEY ("contractorSettlementId") REFERENCES "contractor_settlement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deduction" ADD CONSTRAINT "deduction_advanceRecoveryId_fkey" FOREIGN KEY ("advanceRecoveryId") REFERENCES "advance_recovery"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deduction" ADD CONSTRAINT "deduction_debtTransactionId_fkey" FOREIGN KEY ("debtTransactionId") REFERENCES "debt_transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contractor_settlement" ADD CONSTRAINT "contractor_settlement_payrollWeekId_fkey" FOREIGN KEY ("payrollWeekId") REFERENCES "payroll_week"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contractor_settlement" ADD CONSTRAINT "contractor_settlement_contractorId_fkey" FOREIGN KEY ("contractorId") REFERENCES "contractor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contractor_settlement" ADD CONSTRAINT "contractor_settlement_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlement_line" ADD CONSTRAINT "settlement_line_contractorSettlementId_fkey" FOREIGN KEY ("contractorSettlementId") REFERENCES "contractor_settlement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "advance" ADD CONSTRAINT "advance_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "worker"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "advance" ADD CONSTRAINT "advance_contractorId_fkey" FOREIGN KEY ("contractorId") REFERENCES "contractor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "advance_recovery" ADD CONSTRAINT "advance_recovery_advanceId_fkey" FOREIGN KEY ("advanceId") REFERENCES "advance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "advance_pause" ADD CONSTRAINT "advance_pause_advanceId_fkey" FOREIGN KEY ("advanceId") REFERENCES "advance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "debt" ADD CONSTRAINT "debt_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "worker"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "debt" ADD CONSTRAINT "debt_contractorId_fkey" FOREIGN KEY ("contractorId") REFERENCES "contractor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "debt" ADD CONSTRAINT "debt_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "debt_transaction" ADD CONSTRAINT "debt_transaction_debtId_fkey" FOREIGN KEY ("debtId") REFERENCES "debt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment" ADD CONSTRAINT "payment_payrollWeekId_fkey" FOREIGN KEY ("payrollWeekId") REFERENCES "payroll_week"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment" ADD CONSTRAINT "payment_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "worker"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment" ADD CONSTRAINT "payment_contractorId_fkey" FOREIGN KEY ("contractorId") REFERENCES "contractor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment" ADD CONSTRAINT "payment_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_proof" ADD CONSTRAINT "payment_proof_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipt" ADD CONSTRAINT "receipt_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_adjustment" ADD CONSTRAINT "payment_adjustment_originalPaymentId_fkey" FOREIGN KEY ("originalPaymentId") REFERENCES "payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_row" ADD CONSTRAINT "import_row_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "import_batch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_userId_fkey" FOREIGN KEY ("userId") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_setting" ADD CONSTRAINT "company_setting_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
