import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

/** A message from the driver (or owner) to everyone on the trip, optionally with a delay. */
export class TripUpdateDto {
  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  message: string;

  /** Days the delivery moves later; 0 or absent for a plain update. */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(30)
  delayDays?: number;
}

export class DelayDecisionDto {
  @IsIn(['SHIFT', 'REFUND'])
  decision: 'SHIFT' | 'REFUND';
}
