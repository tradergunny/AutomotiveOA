-- M7.10 step 3 (ADR-007): the internal timeline records a system Update the
-- Shop could not send at all, pointing at its NOT_SENT row.

-- AlterEnum
ALTER TYPE "CaseEventType" ADD VALUE 'LINE_UPDATE_NOT_SENT';
