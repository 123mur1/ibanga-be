import {
  IsIn,
  Matches,
  MaxLength,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  MinLength,
} from 'class-validator';

export class CreateDepositDto {
  @IsInt()
  @Min(1000)
  @Max(50000000)
  amountRwf: number;

  @IsString()
  @MinLength(9)
  phoneNumber: string;
}

export class CreateWithdrawalDto {
  @IsInt()
  @Min(1000)
  @Max(50000000)
  amountRwf: number;

  @IsIn(['MOBILE_MONEY', 'BANK'])
  method: 'MOBILE_MONEY' | 'BANK';

  @IsString()
  @MinLength(2)
  beneficiaryName: string;

  @IsOptional()
  @IsString()
  @MinLength(9)
  phoneNumber?: string;

  @IsOptional()
  @IsString()
  bankCode?: string;

  @IsOptional()
  @IsString()
  branchCode?: string;

  @IsOptional()
  @IsString()
  @MinLength(5)
  accountNumber?: string;
}

/** What the importer chose at checkout. Optional so older clients can still pay. */
export class PayBookingDto {
  @IsOptional()
  @IsIn(['MTN', 'AIRTEL', 'VISA'])
  method?: 'MTN' | 'AIRTEL' | 'VISA';

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  payerName?: string;

  // Only the masked forms the checkout produces, so a full card number cannot be saved.
  @IsOptional()
  @Matches(/^(\*{4} \d{4}|\d{2,4} \*{3} \d{3})$/, {
    message: 'accountMask must be masked, e.g. "**** 4242" or "0788 *** 220".',
  })
  accountMask?: string;
}

export type WalletActor = { id: string; role: string };
