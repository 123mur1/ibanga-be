-- Store how the importer paid for a booking (method, payer and masked account).
-- Same change as `npm run prisma:push` after the schema update; run one of the two.
CREATE TYPE "PaymentMethod" AS ENUM ('MTN', 'AIRTEL', 'VISA');

ALTER TABLE "BookingPayment"
ADD COLUMN "method" "PaymentMethod",
ADD COLUMN "payerName" TEXT,
ADD COLUMN "accountMask" TEXT;
