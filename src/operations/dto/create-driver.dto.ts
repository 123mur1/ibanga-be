import {
  IsDateString,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';

const DRIVER_STATUSES = ['AVAILABLE', 'ON_TRIP', 'OFF_DUTY', 'SUSPENDED'];

export class CreateDriverDto {
  @IsString()
  @MinLength(2)
  name: string;

  @IsString()
  phone: string;

  @IsEmail()
  email: string;

  @IsString()
  @MinLength(6)
  password: string;

  @IsString()
  @MinLength(8)
  nationalId: string;

  @IsString()
  @MinLength(5)
  licenceNumber: string;

  @IsString()
  licenceCategory: string;

  @IsDateString()
  licenceExpiry: string;

  @IsIn(DRIVER_STATUSES)
  status: string;

  @IsString()
  assignedTruckId: string;

  @IsOptional()
  @IsString()
  ownerId?: string;
}
