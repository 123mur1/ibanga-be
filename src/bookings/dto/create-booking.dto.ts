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

  @Transform(({ value }) =>
    typeof value === 'string' ? Number.parseFloat(value) : value,
  )
  @IsNumber()
  @IsPositive()
  cargoWeight: number;

  @IsString()
  @MinLength(2)
  @MaxLength(120)
  pickupLocation: string;

  @IsString()
  @MinLength(2)
  @MaxLength(120)
  destination: string;

  @IsDateString()
  pickupDate: string;

  @IsDateString()
  expectedDeliveryDate: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  additionalInstructions?: string;
}
