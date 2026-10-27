ALTER TABLE "OperationsRecord"
  ADD COLUMN IF NOT EXISTS "parentId" TEXT,
  ADD COLUMN IF NOT EXISTS "status" TEXT,
  ADD COLUMN IF NOT EXISTS "truckId" TEXT;

CREATE INDEX IF NOT EXISTS "OperationsRecord_domain_parentId_status_idx"
  ON "OperationsRecord" ("domain", "parentId", "status");

CREATE INDEX IF NOT EXISTS "OperationsRecord_domain_truckId_parentId_idx"
  ON "OperationsRecord" ("domain", "truckId", "parentId");
