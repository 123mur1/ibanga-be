import {
  BadGatewayException,
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  BookingPaymentStatus,
  BookingStatus,
  WalletTransactionDirection,
  WalletTransactionStatus,
  WalletTransactionType,
} from '@prisma/client';
import { timingSafeEqual, randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { CreateDepositDto, CreateWithdrawalDto, WalletActor } from './wallet.dto';

type FlwEnvelope<T> = {
  status: string;
  message?: string;
  data: T;
  meta?: { authorization?: { redirect?: string } };
};

type ChargeData = { id: number | string; status?: string };
type VerifiedCharge = {
  id: number | string;
  tx_ref: string;
  status: string;
  amount: number;
  currency: string;
};
type TransferData = {
  id: number | string;
  status: string;
  reference: string;
};
type WebhookPayload = {
  event?: string;
  data?: {
    id?: number | string;
    tx_ref?: string;
    reference?: string;
  };
};

@Injectable()
export class PaymentsService {
  constructor(private prisma: PrismaService) {}

  async getWallet(userId: string) {
    const wallet = await this.getOrCreateWallet(userId);
    const transactions = await this.prisma.walletTransaction.findMany({
      where: { walletId: wallet.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return {
      balanceRwf: wallet.balanceRwf,
      currency: 'RWF',
      mode: this.isMockMode() ? 'mock' : 'flutterwave',
      transactions,
    };
  }

  async getRwandaBanks() {
    if (this.isMockMode()) {
      return [{ id: 'MOCK_BANK', code: 'MOCK_BANK', name: 'Local test bank' }];
    }
    const response = await this.flwRequest<unknown[]>('/banks/RW');
    return response.data;
  }

  async getRwandaBankBranches(bankCode: string) {
    if (this.isMockMode()) {
      return [{ id: 'MOCK_BRANCH', code: 'MOCK_BRANCH', name: 'Local test branch' }];
    }
    const response = await this.flwRequest<unknown[]>(
      `/banks/${encodeURIComponent(bankCode)}/branches`,
    );
    return response.data;
  }

  async createDeposit(userId: string, dto: CreateDepositDto) {
    const [wallet, user] = await Promise.all([
      this.getOrCreateWallet(userId),
      this.prisma.user.findUnique({
        where: { id: userId },
        select: { name: true, email: true },
      }),
    ]);
    if (!user) throw new NotFoundException('User not found.');
    const phoneNumber = this.normalizeRwandaPhone(dto.phoneNumber);

    const reference = `ibanga-deposit-${randomUUID()}`;
    await this.prisma.walletTransaction.create({
      data: {
        walletId: wallet.id,
        type: WalletTransactionType.DEPOSIT,
        status: WalletTransactionStatus.PENDING,
        direction: WalletTransactionDirection.CREDIT,
        amountRwf: dto.amountRwf,
        reference,
        description: 'Wallet deposit by MTN Mobile Money',
      },
    });

    if (this.isMockMode()) {
      await this.prisma.$queryRaw`
        WITH credited AS (
          UPDATE "WalletTransaction"
          SET "status" = CAST(${WalletTransactionStatus.SUCCEEDED} AS "WalletTransactionStatus"),
              "description" = 'Local test deposit (simulated)', "updatedAt" = NOW()
          WHERE "reference" = ${reference}
            AND "status" = CAST(${WalletTransactionStatus.PENDING} AS "WalletTransactionStatus")
          RETURNING "walletId", "amountRwf"
        )
        UPDATE "Wallet" wallet
        SET "balanceRwf" = wallet."balanceRwf" + credited."amountRwf",
            "updatedAt" = NOW()
        FROM credited
        WHERE wallet."id" = credited."walletId"
      `;
      return { simulated: true, message: 'Local test deposit added to wallet.' };
    }

    const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:3000';
    const response = await this.flwRequest<ChargeData>(
      '/charges?type=mobile_money_rwanda',
      {
        method: 'POST',
        body: JSON.stringify({
          phone_number: phoneNumber,
          amount: dto.amountRwf,
          currency: 'RWF',
          email: user.email,
          fullname: user.name,
          tx_ref: reference,
          redirect_url: `${frontendUrl}/dashboard/wallet?deposit=${encodeURIComponent(reference)}`,
        }),
      },
    );
    const paymentUrl = response.meta?.authorization?.redirect;
    if (!paymentUrl) {
      throw new BadGatewayException('The provider did not return a payment link.');
    }
    return { reference, paymentUrl };
  }

  async createWithdrawal(userId: string, dto: CreateWithdrawalDto) {
    const wallet = await this.getOrCreateWallet(userId);
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });
    if (!user) throw new NotFoundException('User not found.');

    const transferDetails = this.toTransferDetails(dto);
    const reference = `ibanga-withdrawal-${randomUUID()}`;
    const transactionId = randomUUID();
    const reserved = await this.prisma.$queryRaw<{ id: string }[]>`
      WITH reserved_wallet AS (
        UPDATE "Wallet"
        SET "balanceRwf" = "balanceRwf" - ${dto.amountRwf}, "updatedAt" = NOW()
        WHERE "id" = ${wallet.id} AND "balanceRwf" >= ${dto.amountRwf}
        RETURNING "id"
      )
      INSERT INTO "WalletTransaction" (
        "id", "walletId", "type", "status", "direction", "amountRwf",
        "reference", "description", "createdAt", "updatedAt"
      )
      SELECT
        ${transactionId}, "id",
        CAST(${WalletTransactionType.WITHDRAWAL} AS "WalletTransactionType"),
        CAST(${WalletTransactionStatus.PENDING} AS "WalletTransactionStatus"),
        CAST(${WalletTransactionDirection.DEBIT} AS "WalletTransactionDirection"),
        ${dto.amountRwf}, ${reference}, 'Wallet withdrawal', NOW(), NOW()
      FROM reserved_wallet
      RETURNING "id"
    `;
    if (!reserved.length) {
      throw new BadRequestException('Wallet balance is too low for this withdrawal.');
    }

    if (this.isMockMode()) {
      await this.prisma.walletTransaction.update({
        where: { reference },
        data: {
          status: WalletTransactionStatus.SUCCEEDED,
          providerReference: `MOCK-${reference}`,
          description: 'Local test withdrawal (simulated; no money sent)',
        },
      });
      return this.prisma.walletTransaction.findUniqueOrThrow({ where: { reference } });
    }

    const response = await this.flwRequest<TransferData>('/transfers', {
      method: 'POST',
      body: JSON.stringify({
        ...transferDetails,
        amount: dto.amountRwf,
        currency: 'RWF',
        debit_currency: 'RWF',
        reference,
        narration: 'iBanga wallet withdrawal',
      }),
    });
    if (response.data.status === 'FAILED') {
      await this.failWithdrawal(reference);
      throw new BadGatewayException('The payment provider rejected the withdrawal.');
    }
    await this.prisma.walletTransaction.update({
      where: { reference },
      data: {
        providerReference: String(response.data.id),
        ...(response.data.status === 'SUCCESSFUL'
          ? { status: WalletTransactionStatus.SUCCEEDED }
          : {}),
      },
    });
    return this.prisma.walletTransaction.findUniqueOrThrow({
      where: { reference },
    });
  }

  async payBooking(actor: WalletActor, bookingId: string) {
    if (actor.role !== 'IMPORTER') {
      throw new ForbiddenException('Only importers can pay for bookings.');
    }
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      include: { truck: { select: { ownerId: true } }, payment: true },
    });
    if (!booking) throw new NotFoundException('Booking not found.');
    if (booking.importerId !== actor.id) {
      throw new ForbiddenException('You cannot pay for this booking.');
    }
    if (booking.status !== BookingStatus.ACCEPTED || !booking.agreedPriceRwf) {
      throw new BadRequestException(
        'The owner must accept the booking and set a RWF price before payment.',
      );
    }
    if (booking.payment) {
      throw new BadRequestException('This booking already has a payment record.');
    }

    const wallet = await this.getOrCreateWallet(actor.id);
    const amountRwf = booking.agreedPriceRwf;
    const commissionBps = this.getCommissionBps();
    const commissionRwf = Math.round((amountRwf * commissionBps) / 10000);
    const ownerAmountRwf = amountRwf - commissionRwf;
    const paymentId = randomUUID();
    const transactionId = randomUUID();
    const reference = `ibanga-booking-${bookingId}`;

    try {
      const rows = await this.prisma.$queryRaw<{ id: string }[]>`
        WITH debited_wallet AS (
          UPDATE "Wallet"
          SET "balanceRwf" = "balanceRwf" - ${amountRwf}, "updatedAt" = NOW()
          WHERE "id" = ${wallet.id}
            AND "balanceRwf" >= ${amountRwf}
            AND EXISTS (
              SELECT 1 FROM "Booking"
              WHERE "id" = ${bookingId}
                AND "importerId" = ${actor.id}
                AND "status" = CAST(${BookingStatus.ACCEPTED} AS "BookingStatus")
            )
          RETURNING "id"
        ), created_payment AS (
          INSERT INTO "BookingPayment" (
            "id", "bookingId", "status", "amountRwf", "commissionRwf",
            "ownerAmountRwf", "fundedAt", "createdAt", "updatedAt"
          )
          SELECT
            ${paymentId}, ${bookingId},
            CAST(${BookingPaymentStatus.FUNDED} AS "BookingPaymentStatus"),
            ${amountRwf}, ${commissionRwf}, ${ownerAmountRwf}, NOW(), NOW(), NOW()
          FROM debited_wallet
          RETURNING "bookingId"
        ), created_transaction AS (
          INSERT INTO "WalletTransaction" (
            "id", "walletId", "bookingId", "type", "status", "direction",
            "amountRwf", "reference", "description", "createdAt", "updatedAt"
          )
          SELECT
            ${transactionId}, debited_wallet."id", ${bookingId},
            CAST(${WalletTransactionType.BOOKING_PAYMENT} AS "WalletTransactionType"),
            CAST(${WalletTransactionStatus.SUCCEEDED} AS "WalletTransactionStatus"),
            CAST(${WalletTransactionDirection.DEBIT} AS "WalletTransactionDirection"),
            ${amountRwf}, ${reference}, 'Payment held for booking', NOW(), NOW()
          FROM debited_wallet CROSS JOIN created_payment
          RETURNING "id"
        )
        SELECT "id" FROM created_transaction
      `;
      if (rows.length) {
        return this.prisma.bookingPayment.findUniqueOrThrow({
          where: { bookingId },
        });
      }
      throw new BadRequestException('Wallet balance is too low for this booking.');
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      const existing = await this.prisma.bookingPayment.findUnique({
        where: { bookingId },
      });
      if (existing) {
        throw new BadRequestException('This booking already has a payment record.');
      }
      throw error;
    }
  }

  async releaseBookingFunds(bookingId: string) {
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      include: { truck: { select: { ownerId: true } } },
    });
    if (!booking) throw new NotFoundException('Booking not found.');
    await this.getOrCreateWallet(booking.truck.ownerId);
    const admin = await this.prisma.user.findFirst({
      where: { role: 'ADMIN' },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (!admin) {
      throw new ServiceUnavailableException(
        'Create an admin account before releasing booking payments.',
      );
    }
    await this.getOrCreateWallet(admin.id);

    return this.prisma.$queryRaw<{ id: string }[]>`
      WITH released_payment AS (
        UPDATE "BookingPayment"
        SET "status" = CAST(${BookingPaymentStatus.RELEASED} AS "BookingPaymentStatus"),
            "releasedAt" = NOW(), "updatedAt" = NOW()
        WHERE "bookingId" = ${bookingId}
          AND "status" = CAST(${BookingPaymentStatus.FUNDED} AS "BookingPaymentStatus")
          AND EXISTS (
            SELECT 1 FROM "Booking"
            WHERE "id" = ${bookingId}
              AND (
                "status" = CAST(${BookingStatus.DELIVERED} AS "BookingStatus")
                OR (
                  "status" = CAST(${BookingStatus.DISPUTED} AS "BookingStatus")
                  AND EXISTS (
                    SELECT 1 FROM "Dispute"
                    WHERE "Dispute"."bookingId" = "Booking"."id"
                      AND "Dispute"."status" = 'RESOLVED'
                  )
                )
              )
          )
        RETURNING "bookingId", "ownerAmountRwf", "commissionRwf"
      ), credited_wallet AS (
        UPDATE "Wallet" wallet
        SET "balanceRwf" = wallet."balanceRwf" + released_payment."ownerAmountRwf",
            "updatedAt" = NOW()
        FROM released_payment
        JOIN "Booking" booking ON booking."id" = released_payment."bookingId"
        JOIN "Truck" truck ON truck."id" = booking."truckId"
        WHERE wallet."userId" = truck."ownerId"
        RETURNING wallet."id", released_payment."bookingId",
                  released_payment."ownerAmountRwf"
      ), credited_commission AS (
        UPDATE "Wallet" wallet
        SET "balanceRwf" = wallet."balanceRwf" + released_payment."commissionRwf",
            "updatedAt" = NOW()
        FROM released_payment
        WHERE wallet."userId" = ${admin.id}
        RETURNING wallet."id", released_payment."bookingId",
                  released_payment."commissionRwf"
      ), owner_transaction AS (
        INSERT INTO "WalletTransaction" (
          "id", "walletId", "bookingId", "type", "status", "direction",
          "amountRwf", "reference", "description", "createdAt", "updatedAt"
        )
        SELECT
          ${randomUUID()}, credited_wallet."id", credited_wallet."bookingId",
          CAST(${WalletTransactionType.BOOKING_EARNING} AS "WalletTransactionType"),
          CAST(${WalletTransactionStatus.SUCCEEDED} AS "WalletTransactionStatus"),
          CAST(${WalletTransactionDirection.CREDIT} AS "WalletTransactionDirection"),
          credited_wallet."ownerAmountRwf",
          ${`ibanga-release-${bookingId}`}, 'Booking proceeds released', NOW(), NOW()
        FROM credited_wallet
        RETURNING "id"
      ), commission_transaction AS (
        INSERT INTO "WalletTransaction" (
          "id", "walletId", "bookingId", "type", "status", "direction",
          "amountRwf", "reference", "description", "createdAt", "updatedAt"
        )
        SELECT
          ${randomUUID()}, credited_commission."id", credited_commission."bookingId",
          CAST(${WalletTransactionType.PLATFORM_COMMISSION} AS "WalletTransactionType"),
          CAST(${WalletTransactionStatus.SUCCEEDED} AS "WalletTransactionStatus"),
          CAST(${WalletTransactionDirection.CREDIT} AS "WalletTransactionDirection"),
          credited_commission."commissionRwf",
          ${`ibanga-commission-${bookingId}`}, 'iBanga booking commission (6%)', NOW(), NOW()
        FROM credited_commission
        RETURNING "id"
      )
      SELECT "id" FROM owner_transaction
      UNION ALL
      SELECT "id" FROM commission_transaction
    `;
  }

  async getAdminCommission(actor: WalletActor) {
    if (actor.role !== 'ADMIN') {
      throw new ForbiddenException('Only admins can view platform commission.');
    }
    const [wallet, total] = await Promise.all([
      this.getOrCreateWallet(actor.id),
      this.prisma.bookingPayment.aggregate({
        where: { status: BookingPaymentStatus.RELEASED },
        _sum: { commissionRwf: true },
      }),
    ]);
    return {
      availableRwf: wallet.balanceRwf,
      totalEarnedRwf: total._sum.commissionRwf ?? 0,
      currency: 'RWF',
    };
  }

  private isMockMode() {
    if (process.env.NODE_ENV === 'production') return false;
    if (process.env.PAYMENTS_MODE === 'flutterwave') return false;
    if (process.env.PAYMENTS_MODE === 'mock') return true;
    return !process.env.FLW_SECRET_KEY;
  }

  async handleFlutterwaveWebhook(
    signature: string | undefined,
    payload: WebhookPayload,
  ) {
    this.assertWebhookSignature(signature);
    const data = payload?.data;
    if (!data?.id) return { received: true };

    if (payload.event === 'charge.completed' && data.tx_ref) {
      const transaction = await this.prisma.walletTransaction.findUnique({
        where: { reference: data.tx_ref },
      });
      if (!transaction || transaction.type !== WalletTransactionType.DEPOSIT) {
        return { received: true };
      }
      if (transaction.status !== WalletTransactionStatus.PENDING) {
        return { received: true };
      }

      const verified = await this.flwRequest<VerifiedCharge>(
        `/transactions/${encodeURIComponent(String(data.id))}/verify`,
      );
      const charge = verified.data;
      if (
        charge.tx_ref !== transaction.reference ||
        charge.currency !== 'RWF' ||
        charge.amount !== transaction.amountRwf
      ) {
        throw new BadRequestException('Payment verification did not match the deposit.');
      }
      if (charge.status !== 'successful') {
        await this.prisma.walletTransaction.updateMany({
          where: {
            id: transaction.id,
            status: WalletTransactionStatus.PENDING,
          },
          data: {
            status: WalletTransactionStatus.FAILED,
            providerReference: String(charge.id),
          },
        });
        return { received: true };
      }

      await this.prisma.$queryRaw`
        WITH credited AS (
          UPDATE "WalletTransaction"
          SET "status" = CAST(${WalletTransactionStatus.SUCCEEDED} AS "WalletTransactionStatus"),
              "providerReference" = ${String(charge.id)}, "updatedAt" = NOW()
          WHERE "id" = ${transaction.id}
            AND "status" = CAST(${WalletTransactionStatus.PENDING} AS "WalletTransactionStatus")
          RETURNING "walletId", "amountRwf"
        )
        UPDATE "Wallet" wallet
        SET "balanceRwf" = wallet."balanceRwf" + credited."amountRwf",
            "updatedAt" = NOW()
        FROM credited
        WHERE wallet."id" = credited."walletId"
      `;
      return { received: true };
    }

    if (payload.event === 'transfer.completed' && data.reference) {
      const transaction = await this.prisma.walletTransaction.findUnique({
        where: { reference: data.reference },
      });
      if (!transaction || transaction.type !== WalletTransactionType.WITHDRAWAL) {
        return { received: true };
      }
      if (transaction.status !== WalletTransactionStatus.PENDING) {
        return { received: true };
      }

      const verified = await this.flwRequest<TransferData>(
        `/transfers/${encodeURIComponent(String(data.id))}`,
      );
      if (verified.data.reference !== transaction.reference) {
        throw new BadRequestException('Transfer verification did not match the withdrawal.');
      }
      if (verified.data.status === 'SUCCESSFUL') {
        await this.prisma.walletTransaction.updateMany({
          where: {
            id: transaction.id,
            status: WalletTransactionStatus.PENDING,
          },
          data: {
            status: WalletTransactionStatus.SUCCEEDED,
            providerReference: String(verified.data.id),
          },
        });
      } else if (verified.data.status === 'FAILED') {
        await this.failWithdrawal(transaction.reference, String(verified.data.id));
      }
    }
    return { received: true };
  }

  private async getOrCreateWallet(userId: string) {
    return this.prisma.wallet.upsert({
      where: { userId },
      create: { userId },
      update: {},
    });
  }

  private async failWithdrawal(reference: string, providerReference?: string) {
    await this.prisma.$queryRaw`
      WITH failed AS (
        UPDATE "WalletTransaction"
        SET "status" = CAST(${WalletTransactionStatus.FAILED} AS "WalletTransactionStatus"),
            "providerReference" = COALESCE(${providerReference ?? null}, "providerReference"),
            "updatedAt" = NOW()
        WHERE "reference" = ${reference}
          AND "type" = CAST(${WalletTransactionType.WITHDRAWAL} AS "WalletTransactionType")
          AND "status" = CAST(${WalletTransactionStatus.PENDING} AS "WalletTransactionStatus")
        RETURNING "walletId", "amountRwf"
      )
      UPDATE "Wallet" wallet
      SET "balanceRwf" = wallet."balanceRwf" + failed."amountRwf",
          "updatedAt" = NOW()
      FROM failed
      WHERE wallet."id" = failed."walletId"
    `;
  }

  private async flwRequest<T>(
    path: string,
    options: RequestInit = {},
  ): Promise<FlwEnvelope<T>> {
    const secretKey = process.env.FLW_SECRET_KEY;
    if (!secretKey) {
      throw new ServiceUnavailableException(
        'Flutterwave payments are not configured. Set FLW_SECRET_KEY in backend/.env and restart the API.',
      );
    }
    let response: Response;
    try {
      response = await fetch(`https://api.flutterwave.com/v3${path}`, {
        ...options,
        headers: {
          Authorization: `Bearer ${secretKey}`,
          'Content-Type': 'application/json',
          ...options.headers,
        },
      });
    } catch {
      throw new BadGatewayException('Could not reach the payment provider.');
    }
    const result = (await response.json().catch(() => null)) as
      | FlwEnvelope<T>
      | null;
    if (!response.ok || !result || result.status !== 'success') {
      throw new BadGatewayException('The payment provider could not process the request.');
    }
    return result;
  }

  private assertWebhookSignature(signature: string | undefined) {
    const secret = process.env.FLW_WEBHOOK_SECRET;
    if (!secret || !signature) {
      throw new UnauthorizedException('Invalid payment webhook signature.');
    }
    const received = Buffer.from(signature);
    const expected = Buffer.from(secret);
    if (
      received.length !== expected.length ||
      !timingSafeEqual(received, expected)
    ) {
      throw new UnauthorizedException('Invalid payment webhook signature.');
    }
  }

  private getCommissionBps() {
    const value = Number(process.env.PAYMENT_COMMISSION_BPS ?? 600);
    if (!Number.isInteger(value) || value < 0 || value > 10000) {
      throw new ServiceUnavailableException('Payment commission configuration is invalid.');
    }
    return value;
  }

  private normalizeRwandaPhone(phoneNumber: string) {
    const digits = phoneNumber.replace(/\D/g, '');
    if (digits.length === 9 && digits.startsWith('7')) return `250${digits}`;
    if (digits.length === 12 && digits.startsWith('250')) return digits;
    throw new BadRequestException('Enter a valid Rwanda mobile number.');
  }

  private toTransferDetails(dto: CreateWithdrawalDto) {
    if (dto.method === 'MOBILE_MONEY') {
      if (!dto.phoneNumber) {
        throw new BadRequestException('An MTN Mobile Money number is required.');
      }
      return {
        account_bank: 'MTN',
        account_number: this.normalizeRwandaPhone(dto.phoneNumber),
        beneficiary_name: dto.beneficiaryName.trim(),
      };
    }
    if (!dto.bankCode || !dto.branchCode || !dto.accountNumber) {
      throw new BadRequestException(
        'Bank, branch, and account details are required for a bank withdrawal.',
      );
    }
    return {
      account_bank: dto.bankCode,
      destination_branch_code: dto.branchCode,
      account_number: dto.accountNumber.trim(),
      beneficiary_name: dto.beneficiaryName.trim(),
    };
  }
}