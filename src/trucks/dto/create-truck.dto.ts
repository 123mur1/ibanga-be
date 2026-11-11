import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { CARGO_TYPES, LOCATIONS, VEHICLE_CATEGORIES } from '../marketplace';

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

  @IsIn(VEHICLE_CATEGORIES, { message: 'Choose a vehicle category.' })
  category: string;

  @IsNumber()
  @IsPositive()
  capacity: number;

  @IsInt({ message: 'Enter a whole-number price per kilometre in RWF.' })
  @Min(1, { message: 'Enter a whole-number price per kilometre in RWF.' })
  @Max(1_000_000)
  pricePerKmRwf: number;

  @IsIn(LOCATIONS, {
    message: 'Choose where the vehicle is now from the list.',
  })
  currentLocation: string;

  @IsArray()
  @ArrayMinSize(1, {
    message: 'Choose at least one destination you deliver to.',
  })
  @ArrayMaxSize(LOCATIONS.length)
  @IsIn(LOCATIONS, {
    each: true,
    message: 'Choose destinations from the list.',
  })
  destinations: string[];

  @IsArray()
  @ArrayMinSize(1, {
    message: 'Choose at least one kind of cargo the vehicle carries.',
  })
  @ArrayMaxSize(CARGO_TYPES.length)
  @IsIn(CARGO_TYPES, {
    each: true,
    message: 'Choose cargo types from the list.',
  })
  acceptedCargo: string[];

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
