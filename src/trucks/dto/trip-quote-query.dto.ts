import { IsOptional, IsString, MaxLength } from 'class-validator';

export class TripQuoteQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  pickupCity?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  pickupArea?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  destinationCity?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  destinationArea?: string;
}
