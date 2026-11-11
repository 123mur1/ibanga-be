-- Half-price deposit, full trip locations, cargo/tax documents and trip delays.
-- Additive only: new nullable columns and new tables. Same change as `npm run prisma:push`
-- after the schema update; run one of the two.
--   npx prisma db execute --file prisma/add-deposit-locations-documents-delays.sql --schema prisma/schema.prisma

ALTER TABLE "Booking"
ADD COLUMN IF NOT EXISTS "acceptedAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "truckLocation" TEXT,
ADD COLUMN IF NOT EXISTS "pickupCountry" TEXT,
ADD COLUMN IF NOT EXISTS "pickupCity" TEXT,
ADD COLUMN IF NOT EXISTS "pickupArea" TEXT,
ADD COLUMN IF NOT EXISTS "destinationCountry" TEXT,
ADD COLUMN IF NOT EXISTS "destinationCity" TEXT,
ADD COLUMN IF NOT EXISTS "destinationArea" TEXT,
ADD COLUMN IF NOT EXISTS "routeLegs" JSONB;

ALTER TABLE "BookingPayment"
ADD COLUMN IF NOT EXISTS "depositRwf" INTEGER,
ADD COLUMN IF NOT EXISTS "balanceRwf" INTEGER,
ADD COLUMN IF NOT EXISTS "balancePaidAt" TIMESTAMP(3);

CREATE TABLE IF NOT EXISTS "BookingDocument" (
  "id" TEXT NOT NULL,
  "bookingId" TEXT NOT NULL,
  "uploadedById" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "sizeBytes" INTEGER NOT NULL,
  "dataUrl" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BookingDocument_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "BookingDocument_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "BookingDocument_bookingId_idx" ON "BookingDocument"("bookingId");

CREATE TABLE IF NOT EXISTS "TripDelay" (
  "id" TEXT NOT NULL,
  "bookingId" TEXT NOT NULL,
  "reportedById" TEXT NOT NULL,
  "delayDays" INTEGER NOT NULL,
  "reason" TEXT NOT NULL,
  "previousEndDate" TIMESTAMP(3) NOT NULL,
  "newEndDate" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TripDelay_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TripDelay_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "TripDelay_bookingId_idx" ON "TripDelay"("bookingId");

CREATE TABLE IF NOT EXISTS "DelayImpact" (
  "id" TEXT NOT NULL,
  "delayId" TEXT NOT NULL,
  "bookingId" TEXT NOT NULL,
  "shiftDays" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "decidedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DelayImpact_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DelayImpact_delayId_fkey" FOREIGN KEY ("delayId") REFERENCES "TripDelay"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "DelayImpact_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "DelayImpact_bookingId_status_idx" ON "DelayImpact"("bookingId", "status");
