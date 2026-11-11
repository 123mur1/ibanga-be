<p align="center">
  <a href="http://nestjs.com/" target="blank"><img src="https://nestjs.com/img/logo-small.svg" width="120" alt="Nest Logo" /></a>
</p>

[circleci-image]: https://img.shields.io/circleci/build/github/nestjs/nest/master?token=abc123def456
[circleci-url]: https://circleci.com/gh/nestjs/nest

  <p align="center">A progressive <a href="http://nodejs.org" target="_blank">Node.js</a> framework for building efficient and scalable server-side applications.</p>
    <p align="center">
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/v/@nestjs/core.svg" alt="NPM Version" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/l/@nestjs/core.svg" alt="Package License" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/dm/@nestjs/common.svg" alt="NPM Downloads" /></a>
<a href="https://circleci.com/gh/nestjs/nest" target="_blank"><img src="https://img.shields.io/circleci/build/github/nestjs/nest/master" alt="CircleCI" /></a>
<a href="https://discord.gg/G7Qnnhy" target="_blank"><img src="https://img.shields.io/badge/discord-online-brightgreen.svg" alt="Discord"/></a>
<a href="https://opencollective.com/nest#backer" target="_blank"><img src="https://opencollective.com/nest/backers/badge.svg" alt="Backers on Open Collective" /></a>
<a href="https://opencollective.com/nest#sponsor" target="_blank"><img src="https://opencollective.com/nest/sponsors/badge.svg" alt="Sponsors on Open Collective" /></a>
  <a href="https://paypal.me/kamilmysliwiec" target="_blank"><img src="https://img.shields.io/badge/Donate-PayPal-ff3f59.svg" alt="Donate us"/></a>
    <a href="https://opencollective.com/nest#sponsor"  target="_blank"><img src="https://img.shields.io/badge/Support%20us-Open%20Collective-41B883.svg" alt="Support us"></a>
  <a href="https://twitter.com/nestframework" target="_blank"><img src="https://img.shields.io/twitter/follow/nestframework.svg?style=social&label=Follow" alt="Follow us on Twitter"></a>
