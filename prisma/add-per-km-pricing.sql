-- Per-kilometre pricing and date-based availability. Additive: no existing data changes.
ALTER TABLE "Truck"
  ADD COLUMN IF NOT EXISTS "category" TEXT,
  ADD COLUMN IF NOT EXISTS "pricePerKmRwf" INTEGER,
  ADD COLUMN IF NOT EXISTS "destinations" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS "acceptedCargo" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

ALTER TABLE "Booking"
  ADD COLUMN IF NOT EXISTS "distanceKm" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "pricePerKmRwf" INTEGER;

-- Availability checks look up a truck's bookings by date.
CREATE INDEX IF NOT EXISTS "Booking_truckId_pickupDate_idx" ON "Booking" ("truckId", "pickupDate");
