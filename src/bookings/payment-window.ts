/**
 * Minutes an importer has, from the owner's acceptance, to pay the deposit (half the price)
 * before the booking is cancelled and its days freed. Requests the owner has not answered never
 * expire.
 */
export function paymentWindowMinutes() {
  const minutes = Number(process.env.BOOKING_PAYMENT_WINDOW_MINUTES);
  return Number.isFinite(minutes) && minutes > 0 ? minutes : 60;
}

/** "1 hour", "90 minutes": how the window reads in messages. */
export function windowLabel(minutes = paymentWindowMinutes()) {
  return minutes % 60 === 0
    ? `${minutes / 60} hour${minutes === 60 ? '' : 's'}`
    : `${minutes} minutes`;
}
