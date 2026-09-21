import { IsEnum } from 'class-validator';
import { TruckStatus } from '@prisma/client';

export class UpdateAvailabilityDto {
  @IsEnum(TruckStatus)
  status: TruckStatus;
}
