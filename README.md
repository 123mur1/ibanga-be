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

The deployed frontend uses `https://ibanga-be-1.onrender.com` as its production
API by default. Set `NEXT_PUBLIC_API_URL` in Vercel to that URL to override it.
In Render, set `FRONTEND_URL` to `https://ibanga-fe-1fkh.vercel.app`; add any
additional allowed frontend origins as a comma-separated `CORS_ORIGINS` value.
Redeploy both services after changing their environment variables.

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

Every new truck listing requires a whole-number RWF price; each booking
snapshots that listing price. Owners cannot change the price per booking or
start a trip before the importer records the simulated booking payment. Dispute
resolution alone does not release the simulated funds or unlock the truck; the
importer must still confirm receipt.

## Frontend operations data API

The operations UI uses browser-backed demonstration services by default. To
use the backend for the first connected workflow, copy the frontend
`.env.example` to `.env.local`, set `NEXT_PUBLIC_DATA_SOURCE=api`,
`NEXT_PUBLIC_OPS_DATA_SOURCE=api`, and set `NEXT_PUBLIC_API_URL` to the backend
origin. Start the backend and frontend locally; the frontend reuses its normal
JWT login and sends the token with requests. In this first integration, cargo
requests and quotations use the API; the other operations service areas remain
demonstration-backed until they are implemented.

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
