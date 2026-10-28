import { Transform } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class CreateRefundDto {
  @IsUUID()
  bookingId: string;

  @Transform(trim)
  @IsString()
  @MinLength(3, { message: 'Choose the reason for the refund.' })
  @MaxLength(120)
  reason: string;

  @Transform(trim)
  @IsString()
  @MinLength(10, {
    message: 'Explain what happened in at least a sentence (10 characters).',
  })
  @MaxLength(2000)
  details: string;

  @IsInt({ message: 'Enter the refund as a whole number of RWF.' })
  @Min(1, { message: 'Enter the amount you want refunded.' })
  amountRwf: number;

  @Transform(trim)
  @IsString()
  @MinLength(3, { message: 'Say where the refund should go.' })
  @MaxLength(200)
  refundTo: string;
}

export class RespondRefundDto {
  @Transform(trim)
  @IsString()
  @MinLength(5, { message: 'Write your response (at least 5 characters).' })
  @MaxLength(2000)
  response: string;
}

export class DecideRefundDto {
  @IsIn(['APPROVED', 'REJECTED'])
  status: 'APPROVED' | 'REJECTED';

  @Transform(trim)
  @IsString()
  @MinLength(5, {
    message: 'Explain the decision to both parties (at least 5 characters).',
  })
  @MaxLength(2000)
  note: string;

  /** Amount to refund when approving; defaults to what the importer asked for. */
  @IsOptional()
  @IsInt({ message: 'Enter the refund as a whole number of RWF.' })
  @Min(1, { message: 'An approved refund must be at least 1 RWF.' })
  amountRwf?: number;
}
