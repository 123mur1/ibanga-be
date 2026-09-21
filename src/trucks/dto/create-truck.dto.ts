import {
  ArrayMaxSize,
  IsArray,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

const MAX_PHOTOS = 6;

export class CreateTruckDto {
  @IsString()
  @MinLength(2)
  @MaxLength(20)
  plateNumber: string;

  @IsString()
  @MinLength(2)
  @MaxLength(60)
  truckType: string;

  @IsNumber()
  @IsPositive()
  capacity: number;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  currentLocation?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  preferredRoute?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_PHOTOS)
  @IsString({ each: true })
  @MaxLength(2_000_000, { each: true })
  photos?: string[];
}
