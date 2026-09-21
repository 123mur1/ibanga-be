import { Transform } from 'class-transformer';
import { IsBoolean, IsNumber, IsOptional, IsString } from 'class-validator';

export class QueryTrucksDto {
  @IsOptional()
  @IsString()
  location?: string;

  @IsOptional()
  @IsString()
  truckType?: string;

  @IsOptional()
  @IsString()
  route?: string;

  @IsOptional()
  @Transform(({ value }) => (value === undefined ? undefined : Number(value)))
  @IsNumber()
  minCapacity?: number;

  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  mine?: boolean;
}