</p>
  <!--[![Backers on Open Collective](https://opencollective.com/nest/backers/badge.svg)](https://opencollective.com/nest#backer)
  [![Sponsors on Open Collective](https://opencollective.com/nest/sponsors/badge.svg)](https://opencollective.com/nest#sponsor)-->

## Description

[Nest](https://github.com/nestjs/nest) framework TypeScript starter repository.

## Project setup

```bash
$ npm install
```

## Deployment URLs

For the Vercel backend project, set **Root Directory** to `backend`. The
deployed frontend uses `https://ibanga-be.vercel.app` as its production API by
default. Set `NEXT_PUBLIC_API_URL` in the frontend's Vercel project to override
it. In the backend's Vercel project, set `DATABASE_URL`, `JWT_SECRET`, and
`FRONTEND_URL` to `https://ibanga-fe-611u.vercel.app`. Add any additional
allowed frontend origins as a comma-separated `CORS_ORIGINS` value, then
redeploy both projects after changing their environment variables.

The backend build allows the TypeScript compiler up to 4 GB and skips
declaration, source-map, and incremental output. If a deployment reports an
out-of-memory error, check whether it occurred during the build or while a
function handled a request; those phases need different fixes.

## Password reset email

Password-reset links are sent through Gmail SMTP. Configure `SMTP_HOST`,
`SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`, and
`SMTP_FROM_NAME` in the backend environment. For Gmail, use an App Password
with 2-Step Verification enabled, not your regular account password. The mailer
removes spaces from a pasted Gmail App Password automatically. Set
`FRONTEND_URL` to the public frontend origin so links return to the
reset-password form. Users request a link from `/forgot-password`; the emailed
link opens `/reset-password` and submits the new password to the reset API.
Reset links expire after one hour; the raw reset token is never returned by the
API. Keep `SMTP_PASS` private and rotate it immediately if it is exposed.

If SMTP reports `self-signed certificate in certificate chain`, the network is
likely intercepting TLS. Export that network or antivirus root certificate as
PEM and set `SMTP_TLS_CA_PATH` to its file path. The mailer keeps certificate
verification enabled; do not disable TLS verification to work around this error.

## Simulated payments

Payments are simulated in every environment. No payment provider is contacted,
no real money is charged or transferred, and balances have no monetary value.
Wallet deposits and balances are not required to pay for a booking. A simulated
booking payment is recorded as funded so the trip workflow can be exercised.
Do not use these records as escrow or for real transactions.

After configuring `DATABASE_URL`, apply the Prisma schema and regenerate the
client:

```bash
npm run prisma:push
npm run prisma:generate
```

The admin account-status feature requires the `User.active` column. The
existing database is not managed by Prisma Migrate; apply
`prisma/add-user-active-column.sql` to the intended database, or run
`npm run prisma:push` only after verifying the configured `DATABASE_URL`
points to the intended environment.

Operations record filtering requires the `parentId`, `status`, and `truckId`
columns and their indexes. For a database that already has the original
`OperationsRecord` table, apply `prisma/add-operations-record-metadata.sql`
to the intended environment. This update is additive and preserves existing
records.

Admin user management supports activating and deactivating non-admin accounts.
Deactivated users cannot log in, and their existing API tokens are rejected.
Users with booking or dispute history cannot be permanently deleted; deactivate
them to preserve marketplace records. Deleting an account with no booking or
dispute history also deletes its wallet transaction history.
The admin wallet dashboard reads every account balance and its transaction
history from the admin-only `GET /wallet/admin/accounts` endpoint. Its
commission balance, lifetime earned total, and six-month release history come
from `GET /wallet/admin/commission`, backed by wallet and released booking
payment records.

Live trip tracking stores only the truck's latest GPS position on its booking.
The owner must explicitly start sharing from the active trip page; location
updates stop when sharing is stopped or the trip leaves `IN_PROGRESS`. Apply
the schema update with `npm run prisma:push` before deploying the tracking API.

Trucks are priced per kilometre. Each listing has a category, a whole-number
`pricePerKmRwf`, the cities the owner serves, and the cargo it carries. A
booking records its pickup and final destination as country → city → area
(`pickupCountry/City/Area`, `destinationCountry/City/Area`); both cities must be
the truck's home city or one it serves. The price covers the whole drive, worked
out on the server (`GET /trucks/:id/quote` shows it before booking): truck
location → pickup → destination → back to the truck location, each leg stored
in `routeLegs`, `agreedPriceRwf = total km × pricePerKmRwf`. A truck in Kigali
fetching cargo in Mombasa for Kigali is priced Kigali → Mombasa → Kigali.

### Booking journey

1. **Request.** The importer sends a request; nothing is paid. It stays
   `PENDING` until the owner accepts or declines (requests never expire).
2. **Deposit.** On acceptance (`acceptedAt`) the importer has
   `BOOKING_PAYMENT_WINDOW_MINUTES` (default 60) to pay **50%** (`POST
   /wallet/bookings/:id/pay`). Otherwise a background sweep cancels the
   booking and its days become bookable again.
3. **Documents.** After the deposit and before the trip starts, the importer
   uploads cargo and tax documents (`POST /bookings/:id/documents`, PDF or
   image up to 5 MB; `GET .../documents/:documentId/file` serves them to the
   importer, owner, the truck's driver and admins). The trip cannot start
   without one `CARGO` and one `TAX` document.
4. **Trip.** The owner or the truck's driver starts it and marks it delivered.
5. **Balance.** The importer confirms receipt and pays the other **50%** in one
   step (`POST /bookings/:id/confirm-receipt`); the full held amount is then
   released to the owner, less commission, and the booking completes.

While only the deposit is paid, `BookingPayment.amountRwf` is the deposit
(`depositRwf`); paying the balance raises it to the price, so dispute and
cancellation settlements always split the money actually held.

### Trip updates and delays

The truck's driver (a `drivers` operations record whose `userId` is the driver
account and `assignedTruckId` the truck) or its owner sends `POST
/bookings/:id/trip-updates` with a message, emailed to the importer and owner.
With `delayDays` the trip's last day moves later (`TripDelay`). Every later
`PENDING`/`ACCEPTED` booking of the truck that the new end overlaps gets a
`DelayImpact`, and its importer is emailed to choose (`POST
/bookings/:id/delay-impacts/:impactId`): **SHIFT** moves their dates just past
the delayed trip, and any following booking that would then overlap shifts
too (those importers are emailed and may still cancel); **REFUND** cancels the
booking and returns everything paid to the importer's wallet. Drivers can read
their truck's bookings, start and deliver trips and share GPS.

### Deposit, locations, documents and delays update

```bash
npx prisma db execute --file prisma/add-deposit-locations-documents-delays.sql --schema prisma/schema.prisma
npm run prisma:generate
```

Dispute resolution alone does not release the simulated funds; the importer
must still confirm receipt.

Every verified truck is listed whatever its bookings, and bookings never change
the truck's own status. A truck is only taken on the days a live booking covers (pickup through expected delivery); truck
responses include these as `bookedRanges`, and a booking whose dates overlap
another is refused. Distances come from the Google Maps Routes API when
`GOOGLE_MAPS_API_KEY` is set (enable "Routes API" on the key); otherwise they
are estimated from the listed places' coordinates times a road factor of 1.3.

Anyone can read reviews. Signed-in users post with `POST /trucks/:id/reviews`
(one per person and truck, never on their own truck); visitors post with
`POST /trucks/:id/reviews/guest`, giving a name, limited to 5 per hour per
address.

### Per-kilometre pricing update

For an existing database, apply the additive SQL files, then regenerate the
client (stop the running backend first on Windows, which locks the engine):

```bash
npx prisma db execute --file prisma/add-booking-cancelled-status.sql --schema prisma/schema.prisma
npx prisma db execute --file prisma/add-per-km-pricing.sql --schema prisma/schema.prisma
npm run prisma:generate
```

### Seed data

`npm run prisma:seed` creates one truck owner (`SEED_OWNER_EMAIL`, default
`fleet@ibanga.rw`) with twelve verified vehicles covering every category, the
main corridors and all cargo types, each with approved registration, inspection
and insurance documents. Set `SEED_OWNER_PASSWORD`, or the seed generates one
and prints it once. It can be re-run: the owner is matched by email and each
vehicle by plate, and nothing else is changed or deleted.

## Frontend operations data API

The frontend always uses this API; there is no demonstration mode. Copy the
frontend `.env.example` to `.env.local` and set `NEXT_PUBLIC_API_URL` to the
backend origin. The frontend reuses its normal JWT login and sends the token
with requests.

The authenticated `/operations/:domain` API provides persistent records.
Supported domains are
`cargo-requests`, `quotations`, `drivers`, `driver-assignments`,
`truck-profiles`, `shipments`, `settlements`, `payouts`, `documents`,
`verification-requests`, `cancellations`, `dispute-cases`, `incidents`,
`insurance-policies`, `insurance-claims`, `support-tickets`, `notifications`,
`notification-preferences`, `announcements`, `audit-logs`, `reconciliation`,
`admin-profiles`, `settings`, `reviews`, and `refunds`.

Cargo requests, quotations, and driver registration are exposed as:

| Method  | Endpoint                                                   | Purpose                                                                                                                                                    |
| ------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET`   | `/operations/cargo-requests?page=1&pageSize=25&search=...` | Importer's requests; truck owners see open opportunities                                                                                                   |
| `POST`  | `/operations/cargo-requests`                               | Create a request with `{ "data": { ... }, "draft": true }`; omit `draft` to publish                                                                        |
| `GET`   | `/operations/cargo-requests/:id`                           | Read a request the signed-in user may access                                                                                                               |
| `PATCH` | `/operations/cargo-requests/:id`                           | Update an owned draft or open request with `{ "data": { ... } }`                                                                                           |
| `POST`  | `/operations/cargo-requests/:id/publish`                   | Validate and publish a saved draft                                                                                                                         |
| `POST`  | `/operations/cargo-requests/:id/cancel`                    | Cancel with `{ "reason": "..." }` and close submitted quotations                                                                                           |
| `GET`   | `/operations/cargo-requests/:id/quotations`                | List quotations visible to the importer or truck owner                                                                                                     |
| `GET`   | `/operations/quotations`                                   | Paginated quotes visible to the signed-in user                                                                                                             |
| `POST`  | `/operations/quotations`                                   | Submit `{ "data": { cargoRequestId, truckId, amountRwf, estimatedPickupDate, estimatedDeliveryDate, notes } }`                                             |
| `POST`  | `/operations/quotations/:id/withdraw`                      | Withdraw an owner's submitted quotation                                                                                                                    |
| `POST`  | `/operations/quotations/:id/accept`                        | Atomically accept a quote, create the accepted booking and scheduled shipment, and reserve its truck                                                       |
| `POST`  | `/operations/drivers`                                      | Create a driver sign-in account and linked driver record atomically; truck owners can register for their own trucks and admins must select an active owner |

Driver list, read, and edit operations use `/operations/drivers` and
`/operations/drivers/:id`. Driver passwords are hashed and never stored in the
operations record.

The API derives the actor from the JWT rather than trusting frontend-supplied
owner IDs. Quote acceptance creates the booking on the server; payment remains
a separate step. Other domains have authenticated record CRUD at
`/operations/:domain`, but their workflow-specific state transitions and
provider integrations are not implemented yet. Administrative records are
admin-only, and deletion is restricted to documents and announcements.

Before running `npm run prisma:push`, confirm `DATABASE_URL` points to a
development or staging database. Do not point this operation at production
without an approved migration and backup plan.

## Compile and run the project

```bash
# development
$ npm run start

# watch mode
$ npm run start:dev

# production mode
$ npm run start:prod
```

## Run tests

```bash
# unit tests
$ npm run test

# e2e tests
$ npm run test:e2e

# test coverage
$ npm run test:cov
```

## Deployment

When you're ready to deploy your NestJS application to production, there are some key steps you can take to ensure it runs as efficiently as possible. Check out the [deployment documentation](https://docs.nestjs.com/deployment) for more information.

If you are looking for a cloud-based platform to deploy your NestJS application, check out [Mau](https://mau.nestjs.com), our official platform for deploying NestJS applications on AWS. Mau makes deployment straightforward and fast, requiring just a few simple steps:

```bash
$ npm install -g @nestjs/mau
$ mau deploy
```

With Mau, you can deploy your application in just a few clicks, allowing you to focus on building features rather than managing infrastructure.

## Resources

Check out a few resources that may come in handy when working with NestJS:

- Visit the [NestJS Documentation](https://docs.nestjs.com) to learn more about the framework.
- For questions and support, please visit our [Discord channel](https://discord.gg/G7Qnnhy).
- To dive deeper and get more hands-on experience, check out our official video [courses](https://courses.nestjs.com/).
- Deploy your application to AWS with the help of [NestJS Mau](https://mau.nestjs.com) in just a few clicks.
- Visualize your application graph and interact with the NestJS application in real-time using [NestJS Devtools](https://devtools.nestjs.com).
- Need help with your project (part-time to full-time)? Check out our official [enterprise support](https://enterprise.nestjs.com).
- To stay in the loop and get updates, follow us on [X](https://x.com/nestframework) and [LinkedIn](https://linkedin.com/company/nestjs).
- Looking for a job, or have a job to offer? Check out our official [Jobs board](https://jobs.nestjs.com).

## Support

Nest is an MIT-licensed open source project. It can grow thanks to the sponsors and support by the amazing backers. If you'd like to join them, please [read more here](https://docs.nestjs.com/support).

## Stay in touch

- Author - [Kamil Myśliwiec](https://twitter.com/kammysliwiec)
- Website - [https://nestjs.com](https://nestjs.com/)
- Twitter - [@nestframework](https://twitter.com/nestframework)

## License

Nest is [MIT licensed](https://github.com/nestjs/nest/blob/master/LICENSE).
