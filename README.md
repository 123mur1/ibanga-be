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
with 2-Step Verification enabled, not your regular account password. Set
`FRONTEND_URL` to the public frontend origin so links return to the
reset-password page. Reset links expire after one hour; the raw reset token is
never returned by the API. Keep `SMTP_PASS` private and rotate it immediately
if it is exposed.

If SMTP reports `self-signed certificate in certificate chain`, the network is
likely intercepting TLS. Export that network or antivirus root certificate as
PEM and set `SMTP_TLS_CA_PATH` to its file path. The mailer keeps certificate
verification enabled; do not disable TLS verification to work around this error.

## In-app payments

Local development uses simulated payments when `NODE_ENV` is not `production`
and `FLW_SECRET_KEY` is absent. You can also set `PAYMENTS_MODE=mock` to force
simulation locally. These deposits and withdrawals only change test balances;
no real money is charged or sent. The wallet page labels this mode clearly.

Payments use Flutterwave's Rwanda APIs for RWF deposits by mobile money and
withdrawals to MTN Mobile Money or Rwandan bank accounts. Complete Flutterwave
business verification, enable RWF collections and API transfers, and use a
production-approved merchant account before enabling live payments.

Set `PAYMENTS_MODE=flutterwave` and real Flutterwave credentials in the deployed
backend environment. Production never enables mock mode.

Configure `FLW_SECRET_KEY`, `FLW_WEBHOOK_SECRET`, `FRONTEND_URL`, and
`PAYMENT_COMMISSION_BPS` in the backend environment. The commission defaults to
`600` basis points (6%) and is deducted from the truck owner's agreed price.
Register `POST /payments/webhooks/flutterwave` in the Flutterwave dashboard and
set its webhook secret to the same value as `FLW_WEBHOOK_SECRET`. Do not expose
the secret key in the frontend.

After configuring `DATABASE_URL`, apply the Prisma schema and regenerate the
client:

```bash
npm run prisma:push
npm run prisma:generate
```

Booking funds are held in the platform's Flutterwave merchant balance and
accounted for by the app ledger until importer confirmation. Every new truck
listing requires a whole-number RWF price; each booking snapshots that listing
price. Owners cannot change the price per booking or start a trip before the
importer payment is held. Dispute resolution alone does not release funds or
unlock the truck; the importer must still confirm receipt. This implementation
does not establish regulated escrow or a separately licensed stored-value
wallet; obtain the required local legal and provider approvals before launch.

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
