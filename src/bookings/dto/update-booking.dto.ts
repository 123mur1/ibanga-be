import { BookingStatus } from '@prisma/client';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateBookingDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  agreedPrice?: string;

  @IsOptional()
  @IsEnum(BookingStatus)
  status?: BookingStatus;
}
