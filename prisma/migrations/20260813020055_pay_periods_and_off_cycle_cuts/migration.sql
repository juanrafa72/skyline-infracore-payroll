-- CreateEnum
CREATE TYPE "PayPeriodType" AS ENUM ('DAILY', 'WEEKLY', 'BIWEEKLY', 'SEMI_MONTHLY', 'MONTHLY');

-- CreateEnum
CREATE TYPE "SettlementType" AS ENUM ('REGULAR', 'FINAL_SETTLEMENT', 'PARTIAL_CUT');

-- AlterTable
ALTER TABLE "company" ADD COLUMN     "biweeklyAnchor" DATE,
ADD COLUMN     "defaultPayPeriod" "PayPeriodType" NOT NULL DEFAULT 'WEEKLY';

-- AlterTable
ALTER TABLE "payroll_week" ADD COLUMN     "isOffCycle" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "offCycleReason" TEXT,
ADD COLUMN     "periodType" "PayPeriodType" NOT NULL DEFAULT 'WEEKLY',
ADD COLUMN     "settlementType" "SettlementType" NOT NULL DEFAULT 'REGULAR';

-- AlterTable
ALTER TABLE "worker" ADD COLUMN     "payPeriod" "PayPeriodType";
