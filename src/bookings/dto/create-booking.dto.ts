import {
  IsDateString,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Transform } from 'class-transformer';

export class CreateBookingDto {
  @IsUUID()
  truckId: string;

  @IsString()
  @MinLength(2)
  @MaxLength(100)
  cargoType: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  cargoDescription?: string;

  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? Number.parseFloat(value) : value,
  )
  @IsNumber()
  @IsPositive()
  cargoWeight: number;

  /** Older clients: the pickup city. New clients send pickupCity (and country and area). */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  pickupLocation?: string;

  /** Older clients: the destination city. New clients send destinationCity. */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  destination?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  pickupCountry?: string;

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
  @MaxLength(80)
  destinationCountry?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  destinationCity?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  destinationArea?: string;

  @IsDateString()
  pickupDate: string;

  @IsDateString()
  expectedDeliveryDate: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  additionalInstructions?: string;
}
