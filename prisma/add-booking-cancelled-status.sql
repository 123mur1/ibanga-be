-- Adds the CANCELLED booking status: an importer cancelled before paying, or the booking
-- was not paid within the payment window and expired. Additive; existing rows are unchanged.
ALTER TYPE "BookingStatus" ADD VALUE IF NOT EXISTS 'CANCELLED';
