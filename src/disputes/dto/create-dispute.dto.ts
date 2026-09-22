import { IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export class CreateDisputeDto {
  @IsUUID()
  bookingId: string;

  @IsString()
  @MinLength(5)
  @MaxLength(2000)
  reason: string;
}
