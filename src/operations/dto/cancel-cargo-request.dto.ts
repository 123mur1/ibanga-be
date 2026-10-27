import { IsString, MinLength } from 'class-validator';

export class CancelCargoRequestDto {
  @IsString()
  @MinLength(1)
  reason!: string;
}
