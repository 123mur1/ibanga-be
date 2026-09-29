import {
  IsIn,
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

export type WalletActor = { id: string; role: string };