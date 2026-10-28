import { Transform } from 'class-transformer';
import { IsInt, IsString, MaxLength, Min, MinLength } from 'class-validator';

export class SettleDisputeDto {
  /** Amount returned to the importer: the full price, part of it, or 0 to pay the owner. */
  @IsInt({ message: 'Enter the refund as a whole number of RWF.' })
  @Min(0, { message: 'The refund cannot be negative.' })
  refundRwf: number;

  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(5, { message: 'Explain the decision in a few words.' })
  @MaxLength(2000)
  resolutionNotes: string;
}
